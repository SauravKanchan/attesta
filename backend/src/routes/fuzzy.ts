// Subsequence matching for the marketplace search box.
//
// A query matches when its characters appear in the target in order but not necessarily
// adjacently — "tri arb" finds "Triangular DEX Arbitrage". A LIKE '%q%' cannot do that,
// and the UI picks the consumed characters out of the string it renders, so the server
// has to agree with it about which rows match at all.
//
// The algorithm, the bonuses and the field weights are the same ones the client runs in
// frontend/src/components/strategy/fuzzy.ts, so a row this filter keeps is a row the
// client can highlight, character for character. The client renders what it re-derives;
// the server only decides membership and order.

const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '@', '$', '(', ')', '[', ']', ',', '+'])

/** A match that opens a word is worth far more than one buried mid-token. */
const START_BONUS = 18
const SEPARATOR_BONUS = 14
const CAMEL_BONUS = 10
const CONSECUTIVE_BONUS = 12
const CHARACTER_SCORE = 1
/** Charged per skipped target character, so denser and earlier matches win. */
const SKIP_PENALTY = 1

/** Beyond this the recursion is not worth it; nothing we match on is this long. */
const MAX_TARGET_LENGTH = 240

export interface FuzzyMatch {
	score: number
	/** Ascending target indices the query consumed. Empty for an empty query. */
	indices: number[]
}

function isUpper(character: string): boolean {
	return character !== character.toLowerCase() && character === character.toUpperCase()
}

function boundaryBonus(target: string, index: number): number {
	if (index === 0) return START_BONUS
	const previous = target[index - 1]
	if (previous !== undefined && SEPARATORS.has(previous)) return SEPARATOR_BONUS
	const current = target[index]
	if (previous !== undefined && current !== undefined && isUpper(current) && !isUpper(previous)) {
		return CAMEL_BONUS
	}
	return 0
}

function better(a: FuzzyMatch | null, b: FuzzyMatch | null): FuzzyMatch | null {
	if (a === null) return b
	if (b === null) return a
	return a.score >= b.score ? a : b
}

/**
 * Best-scoring subsequence match, or null when the query is not a subsequence at all.
 * An empty query matches everything with no highlight.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
	const needle = query.trim().toLowerCase()
	if (needle.length === 0) return { score: 0, indices: [] }
	if (target.length === 0 || target.length > MAX_TARGET_LENGTH) return null
	if (needle.length > target.length) return null

	const haystack = target.toLowerCase()
	const width = target.length + 1
	const memo = new Map<number, FuzzyMatch | null>()

	function search(q: number, t: number): FuzzyMatch | null {
		if (q === needle.length) return { score: 0, indices: [] }
		if (t === target.length) return null
		// Not enough target left to hold the rest of the query.
		if (target.length - t < needle.length - q) return null

		const key = q * width + t
		const cached = memo.get(key)
		if (cached !== undefined) return cached

		let taken: FuzzyMatch | null = null
		if (haystack[t] === needle[q]) {
			const rest = search(q + 1, t + 1)
			if (rest !== null) {
				let score = CHARACTER_SCORE + boundaryBonus(target, t)
				if (rest.indices[0] === t + 1) score += CONSECUTIVE_BONUS
				taken = { score: score + rest.score, indices: [t, ...rest.indices] }
			}
		}

		const skipped = search(q, t + 1)
		const penalised =
			skipped === null ? null : { score: skipped.score - SKIP_PENALTY, indices: skipped.indices }

		const best = better(taken, penalised)
		memo.set(key, best)
		return best
	}

	return search(0, 0)
}

/** A hit on the name beats a hit on the ticker, which beats a hit on the creator. */
const FIELD_WEIGHT = { name: 1, ticker: 0.95, creator: 0.8 } as const

export interface SearchableStrategy {
	name: string
	ticker: string
	creatorUsername: string
}

/**
 * Best weighted score across the three searched fields, or null when the query is a
 * subsequence of none of them.
 *
 * The ticker and the creator handle are also tried in the decorated form the marketplace
 * renders — `$MOM`, `@orbital.hedge` — because that is the string the reader sees and
 * therefore the string they type against.
 */
export function scoreStrategy(query: string, strategy: SearchableStrategy): number | null {
	const trimmed = query.trim()
	if (trimmed.length === 0) return 0

	const name = fuzzyMatch(trimmed, strategy.name)
	const ticker = best(trimmed, [strategy.ticker, `$${strategy.ticker}`])
	const creator = best(trimmed, [strategy.creatorUsername, `@${strategy.creatorUsername}`])
	if (name === null && ticker === null && creator === null) return null

	return Math.max(
		name === null ? Number.NEGATIVE_INFINITY : name.score * FIELD_WEIGHT.name,
		ticker === null ? Number.NEGATIVE_INFINITY : ticker.score * FIELD_WEIGHT.ticker,
		creator === null ? Number.NEGATIVE_INFINITY : creator.score * FIELD_WEIGHT.creator,
	)
}

function best(query: string, targets: readonly string[]): FuzzyMatch | null {
	let winner: FuzzyMatch | null = null
	for (const target of targets) winner = better(winner, fuzzyMatch(query, target))
	return winner
}
