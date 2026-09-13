import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { navPerShare, positionValue, previewDeposit, previewWithdraw } from '../src/lib/shares.js'

const EMPTY = { totalAssets: '0', totalShares: '0' }
// 100 shares against 200 USDC: the vault doubled, so a share is worth 2 USDC.
const DOUBLED = { totalAssets: '200000000', totalShares: '100000000' }

describe('navPerShare', () => {
	const cases: Array<[string, { totalAssets: string; totalShares: string }, string]> = [
		['an empty vault prices at inception', EMPTY, '1000000'],
		['a doubled vault', DOUBLED, '2000000'],
		['a halved vault', { totalAssets: '50000000', totalShares: '100000000' }, '500000'],
	]
	for (const [name, totals, expected] of cases) {
		test(name, () => {
			assert.equal(navPerShare(totals), expected)
		})
	}
})

describe('deposits', () => {
	test('the first deposit mints one share per USDC', () => {
		assert.deepEqual(previewDeposit(EMPTY, '100000000'), {
			shares: '100000000',
			assets: '100000000',
		})
	})

	test('a later deposit buys in at the current NAV', () => {
		assert.deepEqual(previewDeposit(DOUBLED, '100000000'), {
			shares: '50000000',
			assets: '100000000',
		})
	})

	test('a zero deposit is rejected', () => {
		assert.throws(() => previewDeposit(EMPTY, '0'), /deposit must be positive/)
	})
})

describe('withdrawals', () => {
	test('shares redeem at the current NAV', () => {
		assert.deepEqual(previewWithdraw(DOUBLED, '50000000'), {
			shares: '50000000',
			assets: '100000000',
		})
	})

	test('withdrawing more than exists is rejected', () => {
		assert.throws(() => previewWithdraw(DOUBLED, '200000000'), /exceeds total shares/)
	})
})

describe('positionValue', () => {
	test('values a holding against the vault', () => {
		assert.equal(positionValue('50000000', DOUBLED), '100000000')
	})

	test('a share of an empty vault is worth nothing', () => {
		assert.equal(positionValue('50000000', EMPTY), '0')
	})
})
