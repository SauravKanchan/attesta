import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MIN_ANNUALISE_MS } from '../src/lib/annualise.js'
import { computeMetrics, type NavPoint } from '../src/lib/metrics.js'

const MINUTE = 60_000
const T0 = Date.UTC(2026, 0, 1)

/** A tick-cadence NAV series that drifts `drop` down in total, like a demo run does. */
function drifting(points: number, stepMs: number, drop: number): NavPoint[] {
	const perStep = (1 - drop) ** (1 / (points - 1))
	return Array.from({ length: points }, (_, i) => ({
		t: T0 + i * stepMs,
		nav: 1 * perStep ** i,
	}))
}

describe('the annualisation floor', () => {
	const tooShort: Array<[string, NavPoint[]]> = [
		['a seven-minute series', drifting(8, MINUTE, 0.0031)],
		['an hour of ticks that fell 2.6%', drifting(60, MINUTE, 0.0256)],
		['an hour of ticks that rose 2.6%', drifting(60, MINUTE, -0.0256)],
		['just under the floor', drifting(60, MIN_ANNUALISE_MS / 60 - 1_000, 0.01)],
	]

	for (const [name, series] of tooShort) {
		test(`${name} states no APY and no Sharpe`, () => {
			const metrics = computeMetrics(series, { minSpanMs: MIN_ANNUALISE_MS })
			assert.equal(metrics.apy, null)
			assert.equal(metrics.sharpe, null)
		})

		test(`${name} still states what it measured directly`, () => {
			const metrics = computeMetrics(series, { minSpanMs: MIN_ANNUALISE_MS })
			assert.ok(metrics.totalReturn !== null, 'totalReturn annualises nothing and is always stated')
			assert.ok(metrics.maxDrawdown !== null, 'maxDrawdown annualises nothing and is always stated')
		})
	}

	test('a month of history does state an APY, so the floor gates rather than disables', () => {
		const month = drifting(60, (30 * 24 * 60 * 60 * 1000) / 59, 0.0256)
		const metrics = computeMetrics(month, { minSpanMs: MIN_ANNUALISE_MS })
		assert.ok(metrics.apy !== null)
		// -2.56% a month compounds to roughly -27% a year, nowhere near a saturated -100%.
		assert.ok(metrics.apy > -0.4 && metrics.apy < -0.2, `implausible apy ${metrics.apy}`)
	})

	test('the floor is long enough that an hour of drift cannot saturate to -100%', () => {
		const anHour = drifting(60, MINUTE, 0.0256)
		const unguarded = computeMetrics(anHour, { minSpanMs: MINUTE })
		assert.equal(unguarded.apy, -1, 'the artefact this floor exists to suppress')
		assert.ok(MIN_ANNUALISE_MS >= 60 * MINUTE)
	})
})
