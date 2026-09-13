// Publishing a submission that passed the pipeline.
//
// Six things have to happen, five of them on-chain, and any of them can be
// interrupted: a vault deployment that lands but whose address is never written
// back would strand real state on the chain. So each step is guarded by its own
// "has this already happened?" read and the whole thing is safe to call twice —
// the second call reports what it skipped rather than deploying a second vault.
//
//   1  strategy row, linked to the submission in one transaction, before any
//      chain work — that link is what makes every later step resumable
//   2  agent wallet: the vault's operator, funded with gas
//   3  vault deployment
//   4  reserve prefund, so a gain is payable
//   5  registry anchor: strategy id -> vault, binary hash, creator
//   6  the generated workflow directory adopted under the strategy's slug, so
//      the binary that passed cre-simulate is the one the scheduler keeps
//      simulating

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
	allPassed,
	loadStrategy as loadStrategyModule,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import type { StrategyType } from '../../../shared/types.js'
import { db as defaultDb, type Db } from '../db/index.js'
import {
	secrets,
	strategies,
	submissions,
	users,
	type StrategyRow,
	type SubmissionRow,
} from '../db/schema.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { toBigInt } from '../lib/money.js'
import { toStrategyId } from '../lib/strategy-id.js'
import { strategyConfig } from './config.js'
import { consoleLogger, type ChainPort, type Logger } from './ports.js'
import { discoverSecretIds } from './secrets.js'
import { ensureWorkflow, moveWorkspace, openWorkspace, slugify, writeMeta } from './workspace.js'

/**
 * The identifier the registry is keyed by: keccak256 of the platform id, so
 * anyone holding a strategy's public id can find its anchor without a lookup
 * table. Re-exported from lib/strategy-id.ts rather than recomputed, because the
 * chain layer keys on the very same function.
 */
export { toStrategyId as onChainStrategyId } from '../lib/strategy-id.js'

export type PublishStepName =
	| 'strategy-row'
	| 'agent-wallet'
	| 'gas'
	| 'vault'
	| 'reserve'
	| 'registry'
	| 'workflow'
	| 'secrets'
	| 'live'

export interface PublishStep {
	name: PublishStepName
	status: 'done' | 'skipped'
	detail: string
	txHash?: Hex
}

export interface PublishResult {
	strategyId: string
	/** The bytes32 the registry anchored this strategy under. */
	onChainStrategyId: Hex
	slug: string
	vaultAddress: Address
	agentWalletAddress: Address
	binaryHash: string
	workflowDir: string
	/** True when the submission was already live and nothing new was deployed. */
	alreadyPublished: boolean
	steps: PublishStep[]
}

export interface PublishOptions {
	submissionId: string
	chain: ChainPort
	db?: Db
	logger?: Logger
	/** Reserve prefund in USDC base units. Defaults to VAULT_RESERVE_USDC. */
	reserveBaseUnits?: string
	/** Values for the strategy's secret ids, if the platform ever holds any. */
	secretValues?: Record<string, string>
}

// Publishing is not reentrant within a process: two concurrent calls would both
// read "no vault yet" before either wrote one. Serialised per submission.
const inFlight = new Map<string, Promise<PublishResult>>()

export function publishSubmission(options: PublishOptions): Promise<PublishResult> {
	const existing = inFlight.get(options.submissionId)
	if (existing) return existing

	const run = publish(options).finally(() => {
		inFlight.delete(options.submissionId)
	})
	inFlight.set(options.submissionId, run)
	return run
}

async function publish(options: PublishOptions): Promise<PublishResult> {
	const db = options.db ?? defaultDb
	const logger = options.logger ?? consoleLogger
	const { chain } = options
	const steps: PublishStep[] = []

	const submission = db
		.select()
		.from(submissions)
		.where(eq(submissions.id, options.submissionId))
		.get()
	if (!submission) throw notFound(`no submission ${options.submissionId}`)
	if (submission.sourceCode.trim().length === 0) throw badRequest('submission has no source')
	if (!allPassed(submission.checks)) {
		throw badRequest('submission has not passed every sanity check')
	}
	if (!submission.binaryHash) {
		throw badRequest('submission has no binary hash: run the cre checks before publishing')
	}

	const module = loadStrategyModule(submission.sourceCode)
	const described = module.describe()

	// ── 1 strategy row ──────────────────────────────────────────
	let strategy = resolveStrategy(db, submission)
	if (strategy) {
		steps.push({ name: 'strategy-row', status: 'skipped', detail: `strategy ${strategy.id} already exists` })
	} else {
		const slug = uniqueSlug(db, submission.ticker || described.ticker || described.name)
		const id = randomUUID()
		const row = {
			id,
			slug,
			name: submission.name || described.name,
			ticker: (submission.ticker || described.ticker).toUpperCase(),
			types: submission.types as StrategyType[],
			riskLevel: submission.riskLevel,
			description: submission.description || described.summary,
			status: 'draft' as const,
			creatorId: submission.creatorId,
			sourceCode: submission.sourceCode,
			binaryHash: submission.binaryHash,
			configHash: submission.configHash,
			// No workflow is deployed to a DON locally, so the only honest id is
			// the name the CRE CLI knows this workflow by.
			workflowId: `attesta-${slugify(slug)}`,
			assets: described.assets,
		}

		// The row and the link land together: a crash after this point resumes,
		// a crash before it leaves nothing behind.
		db.transaction((tx) => {
			tx.insert(strategies).values(row).run()
			tx.update(submissions)
				.set({ strategyId: id, updatedAt: new Date() })
				.where(eq(submissions.id, submission.id))
				.run()
		})

		strategy = db.select().from(strategies).where(eq(strategies.id, id)).get() ?? null
		if (!strategy) throw conflict('strategy row disappeared immediately after insert')
		steps.push({ name: 'strategy-row', status: 'done', detail: `created ${strategy.id} (${slug})` })
	}

	// ── 2 agent wallet ──────────────────────────────────────────
	let agentKey = strategy.agentWalletKey as Hex | null
	let agentAddress = strategy.agentWalletAddress as Address | null
	if (!agentKey || !agentAddress) {
		const key = generatePrivateKey()
		const account = privateKeyToAccount(key)
		agentKey = key
		agentAddress = account.address
		db.update(strategies)
			.set({ agentWalletKey: key, agentWalletAddress: account.address, updatedAt: new Date() })
			.where(eq(strategies.id, strategy.id))
			.run()
		steps.push({ name: 'agent-wallet', status: 'done', detail: `generated ${account.address}` })
	} else {
		steps.push({ name: 'agent-wallet', status: 'skipped', detail: `already ${agentAddress}` })
	}

	const funded = await chain.fundGas({ address: agentAddress })
	steps.push(
		funded
			? { name: 'gas', status: 'done', detail: `funded ${agentAddress}`, txHash: funded.txHash }
			: { name: 'gas', status: 'skipped', detail: 'agent wallet already holds gas' },
	)

	// ── 3 vault ─────────────────────────────────────────────────
	let vaultAddress = strategy.vaultAddress as Address | null
	if (!vaultAddress) {
		const deployed = await chain.deployVault({ name: strategy.name, operator: agentAddress })
		vaultAddress = deployed.vaultAddress
		db.update(strategies)
			.set({ vaultAddress: deployed.vaultAddress, updatedAt: new Date() })
			.where(eq(strategies.id, strategy.id))
			.run()
		steps.push({
			name: 'vault',
			status: 'done',
			detail: `deployed ${deployed.vaultAddress}`,
			txHash: deployed.txHash,
		})
	} else {
		steps.push({ name: 'vault', status: 'skipped', detail: `already ${vaultAddress}` })
	}

	// ── 4 reserve ───────────────────────────────────────────────
	const target = toBigInt(options.reserveBaseUnits ?? strategyConfig.reserveBaseUnits)
	const totals = await chain.readVault(vaultAddress)
	if (totals.reserve < target) {
		const amount = target - totals.reserve
		const receipt = await chain.fundReserve({ vaultAddress, amount })
		steps.push({
			name: 'reserve',
			status: 'done',
			detail: `topped up by ${amount} to ${target} base units`,
			txHash: receipt.txHash,
		})
	} else {
		steps.push({
			name: 'reserve',
			status: 'skipped',
			detail: `reserve already ${totals.reserve} base units`,
		})
	}

	// ── 5 registry ──────────────────────────────────────────────
	// Hashed exactly once, here, and passed as bytes32 from this point on.
	const registryKey = toStrategyId(strategy.id)
	const binaryHash = strategy.binaryHash ?? submission.binaryHash
	const creator = creatorAddress(db, strategy.creatorId)
	if (await chain.isStrategyRegistered(registryKey)) {
		steps.push({
			name: 'registry',
			status: 'skipped',
			detail: `already anchored as ${registryKey}`,
		})
	} else {
		const receipt = await chain.registerStrategy({
			onChainStrategyId: registryKey,
			vaultAddress,
			binaryHash,
			creator,
		})
		steps.push({
			name: 'registry',
			status: 'done',
			detail: `anchored ${registryKey} -> ${vaultAddress} @ ${binaryHash}`,
			txHash: receipt.txHash,
		})
	}

	// ── 6 workflow directory ────────────────────────────────────
	const live = await openWorkspace('strategies', strategy.slug)
	let workflowDir: string
	if (live) {
		workflowDir = live.dir
		steps.push({ name: 'workflow', status: 'skipped', detail: `already at ${live.dir}` })
	} else {
		const draft = await openWorkspace('submissions', submission.id)
		if (draft) {
			const moved = await moveWorkspace(draft, 'strategies', strategy.slug, logger)
			await writeMeta(moved.dir, { ...moved.meta, binaryHash, configHash: strategy.configHash })
			workflowDir = moved.dir
			steps.push({ name: 'workflow', status: 'done', detail: `adopted ${moved.dir}` })
		} else {
			// The checked directory is gone — regenerate from the same source. The
			// WASM is rebuilt by the next simulate; the recorded hash stands until
			// then because the source it was built from has not changed.
			logger.warn(
				{ submissionId: submission.id, strategyId: strategy.id },
				'checked workflow directory is missing; regenerating from source',
			)
			const generated = await ensureWorkflow({
				scope: 'strategies',
				key: strategy.slug,
				source: submission.sourceCode,
				secretIds: discoverSecretIds(module, { logger }),
				secretValues: options.secretValues,
				logger,
				tick: { totalAssets: '0', currentWeightsBps: {} },
			})
			await writeMeta(generated.dir, { ...generated.meta, binaryHash, configHash: strategy.configHash })
			workflowDir = generated.dir
			steps.push({ name: 'workflow', status: 'done', detail: `regenerated ${generated.dir}` })
		}
	}

	// ── secrets ─────────────────────────────────────────────────
	const carried = carrySecrets(db, submission.id, strategy.id)
	steps.push(
		carried > 0
			? { name: 'secrets', status: 'done', detail: `carried ${carried} encrypted secret(s)` }
			: { name: 'secrets', status: 'skipped', detail: 'no encrypted secrets to carry' },
	)

	// ── live ────────────────────────────────────────────────────
	const alreadyPublished = strategy.status === 'live' && submission.status === 'live'
	if (!alreadyPublished) {
		const at = new Date()
		db.transaction((tx) => {
			tx.update(strategies).set({ status: 'live', updatedAt: at }).where(eq(strategies.id, strategy.id)).run()
			tx.update(submissions)
				.set({ status: 'live', updatedAt: at })
				.where(eq(submissions.id, submission.id))
				.run()
		})
		steps.push({ name: 'live', status: 'done', detail: 'status set to live' })
	} else {
		steps.push({ name: 'live', status: 'skipped', detail: 'already live' })
	}

	logger.info(
		{ strategyId: strategy.id, slug: strategy.slug, vaultAddress, steps },
		'published strategy',
	)

	return {
		strategyId: strategy.id,
		onChainStrategyId: registryKey,
		slug: strategy.slug,
		vaultAddress,
		agentWalletAddress: agentAddress,
		binaryHash,
		workflowDir,
		alreadyPublished,
		steps,
	}
}

function resolveStrategy(db: Db, submission: SubmissionRow): StrategyRow | null {
	if (!submission.strategyId) return null
	const row = db.select().from(strategies).where(eq(strategies.id, submission.strategyId)).get()
	if (!row) throw conflict(`submission ${submission.id} points at a strategy that does not exist`)
	return row
}

function uniqueSlug(db: Db, seed: string): string {
	const base = slugify(seed)
	for (let suffix = 0; suffix < 100; suffix++) {
		const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`
		const taken = db.select({ id: strategies.id }).from(strategies).where(eq(strategies.slug, candidate)).get()
		if (!taken) return candidate
	}
	throw conflict(`could not find a free slug for "${seed}"`)
}

function creatorAddress(db: Db, creatorId: string): Address {
	const row = db.select().from(users).where(eq(users.id, creatorId)).get()
	if (!row) throw notFound(`no user ${creatorId}`)
	return row.walletAddress as Address
}

/** Moves the submission's ciphertext onto the strategy. Values are never read. */
function carrySecrets(db: Db, submissionId: string, strategyId: string): number {
	const rows = db.select().from(secrets).where(eq(secrets.submissionId, submissionId)).all()
	let carried = 0
	for (const row of rows) {
		const already = db
			.select({ id: secrets.id })
			.from(secrets)
			.where(and(eq(secrets.strategyId, strategyId), eq(secrets.key, row.key)))
			.get()
		if (already) continue
		db.insert(secrets)
			.values({
				id: randomUUID(),
				submissionId: null,
				strategyId,
				key: row.key,
				ciphertext: row.ciphertext,
				scheme: row.scheme,
			})
			.run()
		carried++
	}
	return carried
}
