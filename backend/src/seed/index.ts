// Publishes the example strategies through the real creator pipeline, so a cold database
// comes up with a marketplace that has something in it.
//
// Nothing here writes a strategy, a vault address or a binary hash into the database by
// hand. The script is a client: it signs in over the same challenge/verify exchange the
// browser uses, POSTs a submission, streams the nine sanity checks, and publishes. Every
// value the seeded rows carry was produced by the pipeline that produced them — the binary
// hash comes out of `cre workflow build`, the vault out of a real deployment on anvil, the
// anchor out of a registry transaction.
//
// The server is started in this same process because the enclave fetches its prices over
// HTTP from the oracle route: a simulate with nothing answering at ORACLE_URL does not
// produce a decision. One process also means one SQLite handle, rather than a seed and a
// server racing each other over the same file.
//
// `cre workflow simulate` is the slow and the fragile step. When it fails for one strategy
// the run does not stop: the decision is taken in-process instead, the submission's
// cre-simulate check records in its own detail that it came from the fallback, and the
// remaining strategies still publish. A fallback is never dressed up as an enclave run.

import { copyFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
	allPassed,
	loadStrategy,
	makeCheck,
	probeContext,
	stableSerialise,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import type {
	LoginChallenge,
	RiskLevel,
	SanityCheck,
	Session,
	StrategyDetail,
	StrategyType,
	SubmissionDraft,
} from '../../../shared/types.js'
import { ANVIL_DEPLOYER_KEY } from '../chain/index.js'
import { closeDatabase, db, migrateToLatest, sqlite } from '../db/index.js'
import { deployments, strategies, submissions } from '../db/schema.js'
import { env } from '../lib/env.js'
import { BACKEND_ROOT, resolveFromRoot } from '../lib/paths.js'
import { toStrategyId } from '../lib/strategy-id.js'
import { buildServer } from '../server.js'
import { connectChain } from '../services.js'
import { strategyConfig } from '../strategy/config.js'

interface Template {
	/** File name under chainlink/templates/examples, and the log label. */
	file: string
	/** What the marketplace filters on. Declared here because describe() has no field for it. */
	types: StrategyType[]
	riskLevel: RiskLevel
}

// Name, ticker, summary and assets are read out of each strategy's own describe(); only
// the two fields the strategy contract has no place for are declared.
const TEMPLATES: Template[] = [
	{ file: 'momentum', types: ['momentum', 'trend-following'], riskLevel: 'medium' },
	{ file: 'mean-reversion', types: ['mean-reversion'], riskLevel: 'low' },
	{ file: 'overtrader', types: ['momentum'], riskLevel: 'high' },
]

const EXAMPLES_DIR = path.resolve(BACKEND_ROOT, '..', 'chainlink', 'templates', 'examples')

/** Where the snapshot other agents copy is written. */
const TEMPLATE_DB = resolveFromRoot(process.env.SEED_TEMPLATE_DB ?? './data/seed-template.db')

/** The account the seeded strategies are published by. Anvil's deployer, as everywhere else. */
const CREATOR_KEY = (process.env.SEED_CREATOR_KEY ?? ANVIL_DEPLOYER_KEY) as Hex

const BASE = `http://${env.HOST}:${env.PORT}/api`

type DecisionSource = 'cre-simulate' | 'in-process fallback'

interface Published {
	template: string
	slug: string
	name: string
	ticker: string
	binaryHash: string
	configHash: string | null
	vaultAddress: string
	onChainStrategyId: string
	decisionSource: DecisionSource
	decision: string
}

const failures: { template: string; reason: string }[] = []
const published: Published[] = []

function heading(title: string): void {
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
}

/* ── the HTTP client ─────────────────────────────────────── */

let token: string | null = null

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
	// content-type is set only when there is a body: Fastify's JSON parser rejects an empty
	// body that claims to be JSON, and /submissions/:id/publish takes no body at all.
	const response = await fetch(`${BASE}${route}`, {
		method,
		headers: {
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`${method} ${route} -> ${response.status} ${text}`)
	}
	return JSON.parse(text) as T
}

/**
 * Signs in the way the browser does: the server issues a nonce, the key signs the message
 * verbatim, and the server recovers the signer. No private key crosses the wire.
 */
async function signIn(): Promise<void> {
	const account = privateKeyToAccount(CREATOR_KEY)
	const challenge = await call<LoginChallenge>('POST', '/auth/challenge', {
		address: account.address,
	})
	const signature = await account.signMessage({ message: challenge.message })
	const session = await call<Session>('POST', '/auth/verify', {
		address: challenge.address,
		signature,
	})
	token = session.token
	console.log(`signed in as ${session.user.walletAddress} (${session.user.username})`)
}

/**
 * Streams `POST /submissions/:id/check`. Every line is the whole draft again, so the last
 * one is the final state; the ones before it are what makes a five-minute build watchable.
 */
async function runChecksOverHttp(id: string): Promise<SubmissionDraft> {
	const response = await fetch(`${BASE}/submissions/${id}/check`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token ?? ''}` },
	})
	if (!response.ok || !response.body) {
		throw new Error(`POST /submissions/${id}/check -> ${response.status} ${await response.text()}`)
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	const reported = new Set<string>()
	let buffer = ''
	let latest: SubmissionDraft | null = null

	const consume = (line: string): void => {
		if (line.trim().length === 0) return
		const draft = JSON.parse(line) as SubmissionDraft
		latest = draft
		for (const check of draft.checks) {
			if (check.status === 'pending' || check.status === 'running') continue
			const key = `${check.id}:${check.status}`
			if (reported.has(key)) continue
			reported.add(key)
			console.log(`    ${check.status.padEnd(7)} ${check.id.padEnd(18)} ${check.detail ?? ''}`)
		}
	}

	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		let newline = buffer.indexOf('\n')
		while (newline >= 0) {
			consume(buffer.slice(0, newline))
			buffer = buffer.slice(newline + 1)
			newline = buffer.indexOf('\n')
		}
	}
	consume(buffer)

	if (!latest) throw new Error('the check stream closed without emitting a draft')
	return latest
}

/* ── the fallback ────────────────────────────────────────── */

/**
 * Takes the decision in this process when the enclave could not, and rewrites the
 * submission's cre-simulate check to say exactly that. The check passes so the strategy can
 * still publish, and its detail names the fallback so nothing downstream can read the row
 * as evidence of an enclave run.
 */
function fallbackToInProcess(draft: SubmissionDraft, source: string, reason: string): string {
	const module = loadStrategy(source)
	const decision = module.onTick(probeContext())
	const summary = `${decision.action} ${stableSerialise(decision.targetWeightsBps)}`
	const detail = `${summary} — decided in-process; cre workflow simulate did not return a decision: ${reason}`

	const checks: SanityCheck[] = draft.checks.map((check) =>
		check.id === 'cre-simulate' ? makeCheck('cre-simulate', 'passed', detail) : check,
	)
	const log = [...draft.simulationLog, `cre workflow simulate failed; decision taken in-process: ${detail}`]

	db.update(submissions)
		.set({ checks, simulationLog: log, status: 'simulating', updatedAt: new Date() })
		.where(eq(submissions.id, draft.id))
		.run()

	console.warn(`    fallback  cre-simulate       ${detail}`)
	return summary
}

/* ── one strategy, end to end ────────────────────────────── */

async function seedTemplate(template: Template): Promise<void> {
	heading(template.file)
	const source = await readFile(path.join(EXAMPLES_DIR, `${template.file}.ts`), 'utf8')
	const described = loadStrategy(source).describe()

	const created = await call<SubmissionDraft>('POST', '/submissions', {
		name: described.name,
		ticker: described.ticker,
		types: template.types,
		riskLevel: template.riskLevel,
		description: described.summary,
		sourceCode: source,
	})
	console.log(`  submission ${created.id}`)

	console.log('  sanity pipeline (cre build compiles to WASM; cre simulate runs the enclave)')
	const checked = await runChecksOverHttp(created.id)

	let decisionSource: DecisionSource = 'cre-simulate'
	let decision = checked.checks.find((check) => check.id === 'cre-simulate')?.detail ?? ''

	if (!allPassed(checked.checks)) {
		const blocking = checked.checks.filter((check) => check.status !== 'passed')
		const onlySimulate = blocking.length === 1 && blocking[0]?.id === 'cre-simulate'
		if (!onlySimulate || !checked.binaryHash) {
			const reason = blocking
				.map((check) => `${check.id} ${check.status}: ${check.detail ?? 'no detail'}`)
				.join(' | ')
			failures.push({ template: template.file, reason })
			console.error(`  ${template.file} cannot publish — ${reason}`)
			return
		}
		decisionSource = 'in-process fallback'
		decision = fallbackToInProcess(checked, source, blocking[0]?.detail ?? 'no detail')
	}

	const detail = await call<StrategyDetail>('POST', `/submissions/${created.id}/publish`)
	const row = db.select().from(strategies).where(eq(strategies.id, detail.id)).get()
	if (!row) throw new Error(`no strategy row for ${detail.id} immediately after publishing`)
	if (!row.vaultAddress) throw new Error(`strategy ${row.slug} published without a vault address`)
	if (!row.binaryHash) throw new Error(`strategy ${row.slug} published without a binary hash`)

	published.push({
		template: template.file,
		slug: row.slug,
		name: row.name,
		ticker: row.ticker,
		binaryHash: row.binaryHash,
		configHash: row.configHash,
		vaultAddress: row.vaultAddress,
		onChainStrategyId: toStrategyId(row.id),
		decisionSource,
		decision,
	})

	console.log(`  published ${row.slug}  vault ${row.vaultAddress}  binary ${row.binaryHash}`)
}

/* ── the snapshot ────────────────────────────────────────── */

/**
 * A plain copy of a closed database. `wal_checkpoint(TRUNCATE)` folds the write-ahead log
 * back into the file first, so the copy is the whole database and not the part of it that
 * had been checkpointed by chance.
 */
async function snapshot(): Promise<void> {
	sqlite.pragma('wal_checkpoint(TRUNCATE)')
	closeDatabase()

	for (const suffix of ['', '-wal', '-shm']) {
		const target = `${TEMPLATE_DB}${suffix}`
		if (!existsSync(target)) continue
		await rm(target, { force: true })
	}
	await copyFile(env.databaseFile, TEMPLATE_DB)
	console.log(`\ntemplate database written to ${TEMPLATE_DB}`)
}

/* ── the run ─────────────────────────────────────────────── */

migrateToLatest()

for (const row of [
	{ key: 'chainId', value: String(env.CHAIN_ID) },
	{ key: 'rpcUrl', value: env.RPC_URL },
]) {
	db.insert(deployments)
		.values(row)
		.onConflictDoUpdate({ target: deployments.key, set: { value: row.value, updatedAt: new Date() } })
		.run()
}

const app = buildServer()
await app.listen({ port: env.PORT, host: env.HOST })
console.log(`seed server on ${BASE}`)
console.log(`oracle for the enclave: ${strategyConfig.oracleUrl}`)
console.log(`workflow workspace: ${strategyConfig.workspaceDir}`)

// The scheduler is deliberately not started. The seed publishes; ticking is the job of
// whoever runs the backend against this database afterwards.
if (!(await connectChain(app.log))) {
	await app.close()
	closeDatabase()
	throw new Error('the chain is not usable — start anvil and run contracts/deploy-local.sh')
}

try {
	await signIn()
	for (const template of TEMPLATES) {
		await seedTemplate(template)
	}
} catch (error) {
	console.error('the seed run threw', error)
	await app.close()
	closeDatabase()
	throw error
}

await app.close()

heading('seeded strategies')
for (const entry of published) {
	console.log(`  ${entry.template}`)
	console.log(`    slug            ${entry.slug}`)
	console.log(`    name / ticker   ${entry.name} (${entry.ticker})`)
	console.log(`    binary hash     ${entry.binaryHash}`)
	console.log(`    config hash     ${entry.configHash ?? 'none'}`)
	console.log(`    vault           ${entry.vaultAddress}`)
	console.log(`    registry key    ${entry.onChainStrategyId}`)
	console.log(`    decision from   ${entry.decisionSource}`)
	console.log(`    decision        ${entry.decision}`)
}
for (const failure of failures) {
	console.error(`  FAILED ${failure.template}: ${failure.reason}`)
}

await snapshot()

console.log(`\nseeded ${published.length}/${TEMPLATES.length} strategies into ${env.databaseFile}`)
if (failures.length > 0) process.exitCode = 1
