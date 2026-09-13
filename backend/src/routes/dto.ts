// Database rows -> the DTOs in shared/types.ts.
//
// Two rules hold across every mapper here, and both exist because getting them wrong is
// invisible until someone reads a number and believes it:
//
//   money      leaves the database as base units and crosses the wire as a decimal string,
//              converted only by lib/money.ts. A 1e6 slip looks like a plausible balance.
//   metrics    are computed from the nav_snapshots the scheduler wrote, by lib/metrics.ts,
//              and are null when the history is too short to state them — annualised ones
//              measured against MIN_ANNUALISE_MS, the same floor the chain-derived path
//              uses. Never a stand-in number: a placeholder APY is indistinguishable from
//              a real one, and an annualised minute is a placeholder with a decimal point.
//
// Vault totals are read from the chain rather than from the newest snapshot, because a
// deposit changes them the moment it is mined and the next snapshot is a tick away. The
// snapshot is the fallback for when the chain cannot be reached, and it says so in the log.

import { and, asc, desc, eq, gte, inArray, like, sql } from 'drizzle-orm'
import type { Address } from 'viem'
import type {
	Execution,
	Position,
	StrategyDetail,
	StrategyMetrics,
	StrategySummary,
	StrategyVerification,
	TimeRange,
	TimeseriesPoint,
	Trade,
} from '../../../shared/types.js'
import { db } from '../db/index.js'
import {
	executions,
	navSnapshots,
	positionEvents,
	positions,
	strategies,
	trades,
	users,
	type NavSnapshotRow,
	type PositionEventRow,
	type PositionRow,
	type StrategyRow,
} from '../db/schema.js'
import { MIN_ANNUALISE_MS } from '../lib/annualise.js'
import { computeMetrics, toNavSeries } from '../lib/metrics.js'
import { formatAmount, percentChange, subAmounts, toBigInt, ZERO } from '../lib/money.js'
import { navPerShare as parShare, positionValue } from '../lib/shares.js'
import type { ChainPort, Logger } from '../strategy/ports.js'

/**
 * The TEE and region the generated workflow declares to CRE — see the `handlerInTee` call
 * in chainlink/strategy-toolkit/src/cre-workflow/workflow.ts. AWS Nitro in us-west-2 is
 * the only registered TEE type and region, so this is a fact about the deployment rather
 * than anything a strategy chooses.
 */
const TEE_REGIONS = ['us-west-2']

/** Points on a card sparkline. Enough to show a shape, few enough to stay a sparkline. */
const SPARKLINE_POINTS = 32

/** Vault totals in base units, whether they came from the chain or from the last snapshot. */
export interface Totals {
	totalAssets: string
	totalShares: string
	navPerShare: string
}

export const EMPTY_TOTALS: Totals = {
	totalAssets: ZERO,
	totalShares: ZERO,
	navPerShare: parShare({ totalAssets: ZERO, totalShares: ZERO }),
}

export function rangeStart(range: TimeRange, now: number = Date.now()): Date | null {
	const spans: Record<Exclude<TimeRange, 'all'>, number> = {
		'24h': 24 * 60 * 60 * 1000,
		'7d': 7 * 24 * 60 * 60 * 1000,
		'30d': 30 * 24 * 60 * 60 * 1000,
		'90d': 90 * 24 * 60 * 60 * 1000,
	}
	if (range === 'all') return null
	return new Date(now - spans[range])
}

/* ── Vault totals ────────────────────────────────────────── */

/**
 * What the vault holds right now. The chain is asked first because it is the only thing
 * that knows about a deposit made since the last tick; a chain that cannot be reached
 * falls back to the newest snapshot and is logged, never silently reported as zero.
 */
export async function readTotals(
	chain: ChainPort,
	strategy: StrategyRow,
	logger: Logger,
): Promise<Totals> {
	if (strategy.vaultAddress) {
		try {
			const totals = await chain.readVault(strategy.vaultAddress as Address)
			return {
				totalAssets: totals.totalManagedAssets.toString(),
				totalShares: totals.totalShares.toString(),
				navPerShare: totals.navPerShare.toString(),
			}
		} catch (error) {
			logger.error(
				{ err: error, strategyId: strategy.id, vaultAddress: strategy.vaultAddress },
				'could not read the vault; falling back to the last NAV snapshot',
			)
		}
	}
	return totalsFromSnapshot(latestSnapshot(strategy.id))
}

export function totalsFromSnapshot(row: NavSnapshotRow | null): Totals {
	if (!row) return EMPTY_TOTALS
	return {
		totalAssets: row.totalAssets,
		totalShares: row.totalShares,
		navPerShare: row.navPerShare,
	}
}

export function latestSnapshot(strategyId: string): NavSnapshotRow | null {
	return (
		db
			.select()
			.from(navSnapshots)
			.where(eq(navSnapshots.strategyId, strategyId))
			.orderBy(desc(navSnapshots.t))
			.limit(1)
			.get() ?? null
	)
}

/** Totals for many strategies at once, so a listing is one round of parallel reads. */
export async function readTotalsFor(
	chain: ChainPort,
	rows: readonly StrategyRow[],
	logger: Logger,
): Promise<Map<string, Totals>> {
	const entries = await Promise.all(
		rows.map(async (row) => [row.id, await readTotals(chain, row, logger)] as const),
	)
	return new Map(entries)
}

/* ── Series ──────────────────────────────────────────────── */

export function navSeries(strategyId: string, from: Date | null = null): NavSnapshotRow[] {
	const where = from
		? and(eq(navSnapshots.strategyId, strategyId), gte(navSnapshots.t, from))
		: eq(navSnapshots.strategyId, strategyId)
	return db.select().from(navSnapshots).where(where).orderBy(asc(navSnapshots.t)).all()
}

/** One query for a whole page of strategies rather than one per row. */
export function navSeriesFor(strategyIds: readonly string[]): Map<string, NavSnapshotRow[]> {
	const series = new Map<string, NavSnapshotRow[]>()
	if (strategyIds.length === 0) return series

	const rows = db
		.select()
		.from(navSnapshots)
		.where(inArray(navSnapshots.strategyId, [...strategyIds]))
		.orderBy(asc(navSnapshots.t))
		.all()

	for (const row of rows) {
		const bucket = series.get(row.strategyId)
		if (bucket) bucket.push(row)
		else series.set(row.strategyId, [row])
	}
	return series
}

export function toTimeseries(rows: readonly NavSnapshotRow[]): TimeseriesPoint[] {
	return rows.map((row) => ({ t: row.t.toISOString(), v: formatAmount(row.navPerShare) }))
}

/* ── Strategy ────────────────────────────────────────────── */

export function investorCounts(strategyIds: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>()
	if (strategyIds.length === 0) return counts

	const rows = db
		.select({ strategyId: positions.strategyId, investors: sql<number>`count(*)` })
		.from(positions)
		.where(
			and(
				inArray(positions.strategyId, [...strategyIds]),
				sql`cast(${positions.shares} as integer) > 0`,
			),
		)
		.groupBy(positions.strategyId)
		.all()

	for (const row of rows) counts.set(row.strategyId, Number(row.investors))
	return counts
}

/**
 * The last tick that ran inside the enclave. A tick that fell back to the local runner is
 * deliberately not counted: the execution row records which path produced the decision,
 * and only the enclave path is an attestation.
 */
export function lastAttestedAt(strategyId: string): string | null {
	const row = db
		.select({ t: executions.t })
		.from(executions)
		.where(
			and(
				eq(executions.strategyId, strategyId),
				eq(executions.status, 'ok'),
				like(executions.reason, '[cre-simulate]%'),
			),
		)
		.orderBy(desc(executions.t))
		.limit(1)
		.get()
	return row ? row.t.toISOString() : null
}

export function toMetrics(
	series: readonly NavSnapshotRow[],
	totals: Totals,
	investors: number,
): StrategyMetrics {
	const points = toNavSeries(series)
	const derived = computeMetrics(points, { minSpanMs: MIN_ANNUALISE_MS })
	const newest = series[series.length - 1]
	return {
		apy: derived.apy,
		totalReturn: derived.totalReturn,
		maxDrawdown: derived.maxDrawdown,
		sharpe: derived.sharpe,
		aum: formatAmount(totals.totalAssets),
		investorCount: investors,
		navPerShare: formatAmount(totals.navPerShare),
		navSnapshotCount: series.length,
		updatedAt: newest ? newest.t.toISOString() : null,
	}
}

export function toVerification(strategy: StrategyRow): StrategyVerification {
	return {
		binaryHash: strategy.binaryHash,
		configHash: strategy.configHash,
		workflowId: strategy.workflowId,
		tee: 'nitro',
		regions: TEE_REGIONS,
		lastAttestedAt: lastAttestedAt(strategy.id),
		sourceAvailable: (strategy.sourceCode ?? '').trim().length > 0,
	}
}

/** NAV per share as plain numbers for the card sparkline, oldest last. */
export function toSparkline(series: readonly NavSnapshotRow[]): number[] {
	return series
		.slice(-SPARKLINE_POINTS)
		.map((row) => Number(formatAmount(row.navPerShare)))
		.filter((value) => Number.isFinite(value))
}

export interface CreatorRef {
	id: string
	username: string
}

export function toSummary(
	strategy: StrategyRow,
	creator: CreatorRef,
	series: readonly NavSnapshotRow[],
	totals: Totals,
	investors: number,
): StrategySummary {
	return {
		id: strategy.id,
		slug: strategy.slug,
		name: strategy.name,
		ticker: strategy.ticker,
		types: strategy.types,
		riskLevel: strategy.riskLevel,
		status: strategy.status,
		creator,
		vaultAddress: strategy.vaultAddress,
		metrics: toMetrics(series, totals, investors),
		verification: toVerification(strategy),
		sparkline: toSparkline(series),
		createdAt: strategy.createdAt.toISOString(),
	}
}

/** Creator id -> {id, username} for a page of strategies, in one query. */
export function creatorsFor(creatorIds: readonly string[]): Map<string, CreatorRef> {
	const map = new Map<string, CreatorRef>()
	if (creatorIds.length === 0) return map
	const rows = db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(inArray(users.id, [...creatorIds]))
		.all()
	for (const row of rows) map.set(row.id, { id: row.id, username: row.username })
	return map
}

/** A creator row that vanished would fail the whole listing; the id alone still renders. */
export function creatorOf(map: Map<string, CreatorRef>, creatorId: string): CreatorRef {
	return map.get(creatorId) ?? { id: creatorId, username: creatorId }
}

/**
 * A whole strategy detail, chain reads included. Both the detail route and the publish
 * route answer with one of these, and a strategy that has just gone live must read exactly
 * as it will on its own page a second later — so they build it the same way.
 */
export async function buildDetail(
	chain: ChainPort,
	strategy: StrategyRow,
	viewerId: string | null,
	logger: Logger,
): Promise<StrategyDetail> {
	const totals = await readTotals(chain, strategy, logger)
	const creator = creatorOf(creatorsFor([strategy.creatorId]), strategy.creatorId)
	const summary = toSummary(
		strategy,
		creator,
		navSeries(strategy.id),
		totals,
		investorCounts([strategy.id]).get(strategy.id) ?? 0,
	)

	// The caller's own position rides along, so the invest panel does not need a second
	// request to know whether they already hold shares.
	const held = viewerId ? findPosition(viewerId, strategy.id) : null

	return {
		...summary,
		description: strategy.description,
		assets: strategy.assets,
		sourceCode: strategy.sourceCode,
		position: held && isHeld(held) ? toPositionDto(held, strategy, creator.username, totals) : null,
	}
}

/* ── Positions ───────────────────────────────────────────── */

/**
 * Whether the row is still a holding.
 *
 * A position redeemed down to nothing keeps its row: the events on it are the audit trail
 * the value series is drawn from, and the investor may allocate against it again. It is
 * not money in a strategy, though, so the investor's own views must not offer it as one —
 * an allocation of zero, priced at zero, with a withdraw button that could only revert.
 * `investorCounts` and the on-chain holder count already draw the line at the same place.
 */
export function isHeld(position: PositionRow): boolean {
	return toBigInt(position.shares) > 0n
}

export function toPositionDto(
	position: PositionRow,
	strategy: Pick<StrategyRow, 'id' | 'name' | 'slug'>,
	creatorUsername: string,
	totals: Totals,
): Position {
	const currentValue = positionValue(position.shares, totals)
	const costBasis = position.costBasis
	return {
		id: position.id,
		strategyId: strategy.id,
		strategyName: strategy.name,
		strategySlug: strategy.slug,
		creatorUsername,
		shares: formatAmount(position.shares),
		costBasis: formatAmount(costBasis),
		currentValue: formatAmount(currentValue),
		unrealisedPnl: formatAmount(subAmounts(currentValue, costBasis)),
		// Undefined against a zero basis rather than infinite; a position that cost nothing
		// has no percentage return to report.
		unrealisedPnlPct: percentChange(costBasis, currentValue) ?? 0,
		firstAllocatedAt: position.firstAllocatedAt.toISOString(),
	}
}

export function findPosition(userId: string, strategyId: string): PositionRow | null {
	return (
		db
			.select()
			.from(positions)
			.where(and(eq(positions.userId, userId), eq(positions.strategyId, strategyId)))
			.get() ?? null
	)
}

export function strategyBySlug(slug: string): StrategyRow | null {
	return db.select().from(strategies).where(eq(strategies.slug, slug)).get() ?? null
}

export function usernameOf(userId: string): string {
	const row = db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get()
	return row?.username ?? userId
}

/* ── An investor's own money over time ───────────────────── */

export interface ValuePoint {
	t: Date
	/** The position's worth at that instant, base units. */
	value: string
}

export function positionEventsFor(positionId: string): PositionEventRow[] {
	return db
		.select()
		.from(positionEvents)
		.where(eq(positionEvents.positionId, positionId))
		.orderBy(asc(positionEvents.t))
		.all()
}

/**
 * The investor's share count as at each NAV snapshot, priced at that snapshot's own
 * totals. It starts at their first deposit: before that they had no money in the
 * strategy, and a zero line running back to inception would say they were flat rather
 * than that they were absent.
 */
export function positionValueSeries(
	strategyId: string,
	events: readonly PositionEventRow[],
	from: Date | null,
): ValuePoint[] {
	const first = events[0]
	if (!first) return []

	const start = from && from.getTime() > first.t.getTime() ? from : first.t
	const snapshots = db
		.select()
		.from(navSnapshots)
		.where(and(eq(navSnapshots.strategyId, strategyId), gte(navSnapshots.t, start)))
		.orderBy(asc(navSnapshots.t))
		.all()

	const points: ValuePoint[] = []
	let cursor = 0
	let shares = 0n
	for (const snapshot of snapshots) {
		while (cursor < events.length) {
			const event = events[cursor]
			if (!event || event.t.getTime() > snapshot.t.getTime()) break
			shares += event.kind === 'deposit' ? toBigInt(event.shares) : -toBigInt(event.shares)
			cursor += 1
		}
		points.push({
			t: snapshot.t,
			value: positionValue(shares.toString(), {
				totalAssets: snapshot.totalAssets,
				totalShares: snapshot.totalShares,
			}),
		})
	}
	return points
}

/* ── Activity ────────────────────────────────────────────── */

export function tradesFor(strategyId: string, limit: number): Trade[] {
	return db
		.select()
		.from(trades)
		.where(eq(trades.strategyId, strategyId))
		.orderBy(desc(trades.t))
		.limit(limit)
		.all()
		.map((row) => ({
			id: row.id,
			strategyId: row.strategyId,
			t: row.t.toISOString(),
			pair: row.pair,
			side: row.side,
			size: formatAmount(row.size),
			price: formatAmount(row.price),
			pnl: formatAmount(row.pnl),
			txHash: row.txHash,
		}))
}

export function executionsFor(strategyId: string, limit: number): Execution[] {
	return db
		.select()
		.from(executions)
		.where(eq(executions.strategyId, strategyId))
		.orderBy(desc(executions.t))
		.limit(limit)
		.all()
		.map((row) => ({
			id: row.id,
			strategyId: row.strategyId,
			t: row.t.toISOString(),
			status: row.status,
			action: row.action,
			targetWeightsBps: row.targetWeightsBps,
			reason: row.reason,
			pnlApplied: row.pnlApplied === null ? null : formatAmount(row.pnlApplied),
			txHash: row.txHash,
			durationMs: row.durationMs,
			error: row.error,
		}))
}
