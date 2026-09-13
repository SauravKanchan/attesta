import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
	MoneyError,
	addAmounts,
	compareAmounts,
	divAmounts,
	formatAmount,
	formatAmountDp,
	isNegativeAmount,
	isZeroAmount,
	maxAmount,
	mulAmountBps,
	mulAmounts,
	negateAmount,
	parseAmount,
	percentChange,
	subAmounts,
	sumAmounts,
} from '../src/lib/money.js'

describe('parseAmount', () => {
	const cases: Array<[string, string]> = [
		['0', '0'],
		['1', '1000000'],
		['1234.50', '1234500000'],
		['0.000001', '1'],
		['-12.345678', '-12345678'],
		['-0.000001', '-1'],
		[' 42.5 ', '42500000'],
		// Past 2^53 base units, where a float representation would already be wrong.
		['9007199254.740993', '9007199254740993'],
		['1000000000', '1000000000000000'],
	]

	for (const [input, expected] of cases) {
		test(`${JSON.stringify(input)} -> ${expected}`, () => {
			assert.equal(parseAmount(input), expected)
		})
	}

	const rejected = ['', ' ', 'abc', '1.', '.5', '01', '1e6', '+1', 'Infinity', 'NaN', '1.1234567', '0x10', '1,000']
	for (const input of rejected) {
		test(`rejects ${JSON.stringify(input)}`, () => {
			assert.throws(() => parseAmount(input), MoneyError)
		})
	}
})

describe('formatAmount', () => {
	const cases: Array<[string, string]> = [
		['0', '0.000000'],
		['1', '0.000001'],
		['1234500000', '1234.500000'],
		['-1500000', '-1.500000'],
		['-1', '-0.000001'],
		['9007199254740993', '9007199254.740993'],
	]

	for (const [input, expected] of cases) {
		test(`${input} -> ${expected}`, () => {
			assert.equal(formatAmount(input), expected)
		})
	}

	test('rejects a non-integer base value', () => {
		assert.throws(() => formatAmount('1.5'), MoneyError)
	})
})

describe('round trip', () => {
	const decimals = ['0.000000', '1.000000', '1234.500000', '-12.345678', '9007199254.740993']
	for (const decimal of decimals) {
		test(`${decimal} survives decimal -> base -> decimal`, () => {
			assert.equal(formatAmount(parseAmount(decimal)), decimal)
		})
	}
})

describe('formatAmountDp', () => {
	const cases: Array<[string, number, string]> = [
		['1234500000', 2, '1234.50'],
		['1234505000', 2, '1234.51'],
		['-1234505000', 2, '-1234.51'],
		['1500000', 0, '2'],
		['400000', 0, '0'],
		['-400000', 0, '0'],
		['1', 6, '0.000001'],
		['0', 2, '0.00'],
	]

	for (const [base, dp, expected] of cases) {
		test(`${base} @ ${dp}dp -> ${expected}`, () => {
			assert.equal(formatAmountDp(base, dp), expected)
		})
	}

	test('rejects a precision the base units cannot carry', () => {
		assert.throws(() => formatAmountDp('1', 7), MoneyError)
	})
})

describe('arithmetic', () => {
	test('add, subtract, negate and sum', () => {
		assert.equal(addAmounts('1000000', '2500000'), '3500000')
		assert.equal(subAmounts('1000000', '2500000'), '-1500000')
		assert.equal(negateAmount('-1500000'), '1500000')
		assert.equal(sumAmounts(['1000000', '-250000', '1']), '750001')
		assert.equal(sumAmounts([]), '0')
	})

	const products: Array<[string, string, string]> = [
		['1500000', '2000000', '3000000'],
		['1000000', '1000000', '1000000'],
		['1', '1', '0'],
		['-2000000', '1500000', '-3000000'],
	]
	for (const [a, b, expected] of products) {
		test(`mulAmounts(${a}, ${b}) = ${expected}`, () => {
			assert.equal(mulAmounts(a, b), expected)
		})
	}

	const quotients: Array<[string, string, string]> = [
		['1000000', '3000000', '333333'],
		// Truncation is toward zero, so a loss mirrors its gain instead of floor()ing away.
		['-1000000', '3000000', '-333333'],
		['3000000', '1500000', '2000000'],
	]
	for (const [a, b, expected] of quotients) {
		test(`divAmounts(${a}, ${b}) = ${expected}`, () => {
			assert.equal(divAmounts(a, b), expected)
		})
	}

	test('divide by zero is an error, not Infinity', () => {
		assert.throws(() => divAmounts('1000000', '0'), MoneyError)
	})

	test('basis points', () => {
		assert.equal(mulAmountBps('1000000', 250), '25000')
		assert.equal(mulAmountBps('1000000', 10_000), '1000000')
		assert.equal(mulAmountBps('1000000', 0), '0')
	})

	test('comparison helpers', () => {
		assert.equal(compareAmounts('1', '2'), -1)
		assert.equal(compareAmounts('2', '2'), 0)
		assert.equal(compareAmounts('3', '2'), 1)
		assert.equal(maxAmount('3', '2'), '3')
		assert.equal(isZeroAmount('0'), true)
		assert.equal(isNegativeAmount('-1'), true)
		assert.equal(isNegativeAmount('0'), false)
	})
})

describe('percentChange', () => {
	const cases: Array<[string, string, number | null]> = [
		['100000000', '110000000', 10],
		['100000000', '50000000', -50],
		['100000000', '100000000', 0],
		['0', '1000000', null],
	]
	for (const [from, to, expected] of cases) {
		test(`${from} -> ${to} = ${expected}`, () => {
			const actual = percentChange(from, to)
			if (expected === null) assert.equal(actual, null)
			else assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9)
		})
	}
})
