// The tick's arithmetic, which is what every reported number is made of. Pure
// bigint, no chain and no oracle, so these are the cheapest place to pin down
// that a gain rounds down, a loss rounds up, and a fee is only ever charged on
// turnover.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { clampPnl, priceDecision, truncatingDiv } from '../src/scheduler/pricing.js'

const USDC = 1_000_000n
const ETH = 'ETH'

describe('truncatingDiv', () => {
	const cases: Array<[bigint, bigint, bigint]> = [
		[7n, 2n, 3n],
		[-7n, 2n, -3n],
		[7n, -2n, -3n],
		[-7n, -2n, 3n],
		[0n, 5n, 0n],
		[-1n, 5n, 0n],
	]

	for (const [numerator, denominator, expected] of cases) {
		test(`${numerator} / ${denominator} -> ${expected}`, () => {
			assert.equal(truncatingDiv(numerator, denominator), expected)
		})
	}

	test('division by zero is an error, never a silent zero', () => {
		assert.throws(() => truncatingDiv(1n, 0n), /division by zero/)
	})
})

describe('priceDecision', () => {
	test('a first entry has no measured move, so its whole cost is the turnover fee', () => {
		const priced = priceDecision({
			totalManagedAssets: 10_000n * USDC,
			previousWeightsBps: {},
			targetWeightsBps: { [ETH]: 10_000 },
			previousPrices: {},
			currentPrices: { [ETH]: 3_449_592_513n },
			feeBps: 30,
		})

		assert.equal(priced.marketPnl, 0n)
		assert.equal(priced.turnoverBps, 10_000)
		// 10,000 USDC rotated once at 30bps.
		assert.equal(priced.fee, 30n * USDC)
		assert.equal(priced.netPnl, -30n * USDC)
		assert.deepEqual(
			priced.trades.map((trade) => [trade.pair, trade.side, trade.notional, trade.quantity]),
			[['ETH/USDC', 'buy', 10_000n * USDC, 2_898_893n]],
		)
	})

	test('holding through a move earns the move and pays nothing', () => {
		const priced = priceDecision({
			totalManagedAssets: 9_970n * USDC,
			previousWeightsBps: { [ETH]: 10_000 },
			targetWeightsBps: { [ETH]: 10_000 },
			previousPrices: { [ETH]: 1_000n * USDC },
			currentPrices: { [ETH]: 1_010n * USDC },
			feeBps: 30,
		})

		assert.equal(priced.turnoverBps, 0)
		assert.equal(priced.fee, 0n)
		assert.equal(priced.trades.length, 0)
		// +1% on the whole book.
		assert.equal(priced.marketPnl, 99_700_000n)
		assert.equal(priced.netPnl, 99_700_000n)
	})

	test('a move and its mirror image differ only in sign', () => {
		const common = {
			totalManagedAssets: 1_000n * USDC,
			previousWeightsBps: { [ETH]: 3_333 },
			targetWeightsBps: { [ETH]: 3_333 },
			previousPrices: { [ETH]: 3_000_000n },
			feeBps: 0,
		}
		const up = priceDecision({ ...common, currentPrices: { [ETH]: 3_000_001n } })
		const down = priceDecision({ ...common, currentPrices: { [ETH]: 2_999_999n } })

		assert.equal(up.marketPnl, 111n)
		assert.equal(down.marketPnl, -111n)
	})

	test('a symbol the oracle did not quote at both ends contributes no invented move', () => {
		const priced = priceDecision({
			totalManagedAssets: 1_000n * USDC,
			previousWeightsBps: { [ETH]: 10_000 },
			targetWeightsBps: { [ETH]: 10_000 },
			previousPrices: {},
			currentPrices: { [ETH]: 3_000n * USDC },
			feeBps: 30,
		})

		assert.equal(priced.marketPnl, 0n)
		assert.equal(priced.legs.length, 0)
		assert.equal(priced.netPnl, 0n)
	})

	test('a full rotation between two assets is 20000bps of turnover', () => {
		const priced = priceDecision({
			totalManagedAssets: 1_000n * USDC,
			previousWeightsBps: { [ETH]: 10_000 },
			targetWeightsBps: { BTC: 10_000 },
			previousPrices: { [ETH]: 3_000n * USDC },
			currentPrices: { [ETH]: 3_000n * USDC, BTC: 60_000n * USDC },
			feeBps: 30,
		})

		assert.equal(priced.turnoverBps, 20_000)
		assert.equal(priced.fee, 6n * USDC)
		assert.deepEqual(
			priced.trades.map((trade) => [trade.symbol, trade.side]),
			[
				['BTC', 'buy'],
				['ETH', 'sell'],
			],
		)
	})
})

describe('clampPnl', () => {
	const vault = { reserve: 100n * USDC, totalManagedAssets: 1_000n * USDC }

	test('a gain the reserve cannot pay is capped, and says so', () => {
		const clamped = clampPnl(150n * USDC, vault)
		assert.equal(clamped.applied, 100n * USDC)
		assert.equal(clamped.clamped, 'reserve')
		assert.match(clamped.note ?? '', /exceeded the vault reserve/)
	})

	test('a loss larger than the book is capped at the book', () => {
		const clamped = clampPnl(-1_500n * USDC, vault)
		assert.equal(clamped.applied, -1_000n * USDC)
		assert.equal(clamped.clamped, 'managed-assets')
		assert.match(clamped.note ?? '', /exceeded managed assets/)
	})

	test('a settleable delta passes through untouched and unremarked', () => {
		const clamped = clampPnl(-42n, vault)
		assert.equal(clamped.applied, -42n)
		assert.equal(clamped.clamped, null)
		assert.equal(clamped.note, null)
	})
})
