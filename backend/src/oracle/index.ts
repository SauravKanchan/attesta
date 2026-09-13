// The price oracle: the seeded walk in walk.ts, persisted to price_ticks.
//
// Every return in the product traces back to this table. The workflow reads the current
// snapshot through GET /api/oracle/prices from inside the enclave, decides weights
// against it, and the backend prices that decision against the next tick — so the walk is
// the one input nothing downstream is allowed to invent.
//
// The walk is a pure function of its step index, and rows are only ever appended, so the
// step to generate next is simply the number of rows already stored. That keeps the
// database and the generator in agreement without a cursor to get out of sync, and means
// deleting the table and backfilling again reproduces the identical series.

import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm'
import { formatUnits } from 'viem'
import type { PriceSnapshot } from '../../../shared/strategy-contract.js'
import { db } from '../db/index.js'
import { priceTicks, type PriceTickRow } from '../db/schema.js'
import {
	ORACLE_SEED,
	PriceWalk,
	STEP_SECONDS,
	SYMBOLS,
	fromBaseUnits,
	type OracleSymbol,
	type Regime,
	type WalkPrice,
} from './walk.js'

export { ORACLE_SEED, STEP_SECONDS, SYMBOLS, fromBaseUnits, type OracleSymbol, type Regime }

export const TICK_INTERVAL_MS = STEP_SECONDS * 1_000

/** Seven days of one-minute ticks: a long enough span for APY and drawdown to mean something. */
export const DEFAULT_BACKFILL_TICKS = 7 * 24 * 60

/** The strategy runtime bounds history to 128 ticks, so that is the natural page size. */
export const DEFAULT_HISTORY_LIMIT = 128

/** Rows written per statement during a backfill, well inside SQLite's bound-parameter limit. */
const INSERT_CHUNK = 200

/** All symbols advance together, so one of them is enough to count steps. */
const REFERENCE_SYMBOL: OracleSymbol = SYMBOLS[0]

export interface OraclePrice {
	symbol: string
	/** USDC per unit, 6dp base units. */
	price: bigint
	/** Unix milliseconds. */
	t: number
}

export interface OracleSnapshot {
	/** Unix milliseconds. */
	t: number
	prices: OraclePrice[]
}

/**
 * A `PriceWalk` fast-forwarded to the step already in the database. Rebuilding it from
 * step 0 on every tick would be O(history); keeping it here makes a tick O(1) after the
 * first call, and it is only ever discarded when the database moves backwards.
 */
let walk: PriceWalk | null = null

/**
 * Rows are only ever appended, so once the table has history it keeps it. Remembering
 * that saves a count over the whole series on every read path — and `current()` runs on
 * every request the workflow makes from inside the enclave.
 */
let backfillConfirmed = false

function walkPricesAt(step: number): WalkPrice[] {
	if (!walk || walk.step >= step) walk = new PriceWalk(ORACLE_SEED)
	let produced = walk.advance()
	while (produced.step < step) produced = walk.advance()
	return produced.prices
}

/** Discards the cached generator and the backfill flag; the next call replays from step 0. */
export function resetWalkCache(): void {
	walk = null
	backfillConfirmed = false
}

function storedSteps(): number {
	const row = db
		.select({ n: count() })
		.from(priceTicks)
		.where(eq(priceTicks.symbol, REFERENCE_SYMBOL))
		.get()
	return row?.n ?? 0
}

function latestTimestamp(): number | null {
	const row = db
		.select({ t: priceTicks.t })
		.from(priceTicks)
		.where(eq(priceTicks.symbol, REFERENCE_SYMBOL))
		.orderBy(desc(priceTicks.t))
		.limit(1)
		.get()
	return row ? row.t.getTime() : null
}

/** Ticks land on interval boundaries so a series has no ragged gaps to interpolate over. */
function alignedNow(): number {
	return Math.floor(Date.now() / TICK_INTERVAL_MS) * TICK_INTERVAL_MS
}

type PriceTickInsert = typeof priceTicks.$inferInsert

function toRows(prices: readonly { symbol: string; price: bigint }[], t: number): PriceTickInsert[] {
	return prices.map((price) => ({
		id: randomUUID(),
		symbol: price.symbol,
		t: new Date(t),
		price: price.price.toString(),
	}))
}

function rowToPrice(row: PriceTickRow): OraclePrice {
	return { symbol: row.symbol, price: BigInt(row.price), t: row.t.getTime() }
}

/**
 * Fills an empty table with `ticks` steps ending at the current interval boundary, so a
 * fresh database already has a lookback window for strategies and enough span for metrics.
 * A no-op once any history exists.
 */
export function ensureBackfilled(ticks: number = DEFAULT_BACKFILL_TICKS): number {
	const existing = storedSteps()
	if (existing > 0) {
		backfillConfirmed = true
		return existing
	}
	if (ticks <= 0) return 0

	const endT = alignedNow()
	const startT = endT - (ticks - 1) * TICK_INTERVAL_MS

	const generator = new PriceWalk(ORACLE_SEED)
	const rows: PriceTickInsert[] = []
	for (let i = 0; i < ticks; i += 1) {
		const step = generator.advance()
		rows.push(...toRows(step.prices, startT + i * TICK_INTERVAL_MS))
	}

	try {
		db.transaction((tx) => {
			for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
				tx.insert(priceTicks).values(rows.slice(i, i + INSERT_CHUNK)).run()
			}
		})
	} catch (error) {
		console.error('oracle backfill failed', { ticks, rows: rows.length, error })
		throw error
	}

	walk = null
	backfillConfirmed = true
	console.info(`oracle backfilled ${ticks} ticks for ${SYMBOLS.length} symbols`, {
		from: new Date(startT).toISOString(),
		to: new Date(endT).toISOString(),
	})
	return ticks
}

/**
 * Advances the walk one step, persists it and returns it. Called by the scheduler at the
 * head of every tick, before the strategy is asked what to do.
 */
export function tick(): OracleSnapshot {
	ensureBackfilled()

	const step = storedSteps()
	const last = latestTimestamp()
	const t = last === null ? alignedNow() : last + TICK_INTERVAL_MS
	const prices: OraclePrice[] = walkPricesAt(step).map((price) => ({
		symbol: price.symbol,
		price: price.price,
		t,
	}))

	try {
		db.insert(priceTicks).values(toRows(prices, t)).run()
	} catch (error) {
		console.error('oracle tick could not be persisted', {
			step,
			t: new Date(t).toISOString(),
			error,
		})
		throw error
	}

	return { t, prices }
}

function ensureHistory(): void {
	if (backfillConfirmed) return
	ensureBackfilled()
}

/** The most recent persisted snapshot. Backfills first if the table is empty. */
export function current(): OracleSnapshot {
	ensureHistory()

	const last = latestTimestamp()
	if (last === null) return { t: alignedNow(), prices: [] }

	const rows = db
		.select()
		.from(priceTicks)
		.where(eq(priceTicks.t, new Date(last)))
		.orderBy(asc(priceTicks.symbol))
		.all()
	return { t: last, prices: rows.map(rowToPrice) }
}

/** The last `limit` ticks for one symbol, oldest first. */
export function history(symbol: string, limit: number = DEFAULT_HISTORY_LIMIT): OraclePrice[] {
	ensureHistory()
	if (limit <= 0) return []

	const rows = db
		.select()
		.from(priceTicks)
		.where(eq(priceTicks.symbol, symbol))
		.orderBy(desc(priceTicks.t))
		.limit(limit)
		.all()
	return rows.reverse().map(rowToPrice)
}

/**
 * The last `limit` ticks for several symbols as one snapshot per tick, oldest first —
 * the exact shape `StrategyContext.history` takes.
 */
export function seriesFor(
	symbols: readonly string[],
	limit: number = DEFAULT_HISTORY_LIMIT,
): OraclePrice[][] {
	ensureHistory()
	if (limit <= 0 || symbols.length === 0) return []

	// One cutoff read, then a range scan: cheaper than an IN over `limit` timestamps, and
	// it rides the (symbol, t) index.
	const cutoff = db
		.select({ t: priceTicks.t })
		.from(priceTicks)
		.where(eq(priceTicks.symbol, REFERENCE_SYMBOL))
		.orderBy(desc(priceTicks.t))
		.limit(limit)
		.all()
		.at(-1)
	if (!cutoff) return []

	const rows = db
		.select()
		.from(priceTicks)
		.where(and(inArray(priceTicks.symbol, [...symbols]), gte(priceTicks.t, cutoff.t)))
		.orderBy(asc(priceTicks.t), asc(priceTicks.symbol))
		.all()

	const byTick = new Map<number, OraclePrice[]>()
	for (const row of rows) {
		const price = rowToPrice(row)
		const bucket = byTick.get(price.t)
		if (bucket) bucket.push(price)
		else byTick.set(price.t, [price])
	}
	return [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([, prices]) => prices)
}

export function priceAt(snapshot: OracleSnapshot, symbol: string): bigint | null {
	for (const price of snapshot.prices) if (price.symbol === symbol) return price.price
	return null
}

/** Base units -> a 6dp decimal string, for JSON. */
export function formatPrice(price: bigint): string {
	const [whole, fraction = ''] = formatUnits(price, 6).split('.')
	return `${whole}.${fraction.padEnd(6, '0')}`
}

/**
 * The strategy contract carries `t` in unix seconds while the database and the rest of the
 * backend carry milliseconds, so the conversion is explicit at the boundary rather than
 * assumed on either side.
 */
export function toPriceSnapshots(prices: readonly OraclePrice[]): PriceSnapshot[] {
	return prices.map((price) => ({
		symbol: price.symbol,
		price: price.price,
		t: Math.floor(price.t / 1_000),
	}))
}

export function toPriceSnapshotSeries(series: readonly OraclePrice[][]): PriceSnapshot[][] {
	return series.map(toPriceSnapshots)
}

export function isOracleSymbol(symbol: string): symbol is OracleSymbol {
	return (SYMBOLS as readonly string[]).includes(symbol)
}
