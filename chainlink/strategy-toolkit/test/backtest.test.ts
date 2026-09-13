import { describe, expect, test } from 'vitest'
import { annualisedReturn, loadStrategy, maxDrawdown, runBacktest } from '../src/index'
import { choppySeries, readTemplate, trendingSeries } from './fixtures'

const strategy = (path: string) => loadStrategy(readTemplate(path))

const MOMENTUM = 'examples/momentum.ts'
const REVERSION = 'examples/mean-reversion.ts'
const OVERTRADER = 'examples/overtrader.ts'

describe('return profiles', () => {
	// The point of shipping three examples is that they disagree. If these
	// assertions ever hold only because of the fee model, the marketplace's
	// numbers stop being evidence of anything.
	test('momentum wins in a trend and mean reversion sits it out', () => {
		const series = trendingSeries()
		const momentum = runBacktest(strategy(MOMENTUM), series)
		const reversion = runBacktest(strategy(REVERSION), series)

		expect(momentum.totalReturn).toBeGreaterThan(0.2)
		expect(momentum.totalReturn).toBeGreaterThan(reversion.totalReturn + 0.2)
	})

	test('mean reversion wins in chop and momentum is whipsawed', () => {
		const series = choppySeries()
		const momentum = runBacktest(strategy(MOMENTUM), series)
		const reversion = runBacktest(strategy(REVERSION), series)

		expect(reversion.totalReturn).toBeGreaterThan(0)
		expect(momentum.totalReturn).toBeLessThan(0)
		expect(reversion.totalReturn).toBeGreaterThan(momentum.totalReturn + 0.2)
	})

	test.each([
		['a trend', trendingSeries],
		['chop', choppySeries],
	])('the overtrader bleeds in %s', (_label, series) => {
		const result = runBacktest(strategy(OVERTRADER), series())
		expect(result.totalReturn).toBeLessThan(-0.1)
		// Full round trip every tick is what does the damage.
		expect(result.averageTurnover).toBeGreaterThan(0.9)
	})
})

describe('momentum vs overtrader on one series', () => {
	const series = trendingSeries()
	const momentum = runBacktest(strategy(MOMENTUM), series)
	const overtrader = runBacktest(strategy(OVERTRADER), series)

	test('the NAV curves are materially different', () => {
		expect(momentum.navSeries).toHaveLength(series.length)
		expect(overtrader.navSeries).toHaveLength(series.length)

		const widestGap = Math.max(
			...momentum.navSeries.map((nav, index) => Math.abs(nav - (overtrader.navSeries[index] ?? 0))),
		)
		expect(widestGap).toBeGreaterThan(0.5)
		expect(momentum.totalReturn - overtrader.totalReturn).toBeGreaterThan(1)
	})

	test('one of them is the marketplace negative-return case', () => {
		expect(momentum.totalReturn).toBeGreaterThan(0)
		expect(overtrader.totalReturn).toBeLessThan(0)
		expect(overtrader.finalAssets).toBeLessThan(overtrader.initialAssets)
	})

	test('the backtest is deterministic', () => {
		const again = runBacktest(strategy(MOMENTUM), series)
		expect(again.navSeries).toEqual(momentum.navSeries)
		expect(again.finalAssets).toBe(momentum.finalAssets)
	})

	test('turnover is the only cost, so a zero fee changes the answer', () => {
		const free = runBacktest(strategy(OVERTRADER), series, { feeBps: 0 })
		expect(free.totalReturn).toBeGreaterThan(overtrader.totalReturn)
	})
})

describe('metrics', () => {
	test('maxDrawdown measures peak to trough', () => {
		expect(maxDrawdown([1, 1.5, 0.75, 1.2])).toBeCloseTo(-0.5, 10)
		expect(maxDrawdown([1, 1.1, 1.2])).toBe(0)
	})

	test('annualisedReturn needs at least two points', () => {
		expect(annualisedReturn([1], 60)).toBeNull()
		expect(annualisedReturn([1, 2], 365 * 24 * 60 * 60)).toBeCloseTo(1, 6)
	})

	test('a strategy that reads an unsupplied secret is reported, not hidden', () => {
		const result = runBacktest(strategy(MOMENTUM), trendingSeries())
		expect(result.requestedSecrets).toContain('MOMENTUM_TARGET_BPS')
	})

	test('a supplied secret changes the allocation the backtest applies', () => {
		const series = trendingSeries()
		const full = runBacktest(strategy(MOMENTUM), series)
		const half = runBacktest(strategy(MOMENTUM), series, {
			secrets: { MOMENTUM_TARGET_BPS: '5000' },
		})
		expect(half.totalReturn).toBeLessThan(full.totalReturn)
		expect(half.requestedSecrets).toEqual([])
	})
})
