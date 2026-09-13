/**
 * Display formatting. Money crosses the wire as a 6dp decimal string; these helpers
 * parse for display only — arithmetic on balances belongs on the backend.
 *
 * Every formatter is locale- and timezone-pinned so the server render and the client
 * render agree.
 */

export const EM_DASH = '—'

const usdcFormat = new Intl.NumberFormat('en-US', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
})

const usdcPreciseFormat = new Intl.NumberFormat('en-US', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 6,
})

const compactFormat = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 1,
})

const percentFormat = new Intl.NumberFormat('en-US', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
})

const dateFormat = new Intl.DateTimeFormat('en-US', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC',
})

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZone: 'UTC',
})

const timeFormat = new Intl.DateTimeFormat('en-US', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
	timeZone: 'UTC',
})

export type Numeric = string | number | null | undefined

/** Parses a wire decimal string. Returns null for anything unusable. */
export function toNumber(value: Numeric): number | null {
	if (value === null || value === undefined || value === '') return null
	const parsed = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

/* ── Money ───────────────────────────────────────────────── */

/** `1234.5` -> `1,234.50`. */
export function formatUsdc(value: Numeric): string {
	const parsed = toNumber(value)
	return parsed === null ? EM_DASH : usdcFormat.format(parsed)
}

/** Keeps every one of the six decimals that carry meaning, e.g. NAV per share. */
export function formatUsdcPrecise(value: Numeric): string {
	const parsed = toNumber(value)
	return parsed === null ? EM_DASH : usdcPreciseFormat.format(parsed)
}

/** `1234.5` -> `$1,234.50`. */
export function formatUsd(value: Numeric): string {
	const parsed = toNumber(value)
	return parsed === null ? EM_DASH : `$${usdcFormat.format(parsed)}`
}

/** `2400000` -> `$2.4M`. For AUM columns and stat tiles. */
export function formatUsdCompact(value: Numeric): string {
	const parsed = toNumber(value)
	return parsed === null ? EM_DASH : `$${compactFormat.format(parsed)}`
}

/** Always carries its sign, so a gain and a loss are never confused at a glance. */
export function formatSignedUsd(value: Numeric): string {
	const parsed = toNumber(value)
	if (parsed === null) return EM_DASH
	const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : ''
	return `${sign}$${usdcFormat.format(Math.abs(parsed))}`
}

/* ── Percentages ─────────────────────────────────────────── */

/**
 * Takes a fraction: `0.42` -> `+42.00%`. Signed unless asked otherwise.
 *
 * This is the convention of `StrategyMetrics.apy`, `totalReturn` and `maxDrawdown`.
 */
export function formatPercent(value: Numeric, options: { signed?: boolean } = {}): string {
	const { signed = true } = options
	const parsed = toNumber(value)
	if (parsed === null) return EM_DASH
	const points = parsed * 100
	const sign = signed && points > 0 ? '+' : ''
	return `${sign}${percentFormat.format(points)}%`
}

/**
 * Takes percentage points already: `42` -> `+42.00%`.
 *
 * This is the convention of `Position.unrealisedPnlPct` and
 * `PortfolioSummary.allTimePnlPct`, which the wire contract carries in points rather
 * than as a fraction.
 */
export function formatPercentPoints(value: Numeric, options: { signed?: boolean } = {}): string {
	const { signed = true } = options
	const parsed = toNumber(value)
	if (parsed === null) return EM_DASH
	const sign = signed && parsed > 0 ? '+' : ''
	return `${sign}${percentFormat.format(parsed)}%`
}

/** Basis points as a percentage: `2500` -> `25.00%`. */
export function formatBps(bps: Numeric): string {
	const parsed = toNumber(bps)
	return parsed === null ? EM_DASH : `${percentFormat.format(parsed / 100)}%`
}

export type Tone = 'up' | 'down' | 'flat'

export function toneOf(value: Numeric): Tone {
	const parsed = toNumber(value)
	if (parsed === null || parsed === 0) return 'flat'
	return parsed > 0 ? 'up' : 'down'
}

/** Text colour for a tone. Gains read verified-green, losses risk-crimson. */
export function toneTextClass(tone: Tone): string {
	if (tone === 'up') return 'text-verified'
	if (tone === 'down') return 'text-risk-light'
	return 'text-fg-secondary'
}

/** Convenience for the common case: colour a number by its own sign. */
export function signTextClass(value: Numeric): string {
	return toneTextClass(toneOf(value))
}

/* ── Time ────────────────────────────────────────────────── */

function toDate(value: string | number | Date | null | undefined): Date | null {
	if (value === null || value === undefined || value === '') return null
	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | number | Date | null | undefined): string {
	const date = toDate(value)
	return date === null ? EM_DASH : dateFormat.format(date)
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
	const date = toDate(value)
	return date === null ? EM_DASH : `${dateTimeFormat.format(date)} UTC`
}

export function formatTime(value: string | number | Date | null | undefined): string {
	const date = toDate(value)
	return date === null ? EM_DASH : timeFormat.format(date)
}

/**
 * `4m ago`. `now` is an argument so a caller can keep server and client output
 * identical instead of reading the clock mid-render.
 */
export function formatRelative(value: string | number | Date | null | undefined, now: number): string {
	const date = toDate(value)
	if (date === null) return EM_DASH
	const seconds = Math.round((now - date.getTime()) / 1000)
	const ago = seconds >= 0
	const magnitude = Math.abs(seconds)
	const suffix = ago ? 'ago' : 'from now'
	if (magnitude < 45) return ago ? 'just now' : 'in a moment'
	if (magnitude < 3600) return `${Math.round(magnitude / 60)}m ${suffix}`
	if (magnitude < 86400) return `${Math.round(magnitude / 3600)}h ${suffix}`
	if (magnitude < 2592000) return `${Math.round(magnitude / 86400)}d ${suffix}`
	return formatDate(date)
}

export function formatDuration(milliseconds: Numeric): string {
	const parsed = toNumber(milliseconds)
	if (parsed === null) return EM_DASH
	if (parsed < 1000) return `${Math.round(parsed)}ms`
	if (parsed < 60000) return `${(parsed / 1000).toFixed(2)}s`
	return `${Math.floor(parsed / 60000)}m ${Math.round((parsed % 60000) / 1000)}s`
}

/* ── Hashes and addresses ────────────────────────────────── */

/** `0x81b4...2c09`. Short enough to sit in a table cell, long enough to compare. */
export function truncateHash(hash: string | null | undefined, lead = 6, tail = 4): string {
	if (!hash) return EM_DASH
	if (hash.length <= lead + tail + 3) return hash
	return `${hash.slice(0, lead)}...${hash.slice(-tail)}`
}

export function truncateAddress(address: string | null | undefined): string {
	return truncateHash(address, 6, 4)
}
