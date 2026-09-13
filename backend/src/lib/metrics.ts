// Performance metrics derived from a strategy's NAV-per-share series.
//
// These are the numbers the whole product rests on, so every function here is pure: same
// series in, same value out, no clock, no database. A metric is null when the history is
// too short to state it honestly — never zero, which would read as "flat" rather than
// "unknown".

import { formatAmount } from './money.js'

export interface NavPoint {
	/** Unix milliseconds. */
	t: number
	/** NAV per share as a float. Fine here: metrics are ratios, not balances. */
	nav: number
}

export interface MetricsResult {
	apy: number | null
	totalReturn: number | null
	maxDrawdown: number | null
	sharpe: number | null
}

export const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

/**
 * Annualising a few seconds of history yields numbers like 1e40, so a series must span at
 * least this long before APY and Sharpe are reported. One tick of the default 60s loop.
 */
export const MIN_SPAN_MS = 60_000

export interface MetricsOptions {
	minSpanMs?: number
	/** Annual risk-free rate as a fraction. Zero locally — there is no local T-bill. */
	riskFreeRate?: number
}

export function computeMetrics(series: readonly NavPoint[], options: MetricsOptions = {}): MetricsResult {
	const points = normalise(series)
	return {
		apy: apy(points, options),
		totalReturn: totalReturn(points),
		maxDrawdown: maxDrawdown(points),
		sharpe: sharpe(points, options),
	}
}

/** Cumulative return since the first snapshot, as a fraction (0.42 = +42%). */
export function totalReturn(series: readonly NavPoint[]): number | null {
	const points = normalise(series)
	const first = points[0]
	const last = points[points.length - 1]
	if (!first || !last || points.length < 2) return null
	if (first.nav <= 0) return null
	return last.nav / first.nav - 1
}

/**
 * Return annualised from the observed span, whatever that span happens to be — the tick
 * interval is never assumed, so a 90-second history and a 90-day history are both handled.
 */
export function apy(series: readonly NavPoint[], options: MetricsOptions = {}): number | null {
	const minSpanMs = options.minSpanMs ?? MIN_SPAN_MS
	const points = normalise(series)
	const first = points[0]
	const last = points[points.length - 1]
	if (!first || !last || points.length < 2) return null
	if (first.nav <= 0) return null

	const spanMs = last.t - first.t
	if (spanMs < minSpanMs) return null

	// A vault worth nothing is -100% however long it took to get there; the power below
	// would be NaN for a non-positive ratio.
	if (last.nav <= 0) return -1

	const years = spanMs / MS_PER_YEAR
	const annualised = (last.nav / first.nav) ** (1 / years) - 1
	return Number.isFinite(annualised) ? annualised : null
}

/** Largest peak-to-trough decline as a negative fraction; 0 when the series never fell. */
export function maxDrawdown(series: readonly NavPoint[]): number | null {
	const points = normalise(series)
	if (points.length < 2) return null

	let peak = Number.NEGATIVE_INFINITY
	let worst = 0
	for (const point of points) {
		if (point.nav > peak) peak = point.nav
		if (peak <= 0) continue
		const decline = point.nav / peak - 1
		if (decline < worst) worst = decline
	}
	return worst
}

/**
 * Annualised Sharpe over per-tick returns, scaled by the square root of the observed tick
 * rate. Null when volatility is zero, where the ratio is undefined rather than infinite.
 */
export function sharpe(series: readonly NavPoint[], options: MetricsOptions = {}): number | null {
	const minSpanMs = options.minSpanMs ?? MIN_SPAN_MS
	const riskFreeRate = options.riskFreeRate ?? 0
	const points = normalise(series)
	if (points.length < 3) return null

	const first = points[0]
	const last = points[points.length - 1]
	if (!first || !last) return null

	const spanMs = last.t - first.t
	if (spanMs < minSpanMs) return null

	const returns: number[] = []
	for (let i = 1; i < points.length; i += 1) {
		const previous = points[i - 1]
		const current = points[i]
		if (!previous || !current) return null
		if (previous.nav <= 0) return null
		returns.push(current.nav / previous.nav - 1)
	}
	if (returns.length < 2) return null

	const mean = returns.reduce((total, value) => total + value, 0) / returns.length
	const variance =
		returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1)
	const stdDev = Math.sqrt(variance)
	if (stdDev === 0) return null

	const periodsPerYear = MS_PER_YEAR / (spanMs / returns.length)
	const value = (mean * periodsPerYear - riskFreeRate) / (stdDev * Math.sqrt(periodsPerYear))
	return Number.isFinite(value) ? value : null
}

/** nav_snapshots rows -> a metrics series. NAV is stored as 6dp base units. */
export function toNavSeries(
	rows: ReadonlyArray<{ t: Date | number; navPerShare: string }>,
): NavPoint[] {
	return rows.map((row) => ({
		t: row.t instanceof Date ? row.t.getTime() : row.t,
		nav: Number(formatAmount(row.navPerShare)),
	}))
}

function normalise(series: readonly NavPoint[]): NavPoint[] {
	for (const point of series) {
		if (!Number.isFinite(point.t) || !Number.isFinite(point.nav)) {
			throw new TypeError(`nav series contains a non-finite point: ${JSON.stringify(point)}`)
		}
	}
	return [...series].sort((a, b) => a.t - b.t)
}
