/**
 * Exact 6dp arithmetic for the withdraw flow.
 *
 * A withdrawal is denominated in shares on the wire but entered in USDC by the
 * investor, so the conversion happens here rather than on the backend. Doing it in
 * floating point would round a full exit down to a dust remainder that can never be
 * redeemed, so every step stays in base units as bigint — the same integers the vault
 * and `shared/types.ts` carry.
 */

export const DECIMALS = 6
const SCALE = 10n ** BigInt(DECIMALS)

/** Parses a wire decimal string into base units. Returns null for anything unusable. */
export function parseUnits6(value: string): bigint | null {
	const trimmed = value.trim()
	if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-') return null
	const negative = trimmed.startsWith('-')
	const unsigned = negative ? trimmed.slice(1) : trimmed
	const [whole = '', fraction = ''] = unsigned.split('.')
	// More precision than USDC carries is a typo, not a value we may silently truncate.
	if (fraction.length > DECIMALS) return null
	const units = BigInt(whole === '' ? '0' : whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0') || '0')
	return negative ? -units : units
}

/** Base units back to a wire decimal string, trailing zeros kept. */
export function formatUnits6(units: bigint): string {
	const negative = units < 0n
	const magnitude = negative ? -units : units
	const whole = magnitude / SCALE
	const fraction = (magnitude % SCALE).toString().padStart(DECIMALS, '0')
	return `${negative ? '-' : ''}${whole}.${fraction}`
}

/** Parses a wire string, treating anything unreadable as zero. */
export function unitsOrZero(value: string | null | undefined): bigint {
	if (value === null || value === undefined) return 0n
	return parseUnits6(value) ?? 0n
}

/**
 * Shares to burn to receive `amount` USDC, priced off the position itself so the rate
 * used is the one the API just reported. Rounds down: burning fewer shares than the
 * exact rate implies can only leave value in the position, never overdraw it.
 */
export function sharesForAmount(amount: bigint, shares: bigint, currentValue: bigint): bigint {
	if (amount <= 0n || shares <= 0n || currentValue <= 0n) return 0n
	const needed = (amount * shares) / currentValue
	return needed > shares ? shares : needed
}

/** USDC released by burning `shares`, at the same rate. */
export function amountForShares(sharesToBurn: bigint, shares: bigint, currentValue: bigint): bigint {
	if (sharesToBurn <= 0n || shares <= 0n || currentValue <= 0n) return 0n
	return (sharesToBurn * currentValue) / shares
}

/** `percent` of a base-unit quantity, rounded down. 100 returns the quantity exactly. */
export function percentOf(units: bigint, percent: number): bigint {
	if (percent >= 100) return units
	if (percent <= 0) return 0n
	return (units * BigInt(Math.round(percent))) / 100n
}
