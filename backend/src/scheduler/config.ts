// Tick loop settings. Every one of them is an operational knob — how often, how
// many at once, what the venue charges — and none of them is a performance
// figure: what a strategy earns comes out of its own weights applied to prices
// it does not control.

import { z } from 'zod'
import { DEFAULT_FEE_BPS, HISTORY_LIMIT } from '../../../chainlink/strategy-toolkit/src/index.js'

const schema = z.object({
	/** Milliseconds between ticks for any one strategy. */
	TICK_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),
	/**
	 * Strategies simulating at once. A `cre workflow simulate` is a bun compile
	 * plus a WASM run — CPU-bound and minute-scale — so this is small on purpose.
	 */
	SCHEDULER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
	/**
	 * Venue cost charged on turnover, in bps. Same default and same meaning as the
	 * backtester's, so a strategy's live curve and its backtest are comparable.
	 */
	TICK_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(DEFAULT_FEE_BPS),
	/** Prior snapshots handed to the strategy. The runtime bounds ctx.history to 128. */
	TICK_HISTORY_LIMIT: z.coerce.number().int().min(1).max(HISTORY_LIMIT).default(HISTORY_LIMIT),
	/** Start the loop when the server boots. Off in tests, which drive tickOnce(). */
	SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
	console.error('invalid scheduler environment', parsed.error.flatten().fieldErrors)
	throw new Error('invalid scheduler environment: see the field errors logged above')
}

const raw = parsed.data

export const schedulerConfig = {
	intervalMs: raw.TICK_INTERVAL_MS,
	concurrency: raw.SCHEDULER_CONCURRENCY,
	feeBps: raw.TICK_FEE_BPS,
	historyLimit: raw.TICK_HISTORY_LIMIT,
	enabled: raw.SCHEDULER_ENABLED === 'true',
} as const

export type SchedulerConfig = typeof schedulerConfig
