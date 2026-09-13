// End-to-end proof that the value loop runs: a creator's TypeScript becomes a live
// strategy with a vault, an anchor on-chain and a NAV series that APY is computed from.
//
// Nothing in the sequence is stubbed. The submission goes through the same nine sanity
// checks a creator's would, `cre workflow build` and `cre workflow simulate` really run,
// the vault is really deployed, the deposit is a real transaction, and every applyPnl hash
// printed can be looked up on the node.
//
//   1  publish an example strategy through the real pipeline
//   2  read the registry back and check the anchor is under the id publish computed
//   3  tick once with no depositors — applyPnl must be skipped, the NAV snapshot written
//   4  an investor deposits, so the vault has shares for a gain to belong to
//   5  three more ticks, spaced so the NAV series spans long enough to annualise
//   6  compute APY, total return and drawdown from nav_snapshots
//
// Run with `npm run verify:loop`. It takes minutes: each tick compiles the strategy to
// WASM and runs it in the simulator.
//
// It runs against its own database (DATABASE_URL defaults to ./data/verify-loop.db) and
// serves the enclave's oracle on its own port. A backend left running on the dev database
// has a scheduler of its own, and two loops ticking one strategy would interleave two
// settlements into a single NAV series — so the run is isolated rather than sharing.

import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { asc, eq } from 'drizzle-orm'
import { formatUnits, type Address } from 'viem'
import type { SanityCheck, StrategyType } from '../../../shared/types.js'
import * as chain from '../chain/index.js'
import { closeDatabase, db, migrateToLatest } from '../db/index.js'
import { executions, navSnapshots, strategies, submissions, trades, users } from '../db/schema.js'
import { computeMetrics, toNavSeries } from '../lib/metrics.js'
import { formatAmount } from '../lib/money.js'
import { BACKEND_ROOT } from '../lib/paths.js'
import { toStrategyId } from '../lib/strategy-id.js'
import * as oracleModule from '../oracle/index.js'
import { connectChain, getChainPort, getScheduler } from '../services.js'
import { strategyConfig } from '../strategy/config.js'
import { consoleLogger } from '../strategy/ports.js'
import { publishSubmission } from '../strategy/publish.js'
import { runChecksToCompletion } from '../strategy/pipeline.js'
import type { TickOutcome } from './tick.js'

const TEMPLATE = process.env.VERIFY_STRATEGY ?? 'momentum'

/** What the marketplace filters on. Declared by the example, not inferred from its code. */
const TEMPLATE_TYPES: Record<string, StrategyType[]> = {
	momentum: ['momentum', 'trend-following'],
	'mean-reversion': ['mean-reversion'],
	overtrader: ['momentum'],
}

const TEMPLATE_PATH = path.resolve(
	BACKEND_ROOT,
	'..',
	'chainlink',
	'templates',
	'examples',
	`${TEMPLATE}.ts`,
)

/** Ticks to run once the vault has a depositor. Three is what the NAV series needs to bend. */
const TICKS = Number(process.env.VERIFY_TICKS ?? '3')
/** Seconds between those ticks. The series has to span MIN_SPAN_MS before APY is reported. */
const GAP_SECONDS = Number(process.env.VERIFY_GAP_SECONDS ?? '25')

const DEPOSIT = 10_000n * 1_000_000n
const FAUCET = 50_000n * 1_000_000n

const usd = (base: bigint | string): string => `${formatAmount(base.toString())} USDC`

function heading(title: string): void {
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

// ── the oracle the enclave fetches from ─────────────────────
//
// The workflow makes a real HTTP GET from inside the simulated enclave, so something has
// to be serving prices at ORACLE_URL. When the backend is running its own route answers
// and this listener never binds; when it is not, the same oracle module the route wraps is
// served here for the length of the run, so the prices the enclave decides on are still
// the seeded walk in price_ticks and not an invention of this script.

interface OracleEndpoint {
	url: string
	server: Server | null
	source: 'backend' | 'this script'
}

function oraclePayload(limit: number): string {
	const snapshot = oracleModule.current()
	const symbols = snapshot.prices.map((price) => price.symbol)
	const series = oracleModule.seriesFor(symbols, limit + 1)
	const prior = series.filter((entry) => (entry[0]?.t ?? 0) < snapshot.t)
	const encode = (prices: readonly oracleModule.OraclePrice[]): unknown[] =>
		prices.map((price) => ({
			symbol: price.symbol,
			price: oracleModule.formatPrice(price.price),
			t: Math.floor(price.t / 1_000),
		}))

	return JSON.stringify({
		t: Math.floor(snapshot.t / 1_000),
		prices: encode(snapshot.prices),
		history: prior.slice(-limit).map(encode),
	})
}

async function reachable(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
		if (!response.ok) return false
		const body = (await response.json()) as { prices?: unknown }
		return Array.isArray(body.prices) && body.prices.length > 0
	} catch (error) {
		console.info(`no oracle answering at ${url} (${String(error)})`)
		return false
	}
}

async function ensureOracle(): Promise<OracleEndpoint> {
	const url = strategyConfig.oracleUrl
	oracleModule.ensureBackfilled()

	if (await reachable(url)) {
		return { url, server: null, source: 'backend' }
	}

	const parsed = new URL(url)
	const server = createServer((request, response) => {
		try {
			const body = oraclePayload(64)
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(body)
		} catch (error) {
			console.error('oracle listener could not serve a snapshot', error)
			response.writeHead(500, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ error: 'oracle_failed' }))
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(Number(parsed.port), parsed.hostname, resolve)
	})
	return { url, server, source: 'this script' }
}

// ── the pipeline ────────────────────────────────────────────

function creatorId(): string {
	const address = chain.deployerAccount.address as Address
	const existing = db.select().from(users).where(eq(users.walletAddress, address)).get()
	if (existing) return existing.id

	const id = randomUUID()
	db.insert(users).values({ id, username: `loop-verifier-${Date.now()}`, walletAddress: address }).run()
	return id
}

async function publishExample(): Promise<{ strategyId: string; slug: string; vaultAddress: Address }> {
	const source = await readFile(TEMPLATE_PATH, 'utf8')
	const submissionId = randomUUID()

	db.insert(submissions)
		.values({
			id: submissionId,
			creatorId: creatorId(),
			name: '',
			ticker: '',
			types: TEMPLATE_TYPES[TEMPLATE] ?? ['momentum'],
			riskLevel: 'medium',
			description: '',
			sourceCode: source,
			checks: [],
			simulationLog: [],
		})
		.run()

	heading(`sanity pipeline over ${TEMPLATE}.ts`)
	console.log('this compiles the strategy to WASM and runs it in the simulator — minutes, not seconds')
	const checked = await runChecksToCompletion(source, { key: submissionId, logger: consoleLogger })

	for (const check of checked.checks) {
		console.log(`  ${check.status.padEnd(7)} ${check.id.padEnd(18)} ${check.detail ?? ''}`)
	}
	if (!checked.passed) throw new Error('the submission did not pass every sanity check')

	db.update(submissions)
		.set({
			checks: checked.checks as SanityCheck[],
			simulationLog: checked.simulationLog,
			binaryHash: checked.binaryHash,
			configHash: checked.configHash,
			name: checked.describe?.name ?? 'Loop Verifier',
			ticker: checked.describe?.ticker ?? 'LOOP',
			description: checked.describe?.summary ?? '',
			updatedAt: new Date(),
		})
		.where(eq(submissions.id, submissionId))
		.run()

	heading('publish')
	const published = await publishSubmission({ submissionId, chain: getChainPort() })
	for (const step of published.steps) {
		console.log(`  ${step.status.padEnd(7)} ${step.name.padEnd(13)} ${step.detail}${step.txHash ? `  tx ${step.txHash}` : ''}`)
	}

	// The registry key publish computed and the key the registry answers to have to be the
	// same bytes32. They are only the same if exactly one side hashed the platform id.
	heading('registry anchor')
	const expected = toStrategyId(published.strategyId)
	const record = await chain.registry.getRecord(expected)
	if (!record) throw new Error(`the registry has no record under ${expected}`)
	if (record.strategyId.toLowerCase() !== expected.toLowerCase()) {
		throw new Error(`registry answered with ${record.strategyId}, expected ${expected}`)
	}
	if (record.vault.toLowerCase() !== published.vaultAddress.toLowerCase()) {
		throw new Error(`registry points at ${record.vault}, expected ${published.vaultAddress}`)
	}
	console.log(`  platform id   ${published.strategyId}`)
	console.log(`  registry key  ${expected}`)
	console.log(`  read back     ${record.strategyId}  (identical: ${record.strategyId.toLowerCase() === expected.toLowerCase()})`)
	console.log(`  vault         ${record.vault}`)
	console.log(`  binary hash   ${record.binaryHash}`)

	return { strategyId: published.strategyId, slug: published.slug, vaultAddress: published.vaultAddress }
}

// ── the loop ────────────────────────────────────────────────

function printTick(label: string, outcome: TickOutcome): void {
	heading(label)
	console.log(`  status        ${outcome.status}`)
	console.log(`  source        ${outcome.source ?? 'none'}`)
	console.log(`  action        ${outcome.decision?.action ?? 'none'}  ${outcome.decision?.reason ?? ''}`)
	console.log(`  weights       ${JSON.stringify(outcome.weightsBps)}`)
	console.log(`  pnl computed  ${outcome.pnlComputed === null ? 'n/a' : usd(outcome.pnlComputed)}`)
	console.log(`  pnl applied   ${outcome.pnlApplied === null ? 'n/a' : usd(outcome.pnlApplied)}`)
	console.log(`  applyPnl tx   ${outcome.txHash ?? 'not sent'}`)
	console.log(`  recordTrade   ${outcome.tradeTxHashes.length > 0 ? outcome.tradeTxHashes.join(', ') : 'no trades this tick'}`)
	console.log(`  navPerShare   ${outcome.navPerShare === null ? 'n/a' : formatAmount(outcome.navPerShare)}`)
	console.log(`  totalAssets   ${outcome.totalAssets === null ? 'n/a' : usd(outcome.totalAssets)}`)
	console.log(`  totalShares   ${outcome.totalShares === null ? 'n/a' : formatAmount(outcome.totalShares)}`)
	console.log(`  duration      ${(outcome.durationMs / 1_000).toFixed(1)}s`)
	if (outcome.error) console.log(`  error         ${outcome.error}`)
	for (const line of outcome.log) console.log(`    | ${line}`)
	if (outcome.status !== 'ok') throw new Error(`tick failed: ${outcome.error ?? 'unknown'}`)
}

async function depositAsInvestor(vaultAddress: Address): Promise<void> {
	heading('investor deposit')
	// A fresh EOA standing in for a Privy embedded wallet, funded from the anvil deployer.
	// The browser signs this pair in the product; here the script does, because what the
	// tick loop needs is simply that the vault has shares for a gain to belong to.
	const investor = chain.wallets.generateWallet()
	const account = chain.wallets.accountFromKey(investor.privateKey)
	await chain.wallets.fundGas(investor.address)
	await chain.usdc.mint(investor.address, FAUCET)
	await chain.usdc.ensureAllowance(vaultAddress, DEPOSIT, account)
	const deposited = await chain.vault.deposit(vaultAddress, DEPOSIT, account)

	console.log(`  investor      ${investor.address}`)
	console.log(`  deposited     ${usd(deposited.assets)} -> ${formatAmount(deposited.shares.toString())} shares`)
	console.log(`  tx            ${deposited.txHash}`)
	console.log(`  totalShares   ${formatAmount(deposited.totalShares.toString())}`)
}

function report(strategyId: string): void {
	const snapshots = db
		.select()
		.from(navSnapshots)
		.where(eq(navSnapshots.strategyId, strategyId))
		.orderBy(asc(navSnapshots.t))
		.all()

	heading('nav_snapshots')
	for (const row of snapshots) {
		console.log(
			`  ${row.t.toISOString()}  navPerShare ${formatAmount(row.navPerShare).padStart(12)}  assets ${formatAmount(row.totalAssets).padStart(14)}  shares ${formatAmount(row.totalShares).padStart(14)}`,
		)
	}

	const rows = db.select().from(trades).where(eq(trades.strategyId, strategyId)).orderBy(asc(trades.t)).all()
	heading('trades')
	if (rows.length === 0) console.log('  none')
	for (const row of rows) {
		console.log(`  ${row.t.toISOString()}  ${row.side.padEnd(4)} ${row.pair.padEnd(9)} size ${formatAmount(row.size).padStart(14)}  price ${formatAmount(row.price).padStart(12)}  tx ${row.txHash ?? 'none'}`)
	}

	const log = db.select().from(executions).where(eq(executions.strategyId, strategyId)).orderBy(asc(executions.t)).all()
	heading('executions')
	for (const row of log) {
		console.log(`  ${row.t.toISOString()}  ${row.status.padEnd(6)} ${(row.action ?? '-').padEnd(9)} pnl ${(row.pnlApplied ?? '0').padStart(10)}  tx ${row.txHash ?? 'not sent'}`)
	}

	const series = toNavSeries(snapshots)
	const metrics = computeMetrics(series)
	const spanMs = series.length > 1 ? (series[series.length - 1]?.t ?? 0) - (series[0]?.t ?? 0) : 0

	heading('metrics, computed from that series by lib/metrics.ts')
	console.log(`  points        ${series.length}`)
	console.log(`  span          ${(spanMs / 1_000).toFixed(1)}s`)
	console.log(`  apy           ${metrics.apy === null ? 'null' : `${(metrics.apy * 100).toFixed(4)}%`}`)
	console.log(`  totalReturn   ${metrics.totalReturn === null ? 'null' : `${(metrics.totalReturn * 100).toFixed(6)}%`}`)
	console.log(`  maxDrawdown   ${metrics.maxDrawdown === null ? 'null' : `${(metrics.maxDrawdown * 100).toFixed(6)}%`}`)
	console.log(`  sharpe        ${metrics.sharpe === null ? 'null' : metrics.sharpe.toFixed(4)}`)

	if (metrics.apy === null) {
		throw new Error(
			`APY is still null after ${series.length} snapshot(s) spanning ${(spanMs / 1_000).toFixed(1)}s`,
		)
	}
}

async function main(): Promise<void> {
	migrateToLatest()
	if (!(await connectChain())) throw new Error('the chain is not usable — see the errors above')

	const oracle = await ensureOracle()
	console.log(`oracle for the enclave: ${oracle.url} (served by ${oracle.source})`)

	try {
		const strategy = await publishExample()
		const scheduler = getScheduler()

		console.log(`\nplatform float ${usd(await chain.usdc.balanceOf(chain.platformAddress()))}`)
		console.log(`vault reserve  ${usd((await chain.vault.vaultTotals(strategy.vaultAddress)).reserve)}`)

		// The vault has no depositors yet: applyPnl would revert with NoSharesOutstanding,
		// so the tick must record everything else and send nothing.
		const empty = await scheduler.tickOnce(strategy.strategyId)
		printTick('tick 1 of 4 — no depositors yet', empty)
		if (empty.txHash !== null) {
			throw new Error('applyPnl was sent against a vault with no shares outstanding')
		}
		if (db.select().from(navSnapshots).where(eq(navSnapshots.strategyId, strategy.strategyId)).all().length !== 1) {
			throw new Error('a tick with no depositors did not record a NAV snapshot')
		}

		await depositAsInvestor(strategy.vaultAddress)

		for (let i = 0; i < TICKS; i += 1) {
			if (i > 0 && GAP_SECONDS > 0) {
				console.log(`\nwaiting ${GAP_SECONDS}s so the NAV series spans long enough to annualise`)
				await sleep(GAP_SECONDS * 1_000)
			}
			printTick(`tick ${i + 2} of ${TICKS + 1} — funded`, await scheduler.tickOnce(strategy.strategyId))
		}

		report(strategy.strategyId)

		const totals = await chain.vault.vaultTotals(strategy.vaultAddress)
		heading('vault on chain, read back')
		console.log(`  address       ${strategy.vaultAddress}`)
		console.log(`  navPerShare   ${formatUnits(totals.navPerShare, 6)}`)
		console.log(`  managed       ${usd(totals.totalManagedAssets)}`)
		console.log(`  shares        ${formatAmount(totals.totalShares.toString())}`)
		console.log(`  reserve       ${usd(totals.reserve)}`)
	} finally {
		oracle.server?.close()
	}
}

try {
	await main()
	console.log('\nvalue loop OK')
} catch (error) {
	console.error('\nvalue loop FAILED', error)
	process.exitCode = 1
} finally {
	closeDatabase()
}
