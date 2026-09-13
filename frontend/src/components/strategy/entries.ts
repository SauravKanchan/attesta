import type { StrategySummary } from '@/lib/types'
import { matchStrategy } from '@/components/strategy/fuzzy'
import type { StrategyMatch } from '@/components/strategy/fuzzy'
import { displayHandle, displayTicker } from '@/components/strategy/strategy-meta'

/** A row paired with the strings the reader actually sees and where the query hit them. */
export interface StrategyEntry {
	strategy: StrategySummary
	ticker: string
	handle: string
	match: StrategyMatch | null
}

/**
 * The backend owns filtering and sorting; this only works out which characters to pick
 * out of each row, so a row the server returned is never dropped for failing to match
 * locally — it simply renders unhighlighted.
 */
export function buildEntries(strategies: readonly StrategySummary[], query: string): StrategyEntry[] {
	return strategies.map((strategy) => {
		const ticker = displayTicker(strategy.ticker)
		const handle = displayHandle(strategy.creator.username)
		return {
			strategy,
			ticker,
			handle,
			match: matchStrategy(query, { name: strategy.name, ticker, creator: { username: handle } }),
		}
	})
}

/** Suggestion ordering for the search dropdown, best match first. */
export function rankEntries(entries: readonly StrategyEntry[], limit: number): StrategyEntry[] {
	return entries
		.filter((entry): entry is StrategyEntry & { match: StrategyMatch } => entry.match !== null)
		.sort((a, b) => b.match.score - a.match.score)
		.slice(0, limit)
}
