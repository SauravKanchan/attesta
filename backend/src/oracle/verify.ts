// Proof that the oracle is both reproducible and interesting.
//
// Prints a backfill, twenty live ticks, and the statistics that matter for the product:
// the walk must be bit-identical across runs, and it must contain trending and choppy
// stretches, or momentum and mean reversion would score the same on it and every listing
// in the marketplace would look alike.
//
// Run with `npm run verify:oracle`.

import { closeDatabase, migrateToLatest } from '../db/index.js'
import {
	DEFAULT_BACKFILL_TICKS,
	SYMBOLS,
	current,
	ensureBackfilled,
	formatPrice,
	fromBaseUnits,
	history,
	seriesFor,
	tick,
} from './index.js'
import { ORACLE_SEED, walkSteps, type Regime } from './walk.js'

const SAMPLE_TICKS = 20

function pct(value: number): string {
	return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

/** Lag-1 autocorrelation: positive means trending, negative means mean-reverting. */
function autocorrelation(returns: readonly number[]): number {
	if (returns.length < 3) return Number.NaN
	const mean = returns.reduce((total, value) => total + value, 0) / returns.length
	let covariance = 0
	let variance = 0
	for (let i = 1; i < returns.length; i += 1) {
		covariance += (returns[i] as number - mean) * (returns[i - 1] as number - mean)
	}
	for (const value of returns) variance += (value - mean) ** 2
	return variance === 0 ? Number.NaN : covariance / variance
}

function reportWalkStatistics(count: number): void {
	const steps = walkSteps(count, ORACLE_SEED)

	console.log(`\nwalk statistics over ${count} steps (${(count / 60 / 24).toFixed(1)} days)`)
	console.log(
		'  symbol   start        end          low          high        change    acf(all)  acf(chop)  acf(trend)',
	)

	for (const symbol of SYMBOLS) {
		const series = steps.map((step) => {
			const entry = step.prices.find((price) => price.symbol === symbol)
			if (!entry) throw new Error(`walk produced no price for ${symbol}`)
			return { price: fromBaseUnits(entry.price), regime: entry.regime }
		})

		const prices = series.map((point) => point.price)
		const first = prices[0] as number
		const last = prices[prices.length - 1] as number

		const all: number[] = []
		const chop: number[] = []
		const trend: number[] = []
		const regimeSteps = new Map<Regime, number>()
		for (let i = 1; i < series.length; i += 1) {
			const previous = series[i - 1] as { price: number; regime: Regime }
			const point = series[i] as { price: number; regime: Regime }
			const change = point.price / previous.price - 1
			all.push(change)
			if (point.regime === 'choppy') chop.push(change)
			else trend.push(change)
			regimeSteps.set(point.regime, (regimeSteps.get(point.regime) ?? 0) + 1)
		}

		console.log(
			`  ${symbol.padEnd(8)} ${first.toFixed(2).padStart(11)} ${last.toFixed(2).padStart(12)} ` +
				`${Math.min(...prices).toFixed(2).padStart(12)} ${Math.max(...prices).toFixed(2).padStart(12)} ` +
				`${pct(last / first - 1).padStart(9)}  ${autocorrelation(all).toFixed(4).padStart(8)}  ` +
				`${autocorrelation(chop).toFixed(4).padStart(9)}  ${autocorrelation(trend).toFixed(4).padStart(10)}`,
		)
		console.log(
			`           regimes: ${[...regimeSteps.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([regime, count]) => `${regime} ${count}`)
				.join(', ')}`,
		)
	}

	console.log(
		'\n  acf(chop) < 0 and acf(trend) > 0 is the point: a mean reverter earns in chop, a',
	)
	console.log('  momentum strategy earns in trends, and the two diverge on the same series.')
}

function reportDeterminism(): void {
	const fingerprint = (): string =>
		walkSteps(64, ORACLE_SEED)
			.map((step) => step.prices.map((price) => price.price.toString()).join(','))
			.join('|')
	const first = fingerprint()
	const second = fingerprint()
	console.log(`\ndeterminism: two independent replays of 64 steps are identical: ${first === second}`)
	if (first !== second) throw new Error('the price walk is not deterministic')
}

function main(): void {
	migrateToLatest()

	const backfilled = ensureBackfilled()
	const snapshot = current()
	console.log(`backfilled ticks in the database: ${backfilled} (default ${DEFAULT_BACKFILL_TICKS})`)
	console.log(`latest stored tick: ${new Date(snapshot.t).toISOString()}`)
	console.log(`history depth for ETH: ${history('ETH', 100_000).length} ticks`)

	console.log(`\n${SAMPLE_TICKS} live ticks — the price moves every step`)
	console.log(`  ${'timestamp'.padEnd(26)}${SYMBOLS.map((s) => s.padStart(14)).join('')}`)

	let previous: Record<string, bigint> = {}
	for (let i = 0; i < SAMPLE_TICKS; i += 1) {
		const produced = tick()
		const cells = SYMBOLS.map((symbol) => {
			const entry = produced.prices.find((price) => price.symbol === symbol)
			if (!entry) throw new Error(`tick produced no price for ${symbol}`)
			const before = previous[symbol]
			const mark = before === undefined ? ' ' : entry.price > before ? '▲' : entry.price < before ? '▼' : '='
			previous[symbol] = entry.price
			return `${mark}${formatPrice(entry.price)}`.padStart(14)
		})
		console.log(`  ${new Date(produced.t).toISOString().padEnd(26)}${cells.join('')}`)
	}

	const series = seriesFor(SYMBOLS, 5)
	console.log(`\nseriesFor(${SYMBOLS.join(',')}, 5) -> ${series.length} ticks of ${series[0]?.length ?? 0} symbols`)
	for (const point of series) {
		console.log(
			`  ${new Date(point[0]?.t ?? 0).toISOString()}  ` +
				point.map((price) => `${price.symbol} ${formatPrice(price.price)}`).join('  '),
		)
	}

	reportDeterminism()
	reportWalkStatistics(DEFAULT_BACKFILL_TICKS)
}

try {
	main()
	console.log('\noracle OK')
} catch (error) {
	console.error('\noracle verification FAILED', error)
	process.exitCode = 1
} finally {
	closeDatabase()
}
