// Building StrategyContexts, and comparing what comes back out of onTick.
// Shared by the determinism check and the backtester so both feed a strategy
// exactly the shape the enclave will.

import type {
	PriceSnapshot,
	StrategyContext,
	TickDecision,
} from '../../../shared/strategy-contract'

/** The runtime bounds `ctx.history` to the last 128 ticks; so do we. */
export const HISTORY_LIMIT = 128

export const BPS = 10_000

/** Converts a decimal price ("3421.50") to the 6dp bigint the contract carries. */
export function toPrice6(value: number | string): bigint {
	const text = typeof value === 'number' ? value.toFixed(6) : value.trim()
	const negative = text.startsWith('-')
	const unsigned = negative ? text.slice(1) : text
	const [whole = '0', fraction = ''] = unsigned.split('.')
	const scaled = BigInt(whole || '0') * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0')
	return negative ? -scaled : scaled
}

export const fromPrice6 = (value: bigint): number => Number(value) / 1e6

/** Turns a flat list of prices for one symbol into the tick-by-tick series. */
export function buildPriceSeries(
	symbol: string,
	prices: readonly (number | string)[],
	options: { startT?: number; stepSeconds?: number } = {},
): PriceSnapshot[][] {
	const startT = options.startT ?? 1_700_000_000
	const step = options.stepSeconds ?? 60
	return prices.map((price, index) => [
		{ symbol, price: toPrice6(price), t: startT + index * step },
	])
}

export interface MakeContextOptions {
	now: number
	totalAssets?: bigint
	prices: PriceSnapshot[]
	history?: PriceSnapshot[][]
	currentWeightsBps?: Record<string, number>
	secrets?: Record<string, string>
	onLog?: (message: string) => void
	onMissingSecret?: (id: string) => void
}

export function makeContext(options: MakeContextOptions): StrategyContext {
	const secrets = options.secrets ?? {}
	return {
		now: options.now,
		totalAssets: options.totalAssets ?? 1_000_000_000n,
		prices: options.prices,
		history: (options.history ?? []).slice(-HISTORY_LIMIT),
		currentWeightsBps: options.currentWeightsBps ?? {},
		getSecret: (id: string): string => {
			const value = secrets[id]
			if (value === undefined) {
				// Not an error: a strategy is expected to fall back to its public
				// default. Surfaced so callers can report which ids were requested.
				options.onMissingSecret?.(id)
				return ''
			}
			return value
		},
		log: (message: string): void => {
			options.onLog?.(message)
		},
	}
}

// A price path that rises, stalls, and falls, so a trend follower and a mean
// reverter both take a real branch rather than sitting in their warm-up.
const PROBE_PRICES = [
	2000, 2010, 2035, 2028, 2061, 2090, 2072, 2115, 2140, 2131, 2168, 2190, 2175, 2210, 2244,
	2231, 2205, 2180, 2196, 2150, 2118, 2141, 2099, 2064, 2081, 2030, 1998, 2016, 1972, 1940,
]

/**
 * One fixed context, used twice by the determinism check. Deliberately a single
 * object rather than two equal ones: a strategy that mutates the context it is
 * given is non-deterministic in exactly the way that matters, and reusing the
 * object is what exposes it.
 */
export function probeContext(symbol = 'ETH'): StrategyContext {
	const series = buildPriceSeries(symbol, PROBE_PRICES)
	const prices = series[series.length - 1] ?? []
	return makeContext({
		now: prices[0]?.t ?? 1_700_000_000,
		totalAssets: 1_000_000_000n,
		prices,
		history: series.slice(0, -1),
		currentWeightsBps: { [symbol]: 5_000 },
		secrets: { PROBE_SECRET: 'probe' },
	})
}

/** Structural serialisation that survives bigint, which JSON.stringify does not. */
export function stableSerialise(value: unknown): string {
	if (typeof value === 'bigint') return `${value}n`
	if (typeof value === 'undefined') return 'undefined'
	if (typeof value === 'function') return `[function ${value.name}]`
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
	if (Array.isArray(value)) return `[${value.map(stableSerialise).join(',')}]`

	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialise(item)}`).join(',')}}`
}

export interface NormalisedWeights {
	weightsBps: Record<string, number>
	/** True when the decision had to be corrected to satisfy the contract. */
	adjusted: boolean
}

/**
 * Clamps a decision's weights onto the declared assets and the 0..10000 range,
 * scaling down proportionally if they oversubscribe the book. The contract says
 * weights "must sum to <= 10000"; a strategy that breaks that gets corrected
 * rather than crashing the run, because a bad strategy still has to produce a
 * NAV curve.
 */
export function normaliseWeights(
	decision: TickDecision,
	declaredAssets: readonly string[],
): NormalisedWeights {
	const allowed = new Set(declaredAssets)
	const weightsBps: Record<string, number> = {}
	let adjusted = false
	let total = 0

	for (const [symbol, raw] of Object.entries(decision.targetWeightsBps ?? {})) {
		if (!allowed.has(symbol)) {
			adjusted = true
			continue
		}
		const value = Number.isFinite(raw) ? Math.round(raw) : 0
		const clamped = Math.min(Math.max(value, 0), BPS)
		if (clamped !== raw) adjusted = true
		if (clamped === 0) continue
		weightsBps[symbol] = clamped
		total += clamped
	}

	if (total > BPS) {
		adjusted = true
		for (const symbol of Object.keys(weightsBps)) {
			weightsBps[symbol] = Math.floor(((weightsBps[symbol] ?? 0) * BPS) / total)
		}
	}

	return { weightsBps, adjusted }
}
