// What a strategy held, and at what prices, when it last settled.
//
// Pricing an interval needs both ends of it, and the price half is not in the
// database: `executions` records the weights a tick chose but not the prices it
// was measured against. Rather than widen the schema, each strategy keeps a
// small state file next to — not inside — its workflow directory, so
// regenerating the workflow does not erase the series' left-hand edge.
//
// It is a cache, not the record: if it is missing, the weights are recovered
// from the last successful execution and the first tick after that simply has
// no measured move to price, which is the honest outcome rather than a guess.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { strategyConfig } from '../strategy/config.js'
import { slugify } from '../strategy/workspace.js'
import { consoleLogger, type Logger } from '../strategy/ports.js'
import type { Db } from '../db/index.js'
import { executions } from '../db/schema.js'

/** Which path produced a decision. An execution is never allowed to be vague about this. */
export type DecisionSource = 'cre-simulate' | 'local-fallback'

export interface TickState {
	strategyId: string
	slug: string
	/** Wall clock milliseconds of the tick this state came from. */
	t: number
	weightsBps: Record<string, number>
	/** Symbol -> 6dp price, as a string so the file stays plain JSON. */
	prices: Record<string, string>
	navPerShare: string
	source: DecisionSource
}

const stateDir = (): string => join(strategyConfig.workspaceDir, 'state')
const statePath = (slug: string): string => join(stateDir(), `${slugify(slug)}.json`)

export async function readTickState(slug: string, logger: Logger = consoleLogger): Promise<TickState | null> {
	try {
		return JSON.parse(await readFile(statePath(slug), 'utf8')) as TickState
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ENOENT') logger.warn({ slug, err: error }, 'unreadable tick state; starting fresh')
		return null
	}
}

/** Written through a temp file: a torn state file would silently mis-price a tick. */
export async function writeTickState(state: TickState, logger: Logger = consoleLogger): Promise<void> {
	const target = statePath(state.slug)
	const temp = `${target}.${process.pid}.tmp`
	try {
		await mkdir(stateDir(), { recursive: true })
		await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
		await rename(temp, target)
	} catch (error) {
		// A tick that settled on-chain must not be undone by a failed cache write;
		// the next tick recovers its weights from the execution log instead.
		logger.error({ slug: state.slug, err: error }, 'could not persist tick state')
	}
}

export const toPriceStrings = (prices: Record<string, bigint>): Record<string, string> =>
	Object.fromEntries(Object.entries(prices).map(([symbol, price]) => [symbol, price.toString()]))

export const fromPriceStrings = (prices: Record<string, string>): Record<string, bigint> => {
	const out: Record<string, bigint> = {}
	for (const [symbol, price] of Object.entries(prices)) {
		try {
			out[symbol] = BigInt(price)
		} catch (error) {
			consoleLogger.warn({ symbol, price, err: error }, 'dropping an unparseable cached price')
		}
	}
	return out
}

/** Weights from the last settled execution, for when the state file is gone. */
export function weightsFromLastExecution(db: Db, strategyId: string): Record<string, number> {
	const row = db
		.select()
		.from(executions)
		.where(and(eq(executions.strategyId, strategyId), eq(executions.status, 'ok')))
		.orderBy(desc(executions.t))
		.limit(1)
		.get()
	return row?.targetWeightsBps ?? {}
}
