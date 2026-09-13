// The marketplace: browsing strategies, reading their history, and recording the money
// an investor moved in and out of them.
//
// Reads are public — the marketplace is public — and everything that touches a specific
// investor's money requires a session.
//
// `invest` and `withdraw` are the unusual pair. The browser signs and broadcasts the
// transaction itself, so all these two are handed is a hash. They fetch the receipt and
// verify three things before a row is written: the transaction succeeded, it targets this
// strategy's vault, and its investor is the caller. A hash that fails any of them, or one
// that has already been recorded, changes nothing. The backend records what the chain says
// happened, never what the client claims.

import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getAddress, type Address, type Hex } from 'viem'
import { z } from 'zod'
import type {
	Execution,
	ListStrategiesResponse,
	Position,
	PositionSeries,
	StrategyDetail,
	StrategySummary,
	TimeseriesPoint,
	Trade,
} from '../../../shared/types.js'
import { db } from '../db/index.js'
import {
	positionEvents,
	positions,
	strategies,
	type PositionRow,
	type StrategyRow,
} from '../db/schema.js'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
import { addAmounts, formatAmount, subAmounts, toBigInt, ZERO } from '../lib/money.js'
import { requireAuth, requireUser } from '../lib/session.js'
import { getChainPort } from '../services.js'
import type { Logger, VaultTransferEvent } from '../strategy/ports.js'
import {
	buildDetail,
	creatorOf,
	creatorsFor,
	EMPTY_TOTALS,
	executionsFor,
	findPosition,
	investorCounts,
	navSeries,
	navSeriesFor,
	positionEventsFor,
	positionValueSeries,
	rangeStart,
	readTotals,
	readTotalsFor,
	strategyBySlug,
	toPositionDto,
	toSummary,
	toTimeseries,
	tradesFor,
	usernameOf,
} from './dto.js'
import { scoreStrategy } from './fuzzy.js'

const STRATEGY_TYPES = [
	'momentum',
	'mean-reversion',
	'arbitrage',
	'market-making',
	'trend-following',
	'volatility',
	'yield',
] as const

const RISK_LEVELS = ['low', 'medium', 'high'] as const
const STATUSES = ['draft', 'checking', 'simulating', 'live', 'failed', 'paused'] as const
const RANGES = ['24h', '7d', '30d', '90d', 'all'] as const
const SORTS = ['apy', 'totalReturn', 'aum', 'newest', 'investors'] as const

/** Repeated query keys arrive as a string or an array of them, depending on how many. */
const listOf = <T extends readonly [string, ...string[]]>(values: T) =>
	z.preprocess(
		(raw) => (raw === undefined ? undefined : Array.isArray(raw) ? raw : [raw]),
		z.array(z.enum(values)).optional(),
	)

const listQuery = z.object({
	q: z.string().trim().max(120).optional(),
	types: listOf(STRATEGY_TYPES),
	risk: z.enum(RISK_LEVELS).optional(),
	sort: z.enum(SORTS).optional(),
	status: z.enum(STATUSES).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(24),
	offset: z.coerce.number().int().min(0).default(0),
})

const rangeQuery = z.object({ range: z.enum(RANGES).default('30d') })

const slugParams = z.object({ slug: z.string().trim().min(1).max(120) })

/** Activity tables are paged in the UI; this is the ceiling on one page of them. */
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) })

const txBody = z.object({
	txHash: z
		.string()
		.trim()
		.regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 32-byte hex transaction hash'),
})

export async function strategyRoutes(app: FastifyInstance): Promise<void> {
	// ── Listing ─────────────────────────────────────────────
	app.get('/strategies', async (request): Promise<ListStrategiesResponse> => {
		const query = listQuery.parse(request.query)
		const chain = getChainPort(request.log)

		const conditions = [
			query.risk ? eq(strategies.riskLevel, query.risk) : undefined,
			query.status ? eq(strategies.status, query.status) : undefined,
		].filter((condition) => condition !== undefined)

		const rows = db
			.select()
			.from(strategies)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(strategies.createdAt))
			.all()

		const creators = creatorsFor(rows.map((row) => row.creatorId))

		// Type is a JSON column, so the overlap test is done here rather than in SQL.
		const byType = query.types
			? rows.filter((row) => row.types.some((type) => query.types?.includes(type)))
			: rows

		// Genuine subsequence matching, scored the same way the client scores it, so a row
		// kept here is a row the marketplace can highlight character for character.
		const scored = byType
			.map((row) => ({
				row,
				score: query.q
					? scoreStrategy(query.q, {
							name: row.name,
							ticker: row.ticker,
							creatorUsername: creatorOf(creators, row.creatorId).username,
						})
					: 0,
			}))
			.filter((entry): entry is { row: StrategyRow; score: number } => entry.score !== null)

		// Metrics decide the order, so they are computed for every match rather than for the
		// page — the whole point of sorting by APY is that the best one reaches page one.
		// The chain read is what would need paging first if this ever grew past a screenful.
		const matched = scored.map((entry) => entry.row)
		const series = navSeriesFor(matched.map((row) => row.id))
		const investors = investorCounts(matched.map((row) => row.id))
		const totals = await readTotalsFor(chain, matched, request.log)

		const summaries = scored.map((entry) => ({
			score: entry.score,
			summary: toSummary(
				entry.row,
				creatorOf(creators, entry.row.creatorId),
				series.get(entry.row.id) ?? [],
				totals.get(entry.row.id) ?? EMPTY_TOTALS,
				investors.get(entry.row.id) ?? 0,
			),
		}))

		sortSummaries(summaries, query.sort, query.q !== undefined && query.q.length > 0)

		return {
			strategies: summaries.slice(query.offset, query.offset + query.limit).map((entry) => entry.summary),
			total: summaries.length,
		}
	})

	// ── Detail ──────────────────────────────────────────────
	app.get('/strategies/:slug', async (request): Promise<StrategyDetail> => {
		const { slug } = slugParams.parse(request.params)
		const strategy = requireStrategy(slug)
		return buildDetail(getChainPort(request.log), strategy, request.user?.id ?? null, request.log)
	})

	// ── Series ──────────────────────────────────────────────
	app.get('/strategies/:slug/series', async (request): Promise<TimeseriesPoint[]> => {
		const { slug } = slugParams.parse(request.params)
		const { range } = rangeQuery.parse(request.query)
		const strategy = requireStrategy(slug)
		return toTimeseries(navSeries(strategy.id, rangeStart(range)))
	})

	app.get(
		'/strategies/:slug/position-series',
		{ preHandler: requireAuth },
		async (request): Promise<PositionSeries> => {
			const { slug } = slugParams.parse(request.params)
			const { range } = rangeQuery.parse(request.query)
			const user = requireUser(request)
			const strategy = requireStrategy(slug)

			const position = findPosition(user.id, strategy.id)
			if (!position) return { points: [], events: [], costBasis: formatAmount(ZERO) }

			const events = positionEventsFor(position.id)
			return {
				points: positionValueSeries(strategy.id, events, rangeStart(range)).map((point) => ({
					t: point.t.toISOString(),
					v: formatAmount(point.value),
				})),
				events: events.map((event) => ({
					t: event.t.toISOString(),
					kind: event.kind,
					amount: formatAmount(event.amount),
					txHash: event.txHash ?? '',
				})),
				costBasis: formatAmount(position.costBasis),
			}
		},
	)

	// ── Activity ────────────────────────────────────────────
	app.get('/strategies/:slug/trades', async (request): Promise<Trade[]> => {
		const { slug } = slugParams.parse(request.params)
		const { limit } = activityQuery.parse(request.query)
		return tradesFor(requireStrategy(slug).id, limit)
	})

	app.get('/strategies/:slug/executions', async (request): Promise<Execution[]> => {
		const { slug } = slugParams.parse(request.params)
		const { limit } = activityQuery.parse(request.query)
		return executionsFor(requireStrategy(slug).id, limit)
	})

	// The source is the whole verifiability claim: the binary hash on-chain is only
	// meaningful to someone who can read what was compiled into it.
	app.get('/strategies/:slug/source', async (request, reply): Promise<string> => {
		const { slug } = slugParams.parse(request.params)
		const strategy = requireStrategy(slug)
		const source = strategy.sourceCode ?? ''
		if (source.trim().length === 0) {
			throw notFound(`strategy "${slug}" did not publish its source`)
		}
		reply.type('text/plain; charset=utf-8')
		return source
	})

	// ── Money ───────────────────────────────────────────────
	app.post('/strategies/:slug/invest', { preHandler: requireAuth }, async (request): Promise<Position> => {
		return recordTransfer(request, 'deposit')
	})

	app.post('/strategies/:slug/withdraw', { preHandler: requireAuth }, async (request): Promise<Position> => {
		return recordTransfer(request, 'withdraw')
	})
}

/* ── Listing helpers ─────────────────────────────────────── */

interface ScoredSummary {
	score: number
	summary: StrategySummary
}

/**
 * Nulls sort last on every metric. A strategy with too little history to state an APY is
 * not a strategy with the worst APY, and putting it at the bottom says so without
 * inventing a number for it.
 */
function sortSummaries(entries: ScoredSummary[], sort: string | undefined, searching: boolean): void {
	const byScore = (a: ScoredSummary, b: ScoredSummary) => b.score - a.score
	const byNewest = (a: ScoredSummary, b: ScoredSummary) =>
		Date.parse(b.summary.createdAt) - Date.parse(a.summary.createdAt)

	const nullable = (value: number | null) => (value === null ? Number.NEGATIVE_INFINITY : value)

	const comparators: Record<string, (a: ScoredSummary, b: ScoredSummary) => number> = {
		apy: (a, b) => nullable(b.summary.metrics.apy) - nullable(a.summary.metrics.apy),
		totalReturn: (a, b) =>
			nullable(b.summary.metrics.totalReturn) - nullable(a.summary.metrics.totalReturn),
		aum: (a, b) => Number(b.summary.metrics.aum) - Number(a.summary.metrics.aum),
		investors: (a, b) => b.summary.metrics.investorCount - a.summary.metrics.investorCount,
		newest: byNewest,
	}

	// With no explicit sort, a search is ordered by how well it matched and a bare listing
	// by recency — the two things a reader means by "no particular order".
	const primary = sort ? comparators[sort] : searching ? byScore : byNewest
	entries.sort((a, b) => {
		const decided = primary ? primary(a, b) : 0
		if (decided !== 0) return decided
		const tied = searching ? byScore(a, b) : 0
		return tied !== 0 ? tied : byNewest(a, b)
	})
}

function requireStrategy(slug: string): StrategyRow {
	const strategy = strategyBySlug(slug)
	if (!strategy) throw notFound(`no strategy "${slug}"`)
	return strategy
}

/* ── Recording a browser-signed transfer ─────────────────── */

async function recordTransfer(request: FastifyRequest, kind: 'deposit' | 'withdraw'): Promise<Position> {
	const { slug } = slugParams.parse(request.params)
	const { txHash } = txBody.parse(request.body)
	const user = requireUser(request)
	const strategy = requireStrategy(slug)
	const chain = getChainPort(request.log)

	if (!strategy.vaultAddress) {
		throw conflict(`strategy "${slug}" has no vault deployed, so nothing can be recorded against it`)
	}
	const vaultAddress = getAddress(strategy.vaultAddress as Address)
	const investor = getAddress(user.walletAddress as Address)

	// A hash already on file records nothing a second time, whoever presents it. Checked
	// here so a replay is refused before a receipt is fetched, and again inside the write
	// transaction, which is where the two-requests-at-once case is actually settled.
	if (alreadyRecorded(txHash)) throw conflict(`transaction ${txHash} has already been recorded`)

	const transaction = await chain.readVaultTransaction(txHash as Hex)
	if (!transaction) {
		throw badRequest(`the chain has no transaction ${txHash}`)
	}
	if (transaction.status !== 'success') {
		throw badRequest(`transaction ${txHash} reverted, so it moved nothing`)
	}

	const event = transaction.events.find(
		(candidate) =>
			candidate.kind === kind && getAddress(candidate.vaultAddress) === vaultAddress,
	)
	if (!event) {
		throw badRequest(
			`transaction ${txHash} contains no ${kind} into the vault for "${slug}" (${vaultAddress})`,
		)
	}
	if (getAddress(event.investor) !== investor) {
		request.log.warn(
			{ txHash, claimedBy: investor, investor: event.investor, slug },
			'a caller tried to record someone else’s transfer',
		)
		throw forbidden(`transaction ${txHash} was sent by ${event.investor}, not by you`)
	}

	const position = applyTransfer({
		userId: user.id,
		strategy,
		event,
		txHash,
		logger: request.log,
	})

	const totals = await readTotals(chain, strategy, request.log)
	request.log.info(
		{
			slug,
			userId: user.id,
			kind,
			txHash,
			assets: event.assets.toString(),
			shares: event.shares.toString(),
		},
		'recorded a browser-signed transfer from its receipt',
	)
	return toPositionDto(position, strategy, usernameOf(strategy.creatorId), totals)
}

function alreadyRecorded(txHash: string): boolean {
	return (
		db.select({ id: positionEvents.id }).from(positionEvents).where(eq(positionEvents.txHash, txHash)).get() !==
		undefined
	)
}

interface ApplyTransferInput {
	userId: string
	strategy: StrategyRow
	event: VaultTransferEvent
	txHash: string
	logger: Logger
}

/**
 * Writes the event and the position together. The event row is the audit trail — it is
 * what the position series is drawn from — so a position that moved without one would be
 * a balance with no explanation behind it.
 */
function applyTransfer(input: ApplyTransferInput): PositionRow {
	const { userId, strategy, event, txHash } = input
	const shares = event.shares.toString()
	const assets = event.assets.toString()

	return db.transaction((tx) => {
		// The re-check that matters. Two requests carrying the same hash both pass the check
		// above — it is on the far side of an await — and only this one, inside the write
		// itself, is atomic with the insert that would double-count the deposit.
		if (alreadyRecorded(txHash)) throw conflict(`transaction ${txHash} has already been recorded`)

		let position =
			tx
				.select()
				.from(positions)
				.where(and(eq(positions.userId, userId), eq(positions.strategyId, strategy.id)))
				.get() ?? null

		if (!position) {
			position =
				tx
					.insert(positions)
					.values({
						id: randomUUID(),
						userId,
						strategyId: strategy.id,
						shares: ZERO,
						costBasis: ZERO,
					})
					.returning()
					.get() ?? null
			if (!position) throw conflict('the position row disappeared immediately after insert')
		}

		const signedShares =
			event.kind === 'deposit'
				? addAmounts(position.shares, shares)
				: subAmounts(position.shares, shares)
		const signedBasis =
			event.kind === 'deposit'
				? addAmounts(position.costBasis, assets)
				: subAmounts(position.costBasis, assets)

		// The vault would have reverted a redemption of more shares than the investor holds,
		// so a negative here means this backend missed an earlier event rather than that the
		// chain is wrong. Clamp, and say so.
		let nextShares = signedShares
		if (toBigInt(signedShares) < 0n) {
			input.logger.warn(
				{ txHash, positionId: position.id, held: position.shares, redeemed: shares },
				'a redemption exceeded the recorded share count; clamping the position to zero',
			)
			nextShares = ZERO
		}

		tx.insert(positionEvents)
			.values({
				id: randomUUID(),
				positionId: position.id,
				kind: event.kind,
				amount: assets,
				shares,
				txHash,
			})
			.run()

		const updated = tx
			.update(positions)
			.set({ shares: nextShares, costBasis: signedBasis })
			.where(eq(positions.id, position.id))
			.returning()
			.get()
		if (!updated) throw conflict('the position row disappeared while it was being updated')
		return updated
	})
}
