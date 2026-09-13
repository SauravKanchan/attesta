// Mean reversion: buy the dip below the band, sell the spike above it.
//
// The mirror image of momentum.ts. It earns in a range, where every excursion
// from the mean is eventually paid back, and loses in a trend, where it sells
// into strength and buys into a decline that keeps going. Running both against
// the same price series is the clearest demonstration that these numbers come
// out of the strategies rather than out of a fixture.

import type {
	PriceSnapshot,
	StrategyContext,
	StrategyDescription,
	TickDecision,
} from '@attesta/strategy-contract'

export {
	defaultBalanceOf as balanceOf,
	defaultOnDeposit as onDeposit,
	defaultOnWithdraw as onWithdraw,
	defaultTotalAssets as totalAssets,
} from '@attesta/strategy-contract'

const SYMBOL = 'ETH'
const LOOKBACK = 20
const DEFAULT_BAND_BPS = 75
const TARGET_BPS = 10_000

/** Vault secret holding the band half-width around the mean, in bps. */
const BAND_BPS_SECRET = 'REVERSION_BAND_BPS'

export const describe = (): StrategyDescription => ({
	name: 'ETH Mean Reversion',
	ticker: 'REV',
	assets: [SYMBOL],
	summary:
		'Buys ETH when it trades below a band around its 20-tick mean and sells when it trades above, holding through the middle.',
})

export const onTick = (ctx: StrategyContext): TickDecision => {
	const bandBps = readBpsSecret(ctx, BAND_BPS_SECRET, DEFAULT_BAND_BPS)
	const heldBps = ctx.currentWeightsBps[SYMBOL] ?? 0

	const window = [...ctx.history, ctx.prices]
	if (window.length < LOOKBACK) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `warming up: ${window.length}/${LOOKBACK} ticks`,
		}
	}

	const price = priceOf(ctx.prices, SYMBOL)
	const mean = meanPrice(window, SYMBOL, LOOKBACK)
	if (price === null || mean === null) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `no ${SYMBOL} price this tick`,
		}
	}

	// Integer band arithmetic: 10000 +/- bandBps of the mean, no floats.
	const upper = (mean * BigInt(10_000 + bandBps)) / 10_000n
	const lower = (mean * BigInt(10_000 - bandBps)) / 10_000n

	// Inside the band there is no edge, only turnover — so do nothing.
	if (price >= lower && price <= upper) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `${SYMBOL} within ${bandBps}bps of its ${LOOKBACK}-tick mean`,
		}
	}

	const cheap = price < lower
	const wantBps = cheap ? TARGET_BPS : 0
	if (wantBps === heldBps) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: cheap ? 'already long the dip' : 'already flat into strength',
		}
	}

	return {
		action: cheap ? 'ENTER' : 'EXIT',
		targetWeightsBps: { [SYMBOL]: wantBps },
		reason: `${SYMBOL} ${cheap ? 'below' : 'above'} the ${bandBps}bps band around its ${LOOKBACK}-tick mean`,
	}
}

function priceOf(snapshot: PriceSnapshot[], symbol: string): bigint | null {
	for (const entry of snapshot) {
		if (entry.symbol === symbol) return entry.price
	}
	return null
}

function meanPrice(
	window: PriceSnapshot[][],
	symbol: string,
	lookback: number,
): bigint | null {
	let sum = 0n
	let count = 0n
	for (const snapshot of window.slice(-lookback)) {
		const price = priceOf(snapshot, symbol)
		if (price !== null) {
			sum += price
			count += 1n
		}
	}
	return count === 0n ? null : sum / count
}

function readBpsSecret(ctx: StrategyContext, id: string, fallback: number): number {
	// An unset secret comes back as an empty string, and Number('') is 0 — which
	// would silently flatten the position. Blank means "not provided".
	const raw = ctx.getSecret(id).trim()
	if (raw.length === 0) return fallback
	const value = Number(raw)
	if (!Number.isFinite(value) || value < 0 || value > 10_000) return fallback
	return Math.round(value)
}
