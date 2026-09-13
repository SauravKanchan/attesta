/**
 * Subsequence matching for the marketplace search box.
 *
 * A query matches a target when its characters appear in order but not necessarily
 * adjacently — "tri arb" finds "Triangular DEX Arbitrage". The matcher returns the
 * exact target indices it consumed so the caller can highlight them, which is the
 * part that makes a non-contiguous match legible rather than mysterious.
 */

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
	if (previous !== undefined && current !== undefined && isUpper(current) && !isUpper(previous)) return CAMEL_BONUS
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
		const penalised = skipped === null ? null : { score: skipped.score - SKIP_PENALTY, indices: skipped.indices }

		const best = better(taken, penalised)
		memo.set(key, best)
		return best
	}

	return search(0, 0)
}

export interface FuzzySegment {
	text: string
	matched: boolean
}

/** Splits a target into alternating plain and matched runs, ready to render. */
export function toSegments(text: string, indices: readonly number[] = []): FuzzySegment[] {
	if (indices.length === 0) return text.length === 0 ? [] : [{ text, matched: false }]

	const hits = new Set(indices)
	const segments: FuzzySegment[] = []
	let start = 0
	let matched = hits.has(0)

	for (let index = 1; index <= text.length; index += 1) {
		const nextMatched = index < text.length && hits.has(index)
		if (index === text.length || nextMatched !== matched) {
			segments.push({ text: text.slice(start, index), matched })
			start = index
			matched = nextMatched
		}
	}

	return segments
}

export interface StrategyMatch {
	score: number
	name: number[]
	ticker: number[]
	creator: number[]
}

interface MatchableStrategy {
	name: string
	ticker: string
	creator: { username: string }
}

/** A hit on the name beats a hit on the ticker, which beats a hit on the creator. */
const FIELD_WEIGHT = { name: 1, ticker: 0.95, creator: 0.8 } as const

/**
 * Matches a query against the three fields the marketplace searches. Returns null when
 * none of them contain the query as a subsequence.
 */
export function matchStrategy(query: string, strategy: MatchableStrategy): StrategyMatch | null {
	const trimmed = query.trim()
	if (trimmed.length === 0) return { score: 0, name: [], ticker: [], creator: [] }

	const name = fuzzyMatch(trimmed, strategy.name)
	const ticker = fuzzyMatch(trimmed, strategy.ticker)
	const creator = fuzzyMatch(trimmed, strategy.creator.username)
	if (name === null && ticker === null && creator === null) return null

	const score = Math.max(
		name === null ? -Infinity : name.score * FIELD_WEIGHT.name,
		ticker === null ? -Infinity : ticker.score * FIELD_WEIGHT.ticker,
		creator === null ? -Infinity : creator.score * FIELD_WEIGHT.creator,
	)

	return {
		score,
		name: name?.indices ?? [],
		ticker: ticker?.indices ?? [],
		creator: creator?.indices ?? [],
	}
}
