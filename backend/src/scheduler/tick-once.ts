// Run exactly one tick, from the command line.
//
//   npm run tick -- <slug or strategy id>
//   npm run tick -- <slug> --repeat 3 --gap 30
//
// The same `tickOnce` the server's scheduler exposes, driven without starting the timer:
// the loop is what owns the interval, and a person debugging a strategy wants one tick
// they can read the whole log of. `--repeat` spaces ticks by `--gap` seconds so a short
// series can be built up on demand — a NAV series needs more than one point before any
// metric can be computed from it.

import { setTimeout as sleep } from 'node:timers/promises'
import { eq, or } from 'drizzle-orm'
import { closeDatabase, db, migrateToLatest } from '../db/index.js'
import { strategies } from '../db/schema.js'
import { formatAmount } from '../lib/money.js'
import { connectChain, getScheduler } from '../services.js'
import type { TickOutcome } from './tick.js'

interface Args {
	target: string
	repeat: number
	gapSeconds: number
}

function parseArgs(argv: readonly string[]): Args {
	const positional: string[] = []
	let repeat = 1
	let gapSeconds = 0

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === '--repeat' || arg === '--gap') {
			const raw = argv[i + 1]
			const value = Number(raw)
			if (!Number.isFinite(value) || value < 0) {
				throw new Error(`${arg} needs a non-negative number, got ${JSON.stringify(raw)}`)
			}
			if (arg === '--repeat') repeat = Math.max(1, Math.floor(value))
			else gapSeconds = value
			i += 1
			continue
		}
		if (arg !== undefined) positional.push(arg)
	}

	const target = positional[0]
	if (!target) {
		throw new Error('usage: npm run tick -- <slug or strategy id> [--repeat n] [--gap seconds]')
	}
	return { target, repeat, gapSeconds }
}

function resolveStrategyId(target: string): string {
	const row = db
		.select({ id: strategies.id, slug: strategies.slug, status: strategies.status })
		.from(strategies)
		.where(or(eq(strategies.id, target), eq(strategies.slug, target)))
		.get()
	if (!row) throw new Error(`no strategy matches ${JSON.stringify(target)} by id or slug`)
	if (row.status !== 'live') {
		console.warn(`strategy ${row.slug} is ${row.status}, not live — ticking it anyway`)
	}
	return row.id
}

/** Base units are what the tick carries; a person reading a terminal wants USDC. */
const amount = (base: string | null): string => (base === null ? 'n/a' : formatAmount(base))

function print(outcome: TickOutcome): void {
	console.log(`\n── tick ${outcome.slug} ${'─'.repeat(Math.max(0, 40 - outcome.slug.length))}`)
	console.log(`  status        ${outcome.status}`)
	console.log(`  source        ${outcome.source ?? 'none'}`)
	console.log(`  action        ${outcome.decision?.action ?? 'none'}  ${outcome.decision?.reason ?? ''}`)
	console.log(`  weights       ${JSON.stringify(outcome.weightsBps)}`)
	console.log(`  pnl computed  ${amount(outcome.pnlComputed)} USDC`)
	console.log(`  pnl applied   ${amount(outcome.pnlApplied)} USDC`)
	console.log(`  applyPnl tx   ${outcome.txHash ?? 'not sent'}`)
	console.log(`  trade txs     ${outcome.tradeTxHashes.length > 0 ? outcome.tradeTxHashes.join(', ') : 'none'}`)
	console.log(`  navPerShare   ${amount(outcome.navPerShare)}`)
	console.log(`  totalAssets   ${amount(outcome.totalAssets)} USDC`)
	console.log(`  totalShares   ${amount(outcome.totalShares)}`)
	console.log(`  duration      ${(outcome.durationMs / 1_000).toFixed(1)}s`)
	if (outcome.error) console.log(`  error         ${outcome.error}`)
	for (const line of outcome.log) console.log(`    | ${line}`)
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	migrateToLatest()
	await connectChain()

	const strategyId = resolveStrategyId(args.target)
	const scheduler = getScheduler()

	let failures = 0
	for (let i = 0; i < args.repeat; i += 1) {
		if (i > 0 && args.gapSeconds > 0) {
			console.log(`\nwaiting ${args.gapSeconds}s before the next tick`)
			await sleep(args.gapSeconds * 1_000)
		}
		const outcome = await scheduler.tickOnce(strategyId)
		print(outcome)
		if (outcome.status !== 'ok') failures += 1
	}

	if (failures > 0) throw new Error(`${failures} of ${args.repeat} tick(s) failed`)
}

try {
	await main()
} catch (error) {
	console.error('tick failed', error)
	process.exitCode = 1
} finally {
	closeDatabase()
}
