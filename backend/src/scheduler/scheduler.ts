// The tick loop.
//
// `cre workflow simulate` fires its cron trigger exactly once and exits — the
// schedule in the config is validated but not honoured, and `--listen` is
// rejected for cron triggers — so the interval lives here, not in the CLI. A
// deployed workflow would be scheduled by the DON instead; this is the local
// stand-in for that.
//
// Three properties matter more than the loop itself:
//
//   staggered   ticks for n strategies are spread across the interval, so ten
//               strategies do not all start a minute-long compile on the same
//               second
//   bounded     at most `concurrency` simulations run at once, and a strategy
//               whose previous tick is still running is skipped rather than
//               queued on top of itself
//   isolated    one strategy throwing cannot stop another; every failure is
//               logged and written to that strategy's execution log

import { and, eq, isNotNull } from 'drizzle-orm'
import { db as defaultDb, type Db } from '../db/index.js'
import { strategies, type StrategyRow } from '../db/schema.js'
import { consoleLogger, type Logger } from '../strategy/ports.js'
import { schedulerConfig } from './config.js'
import { runTick, type TickDeps, type TickOutcome } from './tick.js'

export interface SchedulerOptions extends TickDeps {
	intervalMs?: number
	concurrency?: number
	/** Which strategies to tick. Defaults to every live one with a vault and an operator. */
	selectStrategies?: (db: Db) => StrategyRow[]
	/** Called after every tick, successful or not. Exceptions from it are logged, not propagated. */
	onTick?: (outcome: TickOutcome) => void
}

export interface SchedulerStatus {
	running: boolean
	intervalMs: number
	concurrency: number
	/** Strategy ids with a tick in progress. */
	inFlight: string[]
	ticks: number
	failures: number
	lastTickAt: string | null
}

export interface Scheduler {
	start(): void
	stop(): Promise<void>
	/** Runs one tick now, outside the timer. Awaits an in-flight tick for the same strategy first. */
	tickOnce(strategyId: string): Promise<TickOutcome>
	status(): SchedulerStatus
}

/** Live strategies the scheduler can tick: published, with a vault and an operator. */
export function defaultSelectStrategies(db: Db): StrategyRow[] {
	return db
		.select()
		.from(strategies)
		.where(
			and(
				eq(strategies.status, 'live'),
				isNotNull(strategies.vaultAddress),
				isNotNull(strategies.agentWalletKey),
			),
		)
		.all()
}

/**
 * Minimal counting semaphore. A finished slot is handed straight to the next
 * waiter rather than released and re-taken, so the count never dips between the
 * two and the bound cannot be briefly exceeded.
 */
function createPool(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
	let active = 0
	const waiting: Array<() => void> = []

	const release = (): void => {
		const next = waiting.shift()
		if (next) next()
		else active--
	}

	return async <T>(work: () => Promise<T>): Promise<T> => {
		if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
		else active++
		try {
			return await work()
		} finally {
			release()
		}
	}
}

export function createScheduler(options: SchedulerOptions): Scheduler {
	const db = options.db ?? defaultDb
	const logger = options.logger ?? consoleLogger
	const intervalMs = options.intervalMs ?? schedulerConfig.intervalMs
	const concurrency = options.concurrency ?? schedulerConfig.concurrency
	const select = options.selectStrategies ?? defaultSelectStrategies
	const withSlot = createPool(concurrency)
	const deps: TickDeps = { ...options, db, logger }

	const inFlight = new Map<string, Promise<TickOutcome>>()
	const pending = new Set<NodeJS.Timeout>()
	let cycleTimer: NodeJS.Timeout | null = null
	let running = false
	let ticks = 0
	let failures = 0
	let lastTickAt: string | null = null

	const report = (outcome: TickOutcome): void => {
		ticks++
		if (outcome.status === 'failed') failures++
		lastTickAt = new Date().toISOString()
		try {
			options.onTick?.(outcome)
		} catch (error) {
			logger.error({ err: error, strategyId: outcome.strategyId }, 'scheduler onTick callback threw')
		}
	}

	function tick(strategyId: string): Promise<TickOutcome> {
		const existing = inFlight.get(strategyId)
		if (existing) return existing

		const run = withSlot(() => runTick(strategyId, deps))
			.catch((error: unknown): TickOutcome => {
				// runTick writes its own execution row for anything it can attribute to
				// a tick. Reaching here means it could not even start — a missing row,
				// a broken pool — which is a defect, so it is logged in full and the
				// loop carries on with the other strategies.
				logger.error({ err: error, strategyId }, 'tick could not be run')
				return {
					strategyId,
					slug: strategyId,
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
					executionId: '',
					durationMs: 0,
					error: error instanceof Error ? error.message : String(error),
					log: [],
				}
			})
			.then((outcome) => {
				report(outcome)
				return outcome
			})
			.finally(() => {
				inFlight.delete(strategyId)
			})

		inFlight.set(strategyId, run)
		return run
	}

	function cycle(): void {
		if (!running) return

		let live: StrategyRow[] = []
		try {
			live = select(db)
		} catch (error) {
			// A failed read is not a reason to stop the loop; the next cycle retries.
			logger.error({ err: error }, 'could not list live strategies for this cycle')
		}

		if (live.length === 0) {
			logger.debug({}, 'scheduler cycle: no live strategies')
		}

		// Spread the cycle's ticks evenly across the interval. Recomputed every
		// cycle, so a strategy going live changes the spacing on the next one.
		live.forEach((strategy, index) => {
			const delay = Math.floor((index * intervalMs) / live.length)
			const timer = setTimeout(() => {
				pending.delete(timer)
				if (!running) return
				if (inFlight.has(strategy.id)) {
					logger.warn(
						{ strategyId: strategy.id, slug: strategy.slug },
						'previous tick still running; skipping this cycle',
					)
					return
				}
				void tick(strategy.id)
			}, delay)
			pending.add(timer)
		})

		cycleTimer = setTimeout(cycle, intervalMs)
	}

	return {
		start(): void {
			if (running) return
			running = true
			logger.info({ intervalMs, concurrency }, 'scheduler started')
			cycle()
		},

		async stop(): Promise<void> {
			running = false
			if (cycleTimer) clearTimeout(cycleTimer)
			cycleTimer = null
			for (const timer of pending) clearTimeout(timer)
			pending.clear()
			// In-flight ticks are left to finish: a simulation is already running in
			// a child process and its transactions may already be in the mempool.
			await Promise.allSettled([...inFlight.values()])
			logger.info({ ticks, failures }, 'scheduler stopped')
		},

		async tickOnce(strategyId: string): Promise<TickOutcome> {
			const existing = inFlight.get(strategyId)
			if (existing) {
				logger.info({ strategyId }, 'waiting for the in-flight tick before running another')
				await existing.catch(() => undefined)
			}
			return tick(strategyId)
		},

		status(): SchedulerStatus {
			return {
				running,
				intervalMs,
				concurrency,
				inFlight: [...inFlight.keys()],
				ticks,
				failures,
				lastTickAt,
			}
		},
	}
}
