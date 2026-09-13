// Performance metrics sourced from the vault's own event log rather than from a table.
//
// StrategyVault emits `PnlApplied(delta, totalManagedAssets, reserve, navPerShare)` on
// every settlement, so each of those logs is a NAV observation and the block that mined it
// dates the observation. `Deposited` and `Withdrawn` carry the share count, which is what
// turns a NAV into an AUM and a set of investors. Together they are a complete history that
// owes nothing to any row this backend wrote — if the chain accepted the settlement, the
// number is in here.
//
// The maths is lib/metrics.ts and is not restated: this file only sources the series and
// feeds it in, so a chain-derived APY and a snapshot-derived one are computed identically.
//
// Reads are cached per vault for a few seconds and coalesced, because a listing prices
// every strategy it matched and a page of twenty must not become twenty round trips. Block
// timestamps are cached forever — a mined block's timestamp never changes.

import { parseEventLogs, type Address, type Log } from 'viem'
import type { StrategyMetrics, TimeseriesPoint } from '../../../shared/types.js'
import { strategyVaultAbi } from '../chain/abis.js'
import { publicClient } from '../chain/client.js'
import { consoleLogger, type Logger } from '../strategy/ports.js'
import { computeMetrics, type NavPoint } from './metrics.js'

/**
 * Below this observation window an annualised figure is not a projection, it is an
 * artefact: compounding twenty minutes of drift over a year saturates every loss to
 * exactly -100% and blows every gain past 1e100. `totalReturn` stays honest at any span,
 * so APY reports null until there is enough history to mean something.
 */
const MIN_ANNUALISE_MS = 6 * 60 * 60 * 1000
import { formatAmount } from './money.js'
import { navPerShare as parShare } from './shares.js'

/** One settlement, as the chain recorded it. All amounts are 6dp base units. */
export interface ChainNavPoint {
	/** Unix milliseconds, taken from the block that mined the settlement. */
	t: number
	navPerShare: bigint
	totalAssets: bigint
	totalShares: bigint
}

/** Everything one vault's log history says about it. */
export interface VaultReading {
	vaultAddress: Address
	/** NAV observations, oldest first. One per PnlApplied. */
	series: ChainNavPoint[]
	/** Distinct addresses that still hold shares. */
	investorCount: number
	totalAssets: bigint
	totalShares: bigint
	navPerShare: bigint
	/** Block time of the newest event of any kind. Null for a vault that has none. */
	updatedAt: number | null
}

/** Long enough that a listing costs one read, short enough that a fresh tick shows up. */
const CACHE_TTL_MS = 5_000

/** Points on a card sparkline. Enough to show a shape, few enough to stay a sparkline. */
const SPARKLINE_POINTS = 32

const NAV_EVENTS = ['PnlApplied', 'Deposited', 'Withdrawn'] as const

interface CacheEntry {
	expiresAt: number
	reading: Promise<VaultReading>
}

const readings = new Map<string, CacheEntry>()
const blockTimes = new Map<string, number>()

const keyOf = (address: Address): string => address.toLowerCase()

function emptyReading(vaultAddress: Address): VaultReading {
	return {
		vaultAddress,
		series: [],
		investorCount: 0,
		totalAssets: 0n,
		totalShares: 0n,
		navPerShare: BigInt(parShare({ totalAssets: '0', totalShares: '0' })),
		updatedAt: null,
	}
}

/* ── Reading the chain ───────────────────────────────────── */

/**
 * Every vault log in one request. anvil's history is small enough that scanning from
 * genesis is cheaper than tracking a cursor, and passing all the addresses at once keeps a
 * whole listing to a single `eth_getLogs`.
 */
async function fetchLogs(addresses: readonly Address[]): Promise<Log[]> {
	return publicClient.getLogs({
		address: [...addresses],
		fromBlock: 0n,
		toBlock: 'latest',
	})
}

/** Block number -> block time in ms, fetching only the blocks not already known. */
async function blockTimestamps(blockNumbers: readonly bigint[]): Promise<Map<string, number>> {
	const wanted = [...new Set(blockNumbers.map((value) => value.toString()))]
	const missing = wanted.filter((value) => !blockTimes.has(value))

	const fetched = await Promise.all(
		missing.map(async (value) => {
			const block = await publicClient.getBlock({ blockNumber: BigInt(value) })
			return [value, Number(block.timestamp) * 1000] as const
		}),
	)
	for (const [value, time] of fetched) blockTimes.set(value, time)

	const times = new Map<string, number>()
	for (const value of wanted) {
		const time = blockTimes.get(value)
		if (time !== undefined) times.set(value, time)
	}
	return times
}

/**
 * Folds one vault's logs into a reading.
 *
 * Share count comes from the deposit and withdrawal events and is carried forward across
 * settlements, because `PnlApplied` reports assets and NAV but not shares — and a
 * settlement never changes the share count anyway.
 */
function foldLogs(
	vaultAddress: Address,
	logs: ReadonlyArray<Log>,
	times: ReadonlyMap<string, number>,
): VaultReading {
	const decoded = parseEventLogs({ abi: strategyVaultAbi, eventName: [...NAV_EVENTS], logs: [...logs] })

	const ordered = [...decoded].sort((a, b) => {
		const byBlock = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n))
		return byBlock !== 0 ? byBlock : (a.logIndex ?? 0) - (b.logIndex ?? 0)
	})

	const reading = emptyReading(vaultAddress)
	const held = new Map<string, bigint>()

	for (const log of ordered) {
		const t = times.get((log.blockNumber ?? 0n).toString())
		if (t === undefined) continue
		reading.updatedAt = t

		if (log.eventName === 'Deposited') {
			reading.totalAssets = log.args.totalManagedAssets
			reading.totalShares = log.args.totalShares
			const investor = log.args.investor.toLowerCase()
			held.set(investor, (held.get(investor) ?? 0n) + log.args.shares)
			continue
		}

		if (log.eventName === 'Withdrawn') {
			reading.totalAssets = log.args.totalManagedAssets
			reading.totalShares = log.args.totalShares
			const investor = log.args.investor.toLowerCase()
			held.set(investor, (held.get(investor) ?? 0n) - log.args.shares)
			continue
		}

		reading.totalAssets = log.args.totalManagedAssets
		reading.series.push({
			t,
			navPerShare: log.args.navPerShare,
			totalAssets: log.args.totalManagedAssets,
			totalShares: reading.totalShares,
		})
	}

	for (const shares of held.values()) if (shares > 0n) reading.investorCount += 1

	// Priced off the running totals rather than off the last settlement's NAV, so a deposit
	// mined after the last tick is reflected the moment it lands.
	reading.navPerShare = BigInt(
		parShare({
			totalAssets: reading.totalAssets.toString(),
			totalShares: reading.totalShares.toString(),
		}),
	)
	return reading
}

/**
 * Readings for many vaults, keyed by lowercased address. Cache hits are returned as they
 * are; everything else is read in one batch and the resulting promise is cached per vault
 * so concurrent callers share a single round trip.
 */
export async function readVaultsFromChain(
	vaultAddresses: readonly Address[],
	logger: Logger = consoleLogger,
): Promise<Map<string, VaultReading>> {
	const unique = new Map<string, Address>()
	for (const address of vaultAddresses) unique.set(keyOf(address), address)

	const now = Date.now()
	const pending = new Map<string, Promise<VaultReading>>()
	const missing: Address[] = []

	for (const [key, address] of unique) {
		const cached = readings.get(key)
		if (cached && cached.expiresAt > now) pending.set(key, cached.reading)
		else missing.push(address)
	}

	if (missing.length > 0) {
		const group = (async (): Promise<Map<string, VaultReading>> => {
			const logs = await fetchLogs(missing)
			const times = await blockTimestamps(logs.map((log) => log.blockNumber ?? 0n))

			const byVault = new Map<string, Log[]>()
			for (const address of missing) byVault.set(keyOf(address), [])
			for (const log of logs) {
				byVault.get(keyOf(log.address))?.push(log)
			}

			const built = new Map<string, VaultReading>()
			for (const address of missing) {
				const key = keyOf(address)
				built.set(key, foldLogs(address, byVault.get(key) ?? [], times))
			}
			return built
		})()

		// A failed read must not sit in the cache poisoning the next few seconds of requests.
		group.catch((error) => {
			logger.error(
				{ err: error, vaults: missing },
				'could not read vault history from the chain',
			)
			for (const address of missing) readings.delete(keyOf(address))
		})

		const expiresAt = now + CACHE_TTL_MS
		for (const address of missing) {
			const key = keyOf(address)
			const reading = group.then((built) => built.get(key) ?? emptyReading(address))
			readings.set(key, { expiresAt, reading })
			pending.set(key, reading)
		}
	}

	const resolved = await Promise.all(
		[...pending].map(async ([key, reading]) => [key, await reading] as const),
	)
	return new Map(resolved)
}

export async function readVaultFromChain(
	vaultAddress: Address,
	logger: Logger = consoleLogger,
): Promise<VaultReading> {
	const built = await readVaultsFromChain([vaultAddress], logger)
	return built.get(keyOf(vaultAddress)) ?? emptyReading(vaultAddress)
}

/* ── The series and the metrics ──────────────────────────── */

/** The vault's NAV history, oldest first, straight from its settlement logs. */
export async function navSeriesFromChain(
	vaultAddress: Address,
	logger: Logger = consoleLogger,
): Promise<ChainNavPoint[]> {
	return (await readVaultFromChain(vaultAddress, logger)).series
}

export function toNavPoints(series: readonly ChainNavPoint[]): NavPoint[] {
	return series.map((point) => ({
		t: point.t,
		nav: Number(formatAmount(point.navPerShare.toString())),
	}))
}

/** A reading -> the DTO. Metrics stay null wherever the history is too short to state them. */
export function metricsFrom(reading: VaultReading): StrategyMetrics {
	const derived = computeMetrics(toNavPoints(reading.series), { minSpanMs: MIN_ANNUALISE_MS })
	return {
		apy: derived.apy,
		totalReturn: derived.totalReturn,
		maxDrawdown: derived.maxDrawdown,
		sharpe: derived.sharpe,
		aum: formatAmount(reading.totalAssets.toString()),
		investorCount: reading.investorCount,
		navPerShare: formatAmount(reading.navPerShare.toString()),
		navSnapshotCount: reading.series.length,
		updatedAt: reading.updatedAt === null ? null : new Date(reading.updatedAt).toISOString(),
	}
}

export async function metricsFromChain(
	vaultAddress: Address,
	logger: Logger = consoleLogger,
): Promise<StrategyMetrics> {
	return metricsFrom(await readVaultFromChain(vaultAddress, logger))
}

/** Metrics for a whole listing in one read, keyed by lowercased vault address. */
export async function metricsFromChainFor(
	vaultAddresses: readonly Address[],
	logger: Logger = consoleLogger,
): Promise<Map<string, StrategyMetrics>> {
	const built = await readVaultsFromChain(vaultAddresses, logger)
	return new Map([...built].map(([key, reading]) => [key, metricsFrom(reading)]))
}

/* ── Presentation helpers ────────────────────────────────── */

export function sparklineFrom(series: readonly ChainNavPoint[]): number[] {
	return series
		.slice(-SPARKLINE_POINTS)
		.map((point) => Number(formatAmount(point.navPerShare.toString())))
		.filter((value) => Number.isFinite(value))
}

export function timeseriesFrom(series: readonly ChainNavPoint[], from: Date | null): TimeseriesPoint[] {
	const start = from ? from.getTime() : Number.NEGATIVE_INFINITY
	return series
		.filter((point) => point.t >= start)
		.map((point) => ({
			t: new Date(point.t).toISOString(),
			v: formatAmount(point.navPerShare.toString()),
		}))
}
