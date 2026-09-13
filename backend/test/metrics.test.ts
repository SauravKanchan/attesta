import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
	MS_PER_YEAR,
	type NavPoint,
	apy,
	computeMetrics,
	maxDrawdown,
	sharpe,
	toNavSeries,
	totalReturn,
} from '../src/lib/metrics.js'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 1)

function series(navs: number[], stepMs: number = DAY): NavPoint[] {
	return navs.map((nav, i) => ({ t: T0 + i * stepMs, nav }))
}

function closeTo(actual: number | null, expected: number, epsilon = 1e-9): void {
	assert.ok(actual !== null, `expected ${expected}, got null`)
	assert.ok(
		Math.abs(actual - expected) <= epsilon,
		`expected ${expected} +/- ${epsilon}, got ${actual}`,
	)
}

describe('totalReturn', () => {
	const cases: Array<[string, NavPoint[], number | null]> = [
		['doubling', series([1, 2]), 1],
		['halving', series([1, 0.5]), -0.5],
		['flat', series([1, 1, 1]), 0],
		['single point is not enough history', series([1]), null],
		['empty series', [], null],
	]
	for (const [name, points, expected] of cases) {
		test(name, () => {
			const actual = totalReturn(points)
			if (expected === null) assert.equal(actual, null)
			else closeTo(actual, expected)
		})
	}
})

describe('apy', () => {
	test('doubling over exactly a year is +100%', () => {
		closeTo(apy([{ t: T0, nav: 100 }, { t: T0 + MS_PER_YEAR, nav: 200 }]), 1)
	})

	test('halving over exactly a year is -50%', () => {
		closeTo(apy([{ t: T0, nav: 100 }, { t: T0 + MS_PER_YEAR, nav: 50 }]), -0.5)
	})

	test('annualises from the observed span, not an assumed tick rate', () => {
		// +10% over a fifth of a year compounds to 1.1^5 - 1.
		const fifth = MS_PER_YEAR / 5
		closeTo(apy([{ t: T0, nav: 100 }, { t: T0 + fifth, nav: 110 }]), 1.1 ** 5 - 1, 1e-9)
	})

	test('the same growth over a longer span annualises lower', () => {
		const fast = apy([{ t: T0, nav: 100 }, { t: T0 + MS_PER_YEAR / 12, nav: 110 }])
		const slow = apy([{ t: T0, nav: 100 }, { t: T0 + MS_PER_YEAR, nav: 110 }])
		assert.ok(fast !== null && slow !== null)
		assert.ok(fast > slow)
	})

	test('a span shorter than one tick is not enough history', () => {
		assert.equal(apy([{ t: T0, nav: 100 }, { t: T0 + 5_000, nav: 101 }]), null)
	})

	test('a wiped-out vault is -100%, not NaN', () => {
		assert.equal(apy([{ t: T0, nav: 100 }, { t: T0 + DAY, nav: 0 }]), -1)
	})

	test('a zero starting NAV has no defined return', () => {
		assert.equal(apy([{ t: T0, nav: 0 }, { t: T0 + DAY, nav: 100 }]), null)
	})

	test('an unsorted series is ordered before measuring', () => {
		const unsorted: NavPoint[] = [
			{ t: T0 + MS_PER_YEAR, nav: 200 },
			{ t: T0, nav: 100 },
		]
		closeTo(apy(unsorted), 1)
	})
})

describe('maxDrawdown', () => {
	const cases: Array<[string, number[], number | null]> = [
		['peak 120 to trough 90', [100, 120, 90, 110], -0.25],
		['monotonic rise never draws down', [100, 110, 120], 0],
		['straight decline', [100, 50], -0.5],
		['deepest of several declines', [100, 90, 100, 60, 100], -0.4],
		['single point is not enough history', [100], null],
	]
	for (const [name, navs, expected] of cases) {
		test(name, () => {
			const actual = maxDrawdown(series(navs))
			if (expected === null) assert.equal(actual, null)
			else closeTo(actual, expected, 1e-12)
		})
	}
})

describe('sharpe', () => {
	test('known series: daily returns +10%, -10%, +10%', () => {
		// mean 1/30, sample sd 0.115470054, 365 periods/year:
		// (mean * 365) / (sd * sqrt(365)) = 5.515130702
		closeTo(sharpe(series([100, 110, 99, 108.9])), 5.515130702591441, 1e-9)
	})

	test('zero volatility has no defined ratio', () => {
		assert.equal(sharpe(series([100, 100, 100, 100])), null)
	})

	test('two points give one return, which has no deviation to measure', () => {
		assert.equal(sharpe(series([100, 110])), null)
	})

	test('a risk-free rate lowers the ratio', () => {
		const bare = sharpe(series([100, 110, 99, 108.9]))
		const charged = sharpe(series([100, 110, 99, 108.9]), { riskFreeRate: 0.05 })
		assert.ok(bare !== null && charged !== null)
		assert.ok(charged < bare)
	})
})

describe('computeMetrics', () => {
	test('reports every metric for a series with enough history', () => {
		const result = computeMetrics(series([100, 110, 99, 108.9]))
		closeTo(result.totalReturn, 0.089, 1e-12)
		closeTo(result.maxDrawdown, -0.1, 1e-12)
		closeTo(result.sharpe, 5.515130702591441, 1e-9)
		assert.ok(result.apy !== null)
	})

	test('reports nulls rather than zeros on a fresh strategy', () => {
		assert.deepEqual(computeMetrics([{ t: T0, nav: 1 }]), {
			apy: null,
			totalReturn: null,
			maxDrawdown: null,
			sharpe: null,
		})
	})

	test('is pure: the caller keeps its ordering', () => {
		const input: NavPoint[] = [
			{ t: T0 + DAY, nav: 110 },
			{ t: T0, nav: 100 },
		]
		const before = JSON.stringify(input)
		computeMetrics(input)
		assert.equal(JSON.stringify(input), before)
	})

	test('a non-finite point is an error, not a silent skip', () => {
		assert.throws(() => computeMetrics([{ t: T0, nav: Number.NaN }, { t: T0 + DAY, nav: 1 }]), TypeError)
	})
})

describe('toNavSeries', () => {
	test('reads 6dp base units off nav_snapshots rows', () => {
		const points = toNavSeries([
			{ t: new Date(T0), navPerShare: '1000000' },
			{ t: T0 + DAY, navPerShare: '1250000' },
		])
		assert.deepEqual(points, [
			{ t: T0, nav: 1 },
			{ t: T0 + DAY, nav: 1.25 },
		])
	})
})
