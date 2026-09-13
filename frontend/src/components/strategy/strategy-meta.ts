import type { RiskLevel, StrategyType } from '@/lib/types'
import type { SelectOption } from '@/components/ui/Select'
import type { TagTone } from '@/components/ui/Tag'
import type { ListStrategiesQuery } from '@/lib/types'

export const STRATEGY_TYPE_LABEL: Record<StrategyType, string> = {
	momentum: 'Momentum',
	'mean-reversion': 'Mean reversion',
	arbitrage: 'Arbitrage',
	'market-making': 'Market making',
	'trend-following': 'Trend following',
	volatility: 'Volatility',
	yield: 'Yield',
}

export const STRATEGY_TYPE_OPTIONS: readonly SelectOption<StrategyType>[] = (
	Object.keys(STRATEGY_TYPE_LABEL) as StrategyType[]
).map((value) => ({ value, label: STRATEGY_TYPE_LABEL[value] }))

export const RISK_LABEL: Record<RiskLevel, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
}

/** `any` is the unset state of the risk control; it is not a `RiskLevel`. */
export type RiskFilter = RiskLevel | 'any'

export const RISK_FILTER_OPTIONS: readonly { value: RiskFilter; label: string }[] = [
	{ value: 'any', label: 'Any' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
]

/** Higher risk is warmer, so the level reads before the word does. */
export const RISK_TONE: Record<RiskLevel, TagTone> = {
	low: 'verified',
	medium: 'warning',
	high: 'risk',
}

export type SortKey = NonNullable<ListStrategiesQuery['sort']>

export const SORT_OPTIONS: readonly SelectOption<SortKey>[] = [
	{ value: 'apy', label: 'APY' },
	{ value: 'totalReturn', label: 'Total return' },
	{ value: 'aum', label: 'AUM' },
	{ value: 'newest', label: 'Newest' },
	{ value: 'investors', label: 'Investors' },
]

export const SORT_LABEL: Record<SortKey, string> = {
	apy: 'APY',
	totalReturn: 'Total return',
	aum: 'AUM',
	newest: 'Newest',
	investors: 'Investors',
}

export const DEFAULT_SORT: SortKey = 'totalReturn'

/** Tickers render with a leading `$`, and search matches what the reader can see. */
export function displayTicker(ticker: string): string {
	return ticker.startsWith('$') ? ticker : `$${ticker}`
}

export function displayHandle(username: string): string {
	return username.startsWith('@') ? username : `@${username}`
}
