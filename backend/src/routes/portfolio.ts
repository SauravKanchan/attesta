// The investor's own view: what they hold, what it is worth, and what the wallet they
// sign with can still afford to do.
//
// Every figure here is derived. `currentValue` is shares priced at the vault's live NAV,
// `allTimePnl` is that minus what they put in, and `valueSeries` is their share count as
// at each NAV snapshot the scheduler wrote. Nothing is stored as a summary and read back.
//
// `availableUsdc` and `gasBalance` come from the chain rather than from any table: the
// browser signs its own approve, deposit and withdraw, so the balances that decide
// whether it can are the ones the node reports, not ones this process remembers.

import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { formatEther, getAddress, type Address } from 'viem'
import type { Portfolio, PortfolioSummary, Position, TimeseriesPoint } from '../../../shared/types.js'
import { db } from '../db/index.js'
import { positions, strategies, type PositionRow, type StrategyRow } from '../db/schema.js'
import { addAmounts, formatAmount, percentChange, subAmounts, sumAmounts, ZERO } from '../lib/money.js'
import { requireAuth, requireUser } from '../lib/session.js'
import { positionValue } from '../lib/shares.js'
import { getChainPort } from '../services.js'
import type { ChainPort, Logger } from '../strategy/ports.js'
import {
	creatorOf,
	creatorsFor,
	EMPTY_TOTALS,
	isHeld,
	positionEventsFor,
	positionValueSeries,
	readTotals,
	toPositionDto,
	type Totals,
	type ValuePoint,
} from './dto.js'

/**
 * Points on the portfolio curve. The tick loop writes one NAV snapshot per strategy per
 * minute, so a long-running local stack accumulates more of them than a chart can show;
 * the newest are the ones worth keeping.
 */
const MAX_SERIES_POINTS = 500

export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
	app.get('/portfolio', { preHandler: requireAuth }, async (request): Promise<Portfolio> => {
		const user = requireUser(request)
		const chain = getChainPort(request.log)
		const walletAddress = getAddress(user.walletAddress as Address)

		const held = db
			.select({ position: positions, strategy: strategies })
			.from(positions)
			.innerJoin(strategies, eq(strategies.id, positions.strategyId))
			.where(eq(positions.userId, user.id))
			.all()

		const creators = creatorsFor(held.map((row) => row.strategy.creatorId))
		const totals = new Map<string, Totals>()
		await Promise.all(
			held.map(async (row) => {
				totals.set(row.strategy.id, await readTotals(chain, row.strategy, request.log))
			}),
		)

		// Only what is still held is listed. A fully redeemed position stays in `held` so
		// that `valueSeries` can still price what it was worth before the exit, but it is
		// not an allocation any more and is not offered as one.
		const dtos: Position[] = held
			.filter((row) => isHeld(row.position))
			.map((row) =>
				toPositionDto(
					row.position,
					row.strategy,
					creatorOf(creators, row.strategy.creatorId).username,
					totals.get(row.strategy.id) ?? EMPTY_TOTALS,
				),
			)

		// Summed in base units, off the same rows the DTOs were built from, so the total is
		// exact rather than a sum of already-rounded decimal strings.
		const values = held.map((row) =>
			positionValue(row.position.shares, totals.get(row.strategy.id) ?? EMPTY_TOTALS),
		)
		const invested = held.map((row) => row.position.costBasis)

		return {
			summary: await summarise({
				chain,
				walletAddress,
				totalValue: sumAmounts(values),
				totalInvested: sumAmounts(invested),
				logger: request.log,
			}),
			positions: dtos,
			valueSeries: valueSeries(held),
		}
	})
}

interface SummariseInput {
	chain: ChainPort
	walletAddress: Address
	/** Base units. */
	totalValue: string
	/** Base units. */
	totalInvested: string
	logger: Logger
}

async function summarise(input: SummariseInput): Promise<PortfolioSummary> {
	const { chain, walletAddress, totalValue, totalInvested } = input

	const [usdcBalance, gasBalance] = await Promise.all([
		balance(() => chain.usdcBalanceOf(walletAddress), 'usdc', walletAddress, input.logger),
		balance(() => chain.gasBalanceOf(walletAddress), 'gas', walletAddress, input.logger),
	])

	return {
		totalValue: formatAmount(totalValue),
		totalInvested: formatAmount(totalInvested),
		gasBalance: formatEther(gasBalance),
		allTimePnl: formatAmount(subAmounts(totalValue, totalInvested)),
		// Undefined against nothing invested rather than infinite: a portfolio that cost
		// nothing has no percentage return to state.
		allTimePnlPct: percentChange(totalInvested, totalValue) ?? 0,
		availableUsdc: formatAmount(usdcBalance.toString()),
		walletAddress,
	}
}

/**
 * A balance the node will not report is zero for the response and loud in the log. The
 * alternative — failing the whole portfolio because one `eth_getBalance` timed out — hides
 * the positions the investor actually came to look at.
 */
async function balance(
	read: () => Promise<bigint>,
	kind: 'usdc' | 'gas',
	address: Address,
	logger: Logger,
): Promise<bigint> {
	try {
		return await read()
	} catch (error) {
		logger.error({ err: error, address, kind }, 'could not read a wallet balance from the chain')
		return 0n
	}
}

/**
 * The investor's whole portfolio over time.
 *
 * Strategies do not tick in lockstep, so each one contributes its own points and the
 * others are carried forward at their last known value. Summing the raw union instead
 * would make the total dip every time one strategy happened to have no snapshot at that
 * instant — an artefact of the sampling, not of the money.
 */
function valueSeries(held: ReadonlyArray<{ position: PositionRow; strategy: StrategyRow }>): TimeseriesPoint[] {
	const lines: ValuePoint[][] = []
	for (const row of held) {
		const events = positionEventsFor(row.position.id)
		const line = positionValueSeries(row.strategy.id, events, null)
		if (line.length > 0) lines.push(line)
	}
	if (lines.length === 0) return []

	const timestamps = [...new Set(lines.flatMap((line) => line.map((point) => point.t.getTime())))].sort(
		(a, b) => a - b,
	)

	const cursors = lines.map(() => 0)
	const carried = lines.map(() => ZERO)
	const points: TimeseriesPoint[] = []

	for (const t of timestamps) {
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]
			if (!line) continue
			let cursor = cursors[index] ?? 0
			let value = carried[index] ?? ZERO
			for (;;) {
				const point = line[cursor]
				if (!point || point.t.getTime() > t) break
				value = point.value
				cursor += 1
			}
			cursors[index] = cursor
			carried[index] = value
		}
		points.push({ t: new Date(t).toISOString(), v: formatAmount(total(carried)) })
	}

	return points.slice(-MAX_SERIES_POINTS)
}

function total(values: readonly string[]): string {
	return values.reduce((sum, value) => addAmounts(sum, value), ZERO)
}
