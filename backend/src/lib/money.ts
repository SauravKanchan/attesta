// USDC money handling. Two representations, never mixed:
//
//   base units  integer string of 6dp units, e.g. "1234500000" — what the database holds
//   decimal     human decimal string, e.g. "1234.500000"       — what crosses the wire
//
// Everything in between is bigint. No value is ever a JS number, because 2^53 base units
// is only ~9 billion USDC and float rounding would corrupt balances long before that.

import { formatUnits, parseUnits } from 'viem'

export const USDC_DECIMALS = 6
export const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS)
export const ZERO = '0'

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const BASE_UNITS_RE = /^-?\d+$/

export class MoneyError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'MoneyError'
	}
}

/** Wire decimal string -> base units. Rejects anything it cannot represent exactly. */
export function parseAmount(input: string): string {
	const value = input.trim()
	if (!DECIMAL_RE.test(value)) throw new MoneyError(`not a decimal amount: ${JSON.stringify(input)}`)
	const fraction = value.split('.')[1] ?? ''
	if (fraction.length > USDC_DECIMALS) {
		throw new MoneyError(`amount has more than ${USDC_DECIMALS} decimal places: ${value}`)
	}
	return parseUnits(value, USDC_DECIMALS).toString()
}

/** Base units -> wire decimal string, always with exactly 6 decimal places. */
export function formatAmount(base: string): string {
	const [whole, fraction = ''] = formatUnits(toBigInt(base), USDC_DECIMALS).split('.')
	return `${whole}.${fraction.padEnd(USDC_DECIMALS, '0')}`
}

/** Base units -> decimal string rounded to `dp` places, half away from zero, for display. */
export function formatAmountDp(base: string, dp: number): string {
	if (!Number.isInteger(dp) || dp < 0 || dp > USDC_DECIMALS) {
		throw new MoneyError(`dp must be an integer in 0..${USDC_DECIMALS}, got ${dp}`)
	}
	const divisor = 10n ** BigInt(USDC_DECIMALS - dp)
	const value = toBigInt(base)
	const negative = value < 0n
	const magnitude = negative ? -value : value
	const rounded = (magnitude + divisor / 2n) / divisor
	const digits = rounded.toString().padStart(dp + 1, '0')
	const whole = digits.slice(0, digits.length - dp)
	const fraction = digits.slice(digits.length - dp)
	const sign = negative && rounded !== 0n ? '-' : ''
	return dp === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

export function toBigInt(base: string): bigint {
	const value = base.trim()
	if (!BASE_UNITS_RE.test(value)) throw new MoneyError(`not base units: ${JSON.stringify(base)}`)
	return BigInt(value)
}

export function fromBigInt(value: bigint): string {
	return value.toString()
}

export function addAmounts(a: string, b: string): string {
	return (toBigInt(a) + toBigInt(b)).toString()
}

export function subAmounts(a: string, b: string): string {
	return (toBigInt(a) - toBigInt(b)).toString()
}

export function negateAmount(a: string): string {
	return (-toBigInt(a)).toString()
}

export function sumAmounts(values: readonly string[]): string {
	return values.reduce((total, value) => total + toBigInt(value), 0n).toString()
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
	const left = toBigInt(a)
	const right = toBigInt(b)
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

export function isZeroAmount(a: string): boolean {
	return toBigInt(a) === 0n
}

export function isNegativeAmount(a: string): boolean {
	return toBigInt(a) < 0n
}

export function maxAmount(a: string, b: string): string {
	return compareAmounts(a, b) >= 0 ? toBigInt(a).toString() : toBigInt(b).toString()
}

/** Fixed-point product of two 6dp quantities, truncated toward zero. */
export function mulAmounts(a: string, b: string): string {
	return truncatingDiv(toBigInt(a) * toBigInt(b), USDC_SCALE).toString()
}

/** Fixed-point quotient of two 6dp quantities, truncated toward zero. */
export function divAmounts(a: string, b: string): string {
	const divisor = toBigInt(b)
	if (divisor === 0n) throw new MoneyError('division by zero')
	return truncatingDiv(toBigInt(a) * USDC_SCALE, divisor).toString()
}

/** Basis points of an amount, truncated toward zero. 10000 bps = 100%. */
export function mulAmountBps(a: string, bps: number): string {
	if (!Number.isInteger(bps)) throw new MoneyError(`bps must be an integer, got ${bps}`)
	return truncatingDiv(toBigInt(a) * BigInt(bps), 10_000n).toString()
}

/**
 * Percentage change between two amounts (42 = +42%), as a float for display only.
 * Null when the base is zero, where the change is undefined rather than infinite.
 */
export function percentChange(from: string, to: string): number | null {
	const base = toBigInt(from)
	if (base === 0n) return null
	const delta = toBigInt(to) - base
	return (Number(delta) / Number(base < 0n ? -base : base)) * 100
}

// bigint division floors toward negative infinity for mixed signs; money rounds toward zero
// so a loss and its mirrored gain differ only in sign.
function truncatingDiv(numerator: bigint, denominator: bigint): bigint {
	const negative = numerator < 0n !== denominator < 0n
	const absNumerator = numerator < 0n ? -numerator : numerator
	const absDenominator = denominator < 0n ? -denominator : denominator
	const quotient = absNumerator / absDenominator
	return negative ? -quotient : quotient
}
