/**
 * Exact arithmetic on the 6dp decimal strings the API speaks. Percent shortcuts and
 * share estimates are quoted to the investor before they sign, so they are computed on
 * integer micro-units rather than through a float that would drift in the last decimal.
 *
 * Authoritative balances still come from the backend; this only quotes.
 */

export const DECIMALS = 6
const SCALE = 10n ** BigInt(DECIMALS)

/** Parses a decimal string into micro-units. Returns null for anything unusable. */
export function toMicros(value: string | null | undefined): bigint | null {
	if (value === null || value === undefined) return null
	const trimmed = value.trim()
	if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-') return null

	const negative = trimmed.startsWith('-')
	const unsigned = negative ? trimmed.slice(1) : trimmed
	const [whole = '', fraction = ''] = unsigned.split('.')
	const padded = (fraction + '0'.repeat(DECIMALS)).slice(0, DECIMALS)
	const micros = BigInt(whole === '' ? '0' : whole) * SCALE + BigInt(padded === '' ? '0' : padded)
	return negative ? -micros : micros
}

/** Renders micro-units back as a plain decimal string, trailing zeros trimmed. */
export function fromMicros(micros: bigint): string {
	const negative = micros < 0n
	const absolute = negative ? -micros : micros
	const whole = absolute / SCALE
	const fraction = (absolute % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
	const body = fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
	return negative ? `-${body}` : body
}

/** `fraction` is a percentage of the balance: 25 gives a quarter of it, exactly. */
export function scaleAmount(value: string | null | undefined, percent: number): string | null {
	const micros = toMicros(value)
	if (micros === null) return null
	if (percent >= 100) return fromMicros(micros)
	return fromMicros((micros * BigInt(Math.round(percent))) / 100n)
}

/** Shares minted for an amount at the given NAV per share. Floors, as the vault does. */
export function sharesForAmount(amount: string, navPerShare: string): string | null {
	const amountMicros = toMicros(amount)
	const navMicros = toMicros(navPerShare)
	if (amountMicros === null || navMicros === null || navMicros <= 0n || amountMicros < 0n) return null
	return fromMicros((amountMicros * SCALE) / navMicros)
}

/** USDC returned for redeeming shares at the given NAV per share. */
export function amountForShares(shares: string, navPerShare: string): string | null {
	const shareMicros = toMicros(shares)
	const navMicros = toMicros(navPerShare)
	if (shareMicros === null || navMicros === null || shareMicros < 0n) return null
	return fromMicros((shareMicros * navMicros) / SCALE)
}

/** Share counts arrive padded to 6dp; the trailing zeros are noise, not precision. */
export function trimAmount(value: string | null | undefined): string | null {
	const micros = toMicros(value)
	return micros === null ? null : fromMicros(micros)
}

export function isPositive(value: string | null | undefined): boolean {
	const micros = toMicros(value)
	return micros !== null && micros > 0n
}

/** True when `value` is strictly greater than `limit`, both 6dp decimal strings. */
export function exceeds(value: string, limit: string | null | undefined): boolean {
	const valueMicros = toMicros(value)
	const limitMicros = toMicros(limit)
	if (valueMicros === null || limitMicros === null) return false
	return valueMicros > limitMicros
}
