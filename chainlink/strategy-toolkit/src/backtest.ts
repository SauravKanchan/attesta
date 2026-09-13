// Running a strategy over a price series to get its NAV curve.
//
// This is the piece that makes a listing's numbers real. APY, total return and
// drawdown are derived here from the weights the strategy itself chose, applied
// to prices it did not control — never stored as inputs. A strategy shows a
// negative return because it picked badly, which is also why the marketplace
// needs a strategy that does.
//
// Pure: no chain, no clock, no I/O. NAV is carried as a double because this is
// analytics rather than settlement; the on-chain path uses the vault's integer
// share maths instead.

import type {
	PriceSnapshot,
	StrategyAction,
	StrategyModule,
	TickDecision,
} from '../../../shared/strategy-contract'
import { BPS, fromPrice6, HISTORY_LIMIT, makeContext, normaliseWeights } from './context'
import { errorText } from './runtime-checks'

/** Venue cost charged on turnover. 30bps is the Uniswap v2 fee tier. */
export const DEFAULT_FEE_BPS = 30

export interface BacktestOptions {
	/** Starting USDC under management, 6dp. Default 1,000 USDC. */
	initialAssets?: bigint
	/** Cost per unit of turnover, in bps. Set 0 for a frictionless run. */
	feeBps?: number
	/** Secrets the strategy may read. Unset ids come back as an empty string. */
	secrets?: Record<string, string>
	/** Allocation the strategy starts from. Default: all USDC. */
	startingWeightsBps?: Record<string, number>
	historyLimit?: number
}

export interface BacktestTick {
	t: number
	action: StrategyAction
	reason: string
	/** Weights after clamping onto the declared assets. */
	weightsBps: Record<string, number>
	/** Fraction of the book traded into this allocation, 0..1. */
	turnover: number
	/** Assets under management at the close of the tick, 6dp. */
	assets: bigint
	/** NAV indexed to 1.0 at inception. */
	nav: number
}

export interface BacktestResult {
	ticks: BacktestTick[]
	/** NAV indexed to 1.0, one point per tick — the sparkline the UI draws. */
	navSeries: number[]
	initialAssets: bigint
	finalAssets: bigint
	/** Cumulative return as a fraction: 0.42 is +42%. */
	totalReturn: number
	/** Largest peak-to-trough decline, as a negative fraction. */
	maxDrawdown: number
	/** Mean per-tick turnover, 0..1. */
	averageTurnover: number
	/** Ticks on which the allocation actually moved. */
	tradeCount: number
	/** Decisions the runner had to correct to satisfy the contract. */
	adjustedDecisions: number
	/** Secret ids the strategy asked for that were not supplied. */
	requestedSecrets: string[]
	logs: string[]
}

const priceOf = (snapshot: readonly PriceSnapshot[], symbol: string): bigint | null => {
	for (const entry of snapshot) if (entry.symbol === symbol) return entry.price
	return null
}

const turnoverBetween = (
	from: Record<string, number>,
	to: Record<string, number>,
): number => {
	let moved = 0
	for (const symbol of new Set([...Object.keys(from), ...Object.keys(to)])) {
		moved += Math.abs((to[symbol] ?? 0) - (from[symbol] ?? 0))
	}
	return moved / BPS
}

export function runBacktest(
	mod: StrategyModule,
	priceSeries: readonly PriceSnapshot[][],
	options: BacktestOptions = {},
): BacktestResult {
	const initialAssets = options.initialAssets ?? 1_000_000_000n
	const feeBps = options.feeBps ?? DEFAULT_FEE_BPS
	const historyLimit = options.historyLimit ?? HISTORY_LIMIT
	const declaredAssets = mod.describe().assets

	const logs: string[] = []
	const requestedSecrets = new Set<string>()

	let nav = 1
	let weightsBps: Record<string, number> = { ...(options.startingWeightsBps ?? {}) }
	let tradeCount = 0
	let adjustedDecisions = 0
	let turnoverTotal = 0

	const ticks: BacktestTick[] = []

	for (let index = 0; index < priceSeries.length; index++) {
		const snapshot = priceSeries[index] ?? []
		const previous = index > 0 ? priceSeries[index - 1] : undefined

		// Yesterday's weights earn today's move. Marking to market before asking
		// for a new decision is what stops a strategy from trading on a price it
		// has already been paid for.
		if (previous) {
			let change = 0
			for (const [symbol, weight] of Object.entries(weightsBps)) {
				const now = priceOf(snapshot, symbol)
				const before = priceOf(previous, symbol)
				if (now === null || before === null || before === 0n) continue
				change += (weight / BPS) * (fromPrice6(now) / fromPrice6(before) - 1)
			}
			nav *= 1 + change
		}

		const ctx = makeContext({
			now: snapshot[0]?.t ?? index,
			totalAssets: scaleAssets(initialAssets, nav),
			prices: [...snapshot],
			history: priceSeries.slice(Math.max(0, index - historyLimit), index).map((tick) => [...tick]),
			currentWeightsBps: { ...weightsBps },
			secrets: options.secrets,
			onLog: (message) => logs.push(`[${index}] ${message}`),
			onMissingSecret: (id) => requestedSecrets.add(id),
		})

		let decision: TickDecision
		try {
			decision = mod.onTick(ctx)
		} catch (error) {
			// A throwing tick is a real outcome, not a reason to abandon the run:
			// the strategy holds whatever it held and the failure is on the record.
			logs.push(`[${index}] onTick() threw: ${errorText(error)}`)
			decision = { action: 'HOLD', targetWeightsBps: { ...weightsBps }, reason: 'onTick() threw' }
		}

		const { weightsBps: target, adjusted } = normaliseWeights(decision, declaredAssets)
		if (adjusted) adjustedDecisions++

		const turnover = turnoverBetween(weightsBps, target)
		if (turnover > 0) {
			tradeCount++
			nav *= 1 - (turnover * feeBps) / BPS
		}
		turnoverTotal += turnover
		weightsBps = target

		ticks.push({
			t: ctx.now,
			action: decision.action,
			reason: decision.reason,
			weightsBps: { ...target },
			turnover,
			assets: scaleAssets(initialAssets, nav),
			nav,
		})
	}

	const navSeries = ticks.map((tick) => tick.nav)

	return {
		ticks,
		navSeries,
		initialAssets,
		finalAssets: scaleAssets(initialAssets, nav),
		totalReturn: nav - 1,
		maxDrawdown: maxDrawdown(navSeries),
		averageTurnover: ticks.length > 0 ? turnoverTotal / ticks.length : 0,
		tradeCount,
		adjustedDecisions,
		requestedSecrets: [...requestedSecrets],
		logs,
	}
}

const scaleAssets = (initial: bigint, nav: number): bigint =>
	BigInt(Math.max(0, Math.round(Number(initial) * nav)))

/** Largest peak-to-trough decline over the series, as a negative fraction. */
export function maxDrawdown(navSeries: readonly number[]): number {
	let peak = Number.NEGATIVE_INFINITY
	let worst = 0
	for (const nav of navSeries) {
		if (nav > peak) peak = nav
		if (peak > 0) worst = Math.min(worst, nav / peak - 1)
	}
	return worst
}

/**
 * Annualised return from a NAV series sampled every `secondsPerTick`. Null until
 * there is enough history for the number to mean anything.
 */
export function annualisedReturn(
	navSeries: readonly number[],
	secondsPerTick: number,
): number | null {
	const first = navSeries[0]
	const last = navSeries[navSeries.length - 1]
	if (navSeries.length < 2 || first === undefined || last === undefined || first <= 0) return null

	const elapsedYears = ((navSeries.length - 1) * secondsPerTick) / (365 * 24 * 60 * 60)
	if (elapsedYears <= 0) return null

	const annualised = (last / first) ** (1 / elapsedYears) - 1
	// Compounding a short window up to a year overflows to Infinity long before
	// the number stops being meaningful. `apy` is `number | null`, and Infinity
	// would reach the client as `null` anyway via JSON.stringify — return the
	// null explicitly rather than emitting a value the field cannot carry.
	return Number.isFinite(annualised) ? annualised : null
}
