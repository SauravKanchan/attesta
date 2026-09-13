// Trend following: hold ETH while the fast mean is above the slow mean.
//
// A crossover strategy makes money by staying in a move for as long as it
// lasts, and pays for that by giving back the top and the bottom of every
// swing. It looks good in a trending series and mediocre in a choppy one —
// compare it against mean-reversion.ts on the same prices.

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
const FAST = 5
const SLOW = 20
const DEFAULT_TARGET_BPS = 10_000

/** Vault secret holding the allocation taken when the trend is up, in bps. */
const TARGET_BPS_SECRET = 'MOMENTUM_TARGET_BPS'

export const describe = (): StrategyDescription => ({
	name: 'ETH Momentum',
	ticker: 'MOM',
	assets: [SYMBOL],
	summary:
		'Goes fully long ETH when its 5-tick mean crosses above its 20-tick mean, and flat when it crosses back below.',
})

export const onTick = (ctx: StrategyContext): TickDecision => {
	const targetBps = readBpsSecret(ctx, TARGET_BPS_SECRET, DEFAULT_TARGET_BPS)
	const heldBps = ctx.currentWeightsBps[SYMBOL] ?? 0

	// The slow window has to be full before the crossover means anything;
	// acting on a two-point average is noise, not a trend.
	const window = [...ctx.history, ctx.prices]
	if (window.length < SLOW) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `warming up: ${window.length}/${SLOW} ticks`,
		}
	}

	const fast = meanPrice(window, SYMBOL, FAST)
	const slow = meanPrice(window, SYMBOL, SLOW)
	if (fast === null || slow === null) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `no ${SYMBOL} prices in the window`,
		}
	}

	const wantBps = fast > slow ? targetBps : 0
	if (wantBps === heldBps) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: fast > slow ? 'trend intact' : 'still no trend',
		}
	}

	return {
		action: wantBps > heldBps ? 'ENTER' : 'EXIT',
		targetWeightsBps: { [SYMBOL]: wantBps },
		reason: `${FAST}-tick mean crossed ${fast > slow ? 'above' : 'below'} the ${SLOW}-tick mean`,
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
