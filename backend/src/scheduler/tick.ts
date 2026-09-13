// One tick for one strategy: the loop the whole product's numbers come out of.
//
//   1  advance the price oracle
//   2  read the vault
//   3  run the strategy's own workflow inside the simulated enclave, or, if the
//      cre CLI cannot run it, in-process — and say on the record which happened
//   4  price the decision against the interval's price move
//   5  settle it with applyPnl, and publish the legs with recordTrade
//   6  snapshot NAV and write the execution row
//
// Every exit from this function writes an execution row. A tick that failed is
// a tick that happened, and the execution log is the only place a creator or an
// investor can see that it did.

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Address, Hex } from 'viem'
import {
	loadStrategy,
	makeContext,
	normaliseWeights,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import type { PriceSnapshot, StrategyModule, TickDecision } from '../../../shared/strategy-contract.js'
import { db as defaultDb, type Db } from '../db/index.js'
import { executions, navSnapshots, strategies, trades, type StrategyRow } from '../db/schema.js'
import { discoverSecretIds } from '../strategy/secrets.js'
import { creAvailable, failureDetail, simulateWorkspace } from '../strategy/simulate.js'
import { ensureWorkflow, sourceFingerprint } from '../strategy/workspace.js'
import { schedulerConfig } from './config.js'
import { clampPnl, priceDecision, type PricedDecision } from './pricing.js'
import { consoleLogger, priceMap, type ChainPort, type Logger, type OraclePort } from './ports.js'
import {
	fromPriceStrings,
	readTickState,
	toPriceStrings,
	weightsFromLastExecution,
	writeTickState,
	type DecisionSource,
} from './state.js'

export interface TickDeps {
	chain: ChainPort
	oracle: OraclePort
	db?: Db
	logger?: Logger
	feeBps?: number
	historyLimit?: number
	/** Values for the strategy's secret ids. Locally the platform holds none. */
	secretValues?: Record<string, string>
}

export interface TickOutcome {
	strategyId: string
	slug: string
	status: 'ok' | 'failed'
	/** Which path produced the decision. Null when no decision was reached. */
	source: DecisionSource | null
	decision: TickDecision | null
	weightsBps: Record<string, number>
	/** Signed 6dp delta actually settled on-chain. */
	pnlApplied: string | null
	/** Before clamping to what the vault could settle. */
	pnlComputed: string | null
	txHash: Hex | null
	tradeTxHashes: Hex[]
	navPerShare: string | null
	totalAssets: string | null
	totalShares: string | null
	executionId: string
	durationMs: number
	error: string | null
	log: string[]
}

/** How a decision's source is written onto the execution row. */
export const formatReason = (source: DecisionSource, reason: string): string => `[${source}] ${reason}`

export const parseReason = (
	text: string | null,
): { source: DecisionSource | null; reason: string } => {
	if (!text) return { source: null, reason: '' }
	const match = /^\[(cre-simulate|local-fallback)]\s?(.*)$/s.exec(text)
	if (!match) return { source: null, reason: text }
	return { source: match[1] as DecisionSource, reason: match[2] ?? '' }
}

// Loading a strategy compiles it and evaluates it in a fresh vm context. That is
// milliseconds, but it is milliseconds per tick per strategy for a result that
// only changes when the source does.
const moduleCache = new Map<string, StrategyModule>()

function strategyModule(source: string): StrategyModule {
	const hash = sourceFingerprint(source)
	const cached = moduleCache.get(hash)
	if (cached) return cached
	const loaded = loadStrategy(source)
	moduleCache.set(hash, loaded)
	return loaded
}

// The oracle is a single seeded walk shared by every strategy, so advancing it
// is serialised: two ticks stepping it at once would interleave into a series
// neither of them saw. The enclave fetches prices over HTTP during its own run,
// which is after the gate has been released — with staggered ticks it reads the
// snapshot this tick advanced to, and under heavy overlap it may read a
// neighbouring one. The prices this tick records are the ones it advanced to.
let oracleGate: Promise<unknown> = Promise.resolve()

function throughOracleGate<T>(work: () => Promise<T>): Promise<T> {
	const next = oracleGate.then(work, work)
	oracleGate = next.then(
		() => undefined,
		() => undefined,
	)
	return next
}

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

export function loadStrategyRow(db: Db, strategyId: string): StrategyRow | null {
	return db.select().from(strategies).where(eq(strategies.id, strategyId)).get() ?? null
}

export async function runTick(strategyId: string, deps: TickDeps): Promise<TickOutcome> {
	const db = deps.db ?? defaultDb
	const logger = deps.logger ?? consoleLogger
	const feeBps = deps.feeBps ?? schedulerConfig.feeBps
	const historyLimit = deps.historyLimit ?? schedulerConfig.historyLimit
	const startedAt = Date.now()
	const executionId = randomUUID()
	const log: string[] = []

	const strategy = loadStrategyRow(db, strategyId)
	if (!strategy) throw new Error(`no strategy ${strategyId}`)

	const outcome: TickOutcome = {
		strategyId,
		slug: strategy.slug,
		status: 'failed',
		source: null,
		decision: null,
		weightsBps: {},
		pnlApplied: null,
		pnlComputed: null,
		txHash: null,
		tradeTxHashes: [],
		navPerShare: null,
		totalAssets: null,
		totalShares: null,
		executionId,
		durationMs: 0,
		error: null,
		log,
	}

	try {
		if (!strategy.sourceCode) throw new Error('strategy has no source code')
		if (!strategy.vaultAddress) throw new Error('strategy has no vault')
		if (!strategy.agentWalletKey) throw new Error('strategy has no agent wallet')

		const vaultAddress = strategy.vaultAddress as Address
		const operatorKey = strategy.agentWalletKey as Hex
		const module = strategyModule(strategy.sourceCode)
		const declaredAssets = module.describe().assets

		// ── 1 advance the oracle ────────────────────────────────
		const snapshot = await throughOracleGate(() =>
			deps.oracle.advance({ symbols: declaredAssets, historyLimit }),
		)
		const currentPrices = priceMap(snapshot.prices)

		// ── 2 read the vault ────────────────────────────────────
		const before = await deps.chain.readVault(vaultAddress)

		// ── previous interval ───────────────────────────────────
		const state = await readTickState(strategy.slug, logger)
		const previousWeightsBps = state?.weightsBps ?? weightsFromLastExecution(db, strategyId)
		const previousPrices = state ? fromPriceStrings(state.prices) : {}
		if (!state) {
			log.push('no cached tick state: pricing this tick with no measured price move')
		}

		// ── 3 the decision ──────────────────────────────────────
		const produced = await decide({
			strategy,
			module,
			source: strategy.sourceCode,
			snapshot: { prices: snapshot.prices, history: snapshot.history, t: snapshot.t },
			totalAssets: before.totalManagedAssets,
			currentWeightsBps: previousWeightsBps,
			secretValues: deps.secretValues,
			logger,
			log,
		})
		outcome.source = produced.source
		outcome.decision = produced.decision

		const { weightsBps, adjusted } = normaliseWeights(produced.decision, declaredAssets)
		outcome.weightsBps = weightsBps
		if (adjusted) {
			log.push('decision weights were clamped onto the declared assets and the 0..10000 range')
		}

		// ── 4 price it ──────────────────────────────────────────
		const priced: PricedDecision = priceDecision({
			totalManagedAssets: before.totalManagedAssets,
			previousWeightsBps,
			targetWeightsBps: weightsBps,
			previousPrices,
			currentPrices,
			feeBps,
		})
		outcome.pnlComputed = priced.netPnl.toString()

		const clamped = clampPnl(priced.netPnl, before)
		outcome.pnlApplied = clamped.applied.toString()
		if (clamped.note) {
			logger.warn({ strategyId, slug: strategy.slug, note: clamped.note }, 'pnl was capped by the vault')
			log.push(clamped.note)
		}

		// ── 5 settle ────────────────────────────────────────────
		const applied = await deps.chain.applyPnl({
			vaultAddress,
			operatorKey,
			delta: clamped.applied,
		})
		outcome.txHash = applied.txHash

		const at = new Date()
		for (const trade of priced.trades) {
			const receipt = await deps.chain.recordTrade({
				vaultAddress,
				operatorKey,
				pair: trade.pair,
				isBuy: trade.side === 'buy',
				size: trade.notional,
				price: trade.price,
				pnl: trade.pnl,
			})
			outcome.tradeTxHashes.push(receipt.txHash)
			db.insert(trades)
				.values({
					id: randomUUID(),
					strategyId,
					t: at,
					pair: trade.pair,
					side: trade.side,
					size: trade.notional.toString(),
					price: trade.price.toString(),
					pnl: trade.pnl.toString(),
					txHash: receipt.txHash,
				})
				.run()
		}

		// ── 6 snapshot and record ───────────────────────────────
		const after = await deps.chain.readVault(vaultAddress)
		outcome.navPerShare = after.navPerShare.toString()
		outcome.totalAssets = after.totalManagedAssets.toString()
		outcome.totalShares = after.totalShares.toString()

		db.insert(navSnapshots)
			.values({
				id: randomUUID(),
				strategyId,
				t: at,
				navPerShare: after.navPerShare.toString(),
				totalAssets: after.totalManagedAssets.toString(),
				totalShares: after.totalShares.toString(),
			})
			.run()

		outcome.status = 'ok'
		outcome.durationMs = Date.now() - startedAt

		db.insert(executions)
			.values({
				id: executionId,
				strategyId,
				t: at,
				status: 'ok',
				action: produced.decision.action,
				targetWeightsBps: weightsBps,
				reason: formatReason(produced.source, produced.decision.reason),
				pnlApplied: clamped.applied.toString(),
				txHash: applied.txHash,
				durationMs: outcome.durationMs,
				error: null,
			})
			.run()

		await writeTickState(
			{
				strategyId,
				slug: strategy.slug,
				t: at.getTime(),
				weightsBps,
				prices: toPriceStrings(currentPrices),
				navPerShare: after.navPerShare.toString(),
				source: produced.source,
			},
			logger,
		)

		logger.info(
			{
				strategyId,
				slug: strategy.slug,
				source: produced.source,
				action: produced.decision.action,
				weightsBps,
				marketPnl: priced.marketPnl.toString(),
				fee: priced.fee.toString(),
				pnlApplied: clamped.applied.toString(),
				navPerShare: outcome.navPerShare,
				txHash: applied.txHash,
				durationMs: outcome.durationMs,
			},
			'tick settled',
		)

		return outcome
	} catch (error) {
		outcome.status = 'failed'
		outcome.error = errorText(error)
		outcome.durationMs = Date.now() - startedAt
		logger.error({ err: error, strategyId, slug: strategy.slug }, 'tick failed')

		try {
			db.insert(executions)
				.values({
					id: executionId,
					strategyId,
					t: new Date(),
					status: 'failed',
					action: outcome.decision?.action ?? null,
					targetWeightsBps: Object.keys(outcome.weightsBps).length > 0 ? outcome.weightsBps : null,
					reason: outcome.source && outcome.decision
						? formatReason(outcome.source, outcome.decision.reason)
						: null,
					pnlApplied: outcome.pnlApplied,
					txHash: outcome.txHash,
					durationMs: outcome.durationMs,
					error: outcome.error,
				})
				.run()
		} catch (writeError) {
			// The tick already failed; losing its execution row too would make the
			// failure invisible, so it is logged loudly rather than rethrown over
			// the original error.
			logger.error({ err: writeError, strategyId }, 'could not record the failed execution')
		}

		return outcome
	}
}

interface DecideInput {
	strategy: StrategyRow
	module: StrategyModule
	source: string
	snapshot: { prices: PriceSnapshot[]; history: PriceSnapshot[][]; t: number }
	totalAssets: bigint
	currentWeightsBps: Record<string, number>
	secretValues?: Record<string, string>
	logger: Logger
	log: string[]
}

interface Decided {
	decision: TickDecision
	source: DecisionSource
}

/**
 * The enclave first, the local loader second. A fallback is never dressed up as
 * an enclave run: the source lands on the execution row, so an investor reading
 * the log can tell which decisions were attested and which were not.
 */
async function decide(input: DecideInput): Promise<Decided> {
	const { logger, log, strategy } = input

	if (creAvailable()) {
		try {
			const workspace = await ensureWorkflow({
				scope: 'strategies',
				key: strategy.slug,
				source: input.source,
				secretIds: discoverSecretIds(input.module, {
					prices: input.snapshot.prices,
					history: input.snapshot.history,
					now: input.snapshot.t,
					totalAssets: input.totalAssets,
					logger,
				}),
				secretValues: input.secretValues,
				logger,
				tick: {
					totalAssets: input.totalAssets.toString(),
					currentWeightsBps: input.currentWeightsBps,
				},
			})

			const simulation = await simulateWorkspace(workspace, { logger })
			for (const line of simulation.log) log.push(line)

			// The anchored hash is the strategy's identity. A run whose binary hashes
			// differently is no longer the code the registry vouches for, so the
			// divergence is stated on the execution rather than left to be inferred.
			if (
				simulation.binaryHash &&
				strategy.binaryHash &&
				simulation.binaryHash.toLowerCase() !== strategy.binaryHash.toLowerCase().replace(/^0x/, '')
			) {
				logger.warn(
					{
						strategyId: strategy.id,
						slug: strategy.slug,
						anchored: strategy.binaryHash,
						simulated: simulation.binaryHash,
					},
					'the simulated binary does not match the hash anchored on-chain',
				)
				log.push(
					`binary hash ${simulation.binaryHash} does not match the anchored ${strategy.binaryHash}`,
				)
			}

			if (simulation.ok && simulation.decision) {
				return { decision: simulation.decision, source: 'cre-simulate' }
			}

			const detail = failureDetail(simulation)
			logger.warn(
				{ strategyId: strategy.id, slug: strategy.slug, detail },
				'cre simulate did not return a decision; falling back to the local runner',
			)
			log.push(`cre simulate failed, falling back to the local runner: ${detail}`)
		} catch (error) {
			logger.error(
				{ err: error, strategyId: strategy.id, slug: strategy.slug },
				'cre simulate could not be started; falling back to the local runner',
			)
			log.push(`cre simulate could not be started, falling back to the local runner: ${errorText(error)}`)
		}
	} else {
		log.push('cre CLI unavailable: this decision came from the local runner, not an enclave')
	}

	const secrets = input.secretValues ?? {}
	const ctx = makeContext({
		now: input.snapshot.t,
		totalAssets: input.totalAssets,
		prices: input.snapshot.prices,
		history: input.snapshot.history,
		currentWeightsBps: input.currentWeightsBps,
		secrets,
		onLog: (message) => log.push(message),
		onMissingSecret: (id) => log.push(`strategy asked for the unset secret ${id}`),
	})

	return { decision: input.module.onTick(ctx), source: 'local-fallback' }
}
