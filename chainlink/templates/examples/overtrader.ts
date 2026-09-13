// A deliberately bad strategy. Do not copy this one.
//
// It flips between fully long and fully flat on every single tick, on no signal
// at all — it just inverts whatever it is already holding. Every flip is a full
// round trip through the venue, so it pays spread and fees on 100% of the book
// twice per cycle while capturing, on average, half of whatever the market did.
//
// It exists because the marketplace needs a genuinely losing strategy. A
// negative return that comes out of a strategy's own decisions is evidence the
// pipeline is real; a negative number typed into a fixture is not. Its NAV
// curve is the honest one to compare a good strategy against.

import type {
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
const TARGET_BPS = 10_000

export const describe = (): StrategyDescription => ({
	name: 'ETH Overtrader',
	ticker: 'CHURN',
	assets: [SYMBOL],
	summary:
		'Alternates between fully long ETH and fully flat on every tick. A control strategy: maximum turnover, no signal, and the trading costs to match.',
})

export const onTick = (ctx: StrategyContext): TickDecision => {
	// The only input is what it already holds, so it does the opposite. No
	// price is consulted: the losses are pure turnover, not a bad forecast.
	const long = (ctx.currentWeightsBps[SYMBOL] ?? 0) === 0
	const wantBps = long ? TARGET_BPS : 0

	return {
		action: long ? 'ENTER' : 'EXIT',
		targetWeightsBps: { [SYMBOL]: wantBps },
		reason: long ? 'flipping long' : 'flipping flat',
	}
}
