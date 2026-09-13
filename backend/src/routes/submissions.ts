// The creator's side: a draft, its encrypted parameters, the sanity pipeline, and publish.
//
// Three properties of this file are load-bearing rather than incidental:
//
//   secrets are ciphertext only. The route checks every parameter against the envelope rule
//   in lib/secret-envelope.ts and refuses anything that could be read, because the trust
//   claim in docs/project-overview.md is that the platform relays parameters it cannot
//   open — and a single plaintext value quietly accepted here would make that claim false
//   without anything appearing to break.
//
//   editing the source invalidates the checks. A submission whose code changed after it
//   passed is a submission that has not been checked, so the checks go back to pending and
//   the recorded binary hash is dropped with them.
//
//   publish refuses unless all nine checks passed. That is what "it lists once simulation
//   is successful" means, and it is enforced here as well as in publishSubmission.
//
// `POST /submissions/:id/check` streams. A `cre workflow build` is a bun compile to WASM —
// a minute or more — so the run emits the whole draft again after every check resolves,
// newline-delimited, and the creator watches the list fill in rather than watching a
// spinner. `GET /submissions/:id` returns the same state for anyone who would rather poll.

import { randomUUID } from 'node:crypto'
import type { OutgoingHttpHeaders } from 'node:http'
import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
	allPassed,
	CHECK_ORDER,
	makeCheck,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import type {
	SanityCheck,
	StrategyDetail,
	StrategyStatus,
	SubmissionDraft,
} from '../../../shared/types.js'
import { db } from '../db/index.js'
import { secrets, strategies, submissions, type SubmissionRow } from '../db/schema.js'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
import { envelopeComplaint } from '../lib/secret-envelope.js'
import { requireAuth, requireUser } from '../lib/session.js'
import { getChainPort } from '../services.js'
import { publishSubmission, runChecks } from '../strategy/index.js'
import { buildDetail } from './dto.js'

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

/** Generous: a strategy is one file, but a well-commented one. */
const MAX_SOURCE_CHARS = 200_000

const metadata = {
	name: z.string().trim().min(3, 'name must be at least 3 characters').max(80),
	ticker: z
		.string()
		.trim()
		.regex(/^[A-Za-z0-9]{2,10}$/, 'ticker must be 2 to 10 letters or digits'),
	types: z.array(z.enum(STRATEGY_TYPES)).min(1, 'pick at least one strategy type'),
	riskLevel: z.enum(RISK_LEVELS),
	description: z.string().trim().max(4_000),
	sourceCode: z.string().max(MAX_SOURCE_CHARS, 'the strategy source is too large'),
}

const createBody = z.object({
	name: metadata.name,
	ticker: metadata.ticker,
	types: metadata.types,
	riskLevel: metadata.riskLevel,
	description: metadata.description.default(''),
	sourceCode: metadata.sourceCode.default(''),
})

const patchBody = z
	.object({
		name: metadata.name.optional(),
		ticker: metadata.ticker.optional(),
		types: metadata.types.optional(),
		riskLevel: metadata.riskLevel.optional(),
		description: metadata.description.optional(),
		sourceCode: metadata.sourceCode.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, 'nothing to update')

const idParams = z.object({ id: z.string().trim().min(1).max(64) })

const secretsBody = z
	.array(
		z.object({
			key: z
				.string()
				.trim()
				.regex(/^[A-Za-z0-9_.-]{1,64}$/, 'a secret key is 1 to 64 letters, digits, dot, dash or underscore'),
			ciphertext: z.string().trim().min(1, 'ciphertext is required'),
			scheme: z.enum(['tdh2-p256-aesgcm', 'local-dev']),
		}),
	)
	.max(32, 'a strategy may declare at most 32 parameters')

export async function submissionRoutes(app: FastifyInstance): Promise<void> {
	app.post('/submissions', { preHandler: requireAuth }, async (request, reply): Promise<SubmissionDraft> => {
		const user = requireUser(request)
		const body = createBody.parse(request.body)

		const row = db
			.insert(submissions)
			.values({
				id: randomUUID(),
				creatorId: user.id,
				name: body.name,
				ticker: body.ticker.toUpperCase(),
				types: body.types,
				riskLevel: body.riskLevel,
				description: body.description,
				sourceCode: body.sourceCode,
				checks: pendingChecks(),
				simulationLog: [],
				status: 'draft',
			})
			.returning()
			.get()
		if (!row) throw conflict('the submission row disappeared immediately after insert')

		request.log.info({ submissionId: row.id, creatorId: user.id }, 'submission created')
		reply.status(201)
		return toDraft(row)
	})

	app.patch('/submissions/:id', { preHandler: requireAuth }, async (request): Promise<SubmissionDraft> => {
		const { id } = idParams.parse(request.params)
		const body = patchBody.parse(request.body)
		const submission = requireOwnedSubmission(request, id)
		requireEditable(submission)

		const patch: Partial<typeof submissions.$inferInsert> = { updatedAt: new Date() }
		if (body.name !== undefined) patch.name = body.name
		if (body.ticker !== undefined) patch.ticker = body.ticker.toUpperCase()
		if (body.types !== undefined) patch.types = body.types
		if (body.riskLevel !== undefined) patch.riskLevel = body.riskLevel
		if (body.description !== undefined) patch.description = body.description

		// New code is unchecked code. Keeping the old passes would let a submission publish a
		// binary nothing ever built, so they go back to pending along with the hashes that
		// described the source they were run against.
		if (body.sourceCode !== undefined && body.sourceCode !== submission.sourceCode) {
			patch.sourceCode = body.sourceCode
			patch.checks = pendingChecks()
			patch.simulationLog = []
			patch.binaryHash = null
			patch.configHash = null
			patch.status = 'draft'
			request.log.info({ submissionId: id }, 'source changed: the sanity checks were reset to pending')
		}

		return toDraft(update(id, patch))
	})

	// Ciphertext only. The platform never holds a value it could read, so there is no
	// endpoint that takes one — this is the whole of the secrets surface.
	app.post('/submissions/:id/secrets', { preHandler: requireAuth }, async (request): Promise<SubmissionDraft> => {
		const { id } = idParams.parse(request.params)
		const body = secretsBody.parse(request.body)
		const submission = requireOwnedSubmission(request, id)
		requireEditable(submission)

		for (const secret of body) {
			const complaint = envelopeComplaint(secret.ciphertext, secret.scheme)
			if (complaint) {
				request.log.warn(
					{ submissionId: id, key: secret.key, scheme: secret.scheme, complaint },
					'refused a submission parameter that does not look encrypted',
				)
				throw badRequest(
					`parameter "${secret.key}" does not look encrypted: ${complaint}. Encrypt in the browser and send the envelope — attesta never accepts a readable value.`,
				)
			}
		}

		const keys = new Set(body.map((secret) => secret.key))
		if (keys.size !== body.length) throw badRequest('two parameters share the same key')

		// The set posted is the set held: a key the creator removed must stop being relayed.
		db.transaction((tx) => {
			tx.delete(secrets).where(eq(secrets.submissionId, id)).run()
			for (const secret of body) {
				tx.insert(secrets)
					.values({
						id: randomUUID(),
						submissionId: id,
						strategyId: null,
						key: secret.key,
						ciphertext: secret.ciphertext,
						scheme: secret.scheme,
					})
					.run()
			}
		})

		request.log.info({ submissionId: id, keys: [...keys] }, 'stored encrypted parameters')
		return toDraft(update(id, { updatedAt: new Date() }))
	})

	app.get('/submissions/:id', { preHandler: requireAuth }, async (request): Promise<SubmissionDraft> => {
		const { id } = idParams.parse(request.params)
		return toDraft(requireOwnedSubmission(request, id))
	})

	app.post('/submissions/:id/check', { preHandler: requireAuth }, async (request, reply) => {
		const { id } = idParams.parse(request.params)
		const submission = requireOwnedSubmission(request, id)
		requireEditable(submission)
		if (submission.sourceCode.trim().length === 0) {
			throw badRequest('there is no source to check: save the strategy first')
		}
		if (running.has(id)) {
			throw conflict('the sanity pipeline is already running for this submission')
		}
		return streamChecks(request, reply, submission)
	})

	app.post('/submissions/:id/publish', { preHandler: requireAuth }, async (request): Promise<StrategyDetail> => {
		const { id } = idParams.parse(request.params)
		const user = requireUser(request)
		const submission = requireOwnedSubmission(request, id)

		// Refused here as well as inside publishSubmission: this is the sentence the creator
		// reads, and it names the check that is holding them up.
		const blocker = failingCheck(submission.checks)
		if (blocker) {
			throw conflict(
				`"${blocker.label}" has not passed (${blocker.status}), so this strategy cannot publish`,
				{ check: blocker },
			)
		}

		const result = await publishSubmission({
			submissionId: id,
			chain: getChainPort(request.log),
			logger: request.log,
		})

		const strategy = db.select().from(strategies).where(eq(strategies.id, result.strategyId)).get()
		if (!strategy) throw conflict('the strategy row is missing immediately after publishing')

		request.log.info(
			{
				submissionId: id,
				strategyId: result.strategyId,
				slug: result.slug,
				vaultAddress: result.vaultAddress,
				onChainStrategyId: result.onChainStrategyId,
				alreadyPublished: result.alreadyPublished,
			},
			'published a submission',
		)
		return buildDetail(getChainPort(request.log), strategy, user.id, request.log)
	})
}

/* ── Streaming the pipeline ──────────────────────────────── */

/**
 * One run per submission. Two concurrent runs would generate into the same workflow
 * directory and race each other's `cre workflow build`, so the second is refused rather
 * than left to produce whichever binary finished last.
 */
const running = new Set<string>()

async function streamChecks(
	request: FastifyRequest,
	reply: FastifyReply,
	submission: SubmissionRow,
): Promise<void> {
	const id = submission.id
	running.add(id)

	// Written straight to the socket: the point of this route is that each line lands as its
	// check resolves, which a buffered JSON response cannot do.
	//
	// Hijacking takes the reply away from Fastify before it flushes, so the headers its
	// hooks have already computed — CORS above all — have to be carried onto the raw
	// response by hand. Without them the browser blocks the whole response and the
	// creator watches nine checks that never arrive, while the server logs a run that
	// completed. The stream's own headers are written last so they win.
	reply.hijack()
	const headers: OutgoingHttpHeaders = {}
	for (const [name, value] of Object.entries(reply.getHeaders())) {
		if (value !== undefined) headers[name] = value
	}
	headers['content-type'] = 'application/x-ndjson; charset=utf-8'
	headers['cache-control'] = 'no-store'
	headers.connection = 'keep-alive'
	reply.raw.writeHead(200, headers)

	let aborted = false
	const onClose = () => {
		aborted = true
	}
	request.raw.on('close', onClose)

	let checks: SanityCheck[] = pendingChecks()
	const simulationLog: string[] = []
	let binaryHash: string | null = null
	let configHash: string | null = null

	const write = (status: StrategyStatus): void => {
		if (aborted || reply.raw.writableEnded) return
		const row = update(id, {
			checks,
			simulationLog,
			binaryHash,
			configHash,
			status,
			updatedAt: new Date(),
		})
		reply.raw.write(`${JSON.stringify(toDraft(row))}\n`)
	}

	const iterator = runChecks(submission.sourceCode, { key: id, logger: request.log })
	try {
		write('checking')
		for (;;) {
			const step = await iterator.next()
			if (step.done) {
				const result = step.value
				checks = result.checks
				binaryHash = result.binaryHash
				configHash = result.configHash
				for (const line of result.simulationLog) {
					if (!simulationLog.includes(line)) simulationLog.push(line)
				}
				// `simulating` is the honest end state for a submission that passed: it has run
				// in the simulator and is waiting to be published, not live.
				write(result.passed ? 'simulating' : 'failed')
				request.log.info(
					{ submissionId: id, passed: result.passed, durationMs: result.durationMs },
					'sanity pipeline finished',
				)
				break
			}

			const event = step.value
			if (event.type === 'check') {
				checks = mergeCheck(checks, event.check)
				write('checking')
			} else if (event.type === 'log') {
				simulationLog.push(event.line)
				write('checking')
			}

			if (aborted) {
				// The creator navigated away or restarted the run. Close the generator so a
				// `cre` child process is not left compiling for a reader that has gone.
				request.log.info({ submissionId: id }, 'the sanity pipeline stream was abandoned by its client')
				await iterator.return(undefined as never).catch((error: unknown) => {
					request.log.warn({ err: error, submissionId: id }, 'could not close the pipeline cleanly')
				})
				break
			}
		}
	} catch (error) {
		request.log.error({ err: error, submissionId: id }, 'the sanity pipeline threw')
		if (!aborted && !reply.raw.writableEnded) {
			const detail = error instanceof Error ? error.message : String(error)
			checks = checks.map((check) =>
				check.status === 'running' ? makeCheck(check.id, 'failed', detail) : check,
			)
			write('failed')
		}
	} finally {
		running.delete(id)
		request.raw.off('close', onClose)
		if (!reply.raw.writableEnded) reply.raw.end()
	}
}

function mergeCheck(checks: readonly SanityCheck[], next: SanityCheck): SanityCheck[] {
	const merged = checks.map((check) => (check.id === next.id ? next : check))
	return merged.some((check) => check.id === next.id) ? merged : [...merged, next]
}

/* ── Rows and validation ─────────────────────────────────── */

const pendingChecks = (): SanityCheck[] => CHECK_ORDER.map((id) => makeCheck(id, 'pending'))

/** The check standing between this submission and publishing, or null when none is. */
function failingCheck(checks: readonly SanityCheck[]): SanityCheck | null {
	if (checks.length === CHECK_ORDER.length && allPassed(checks)) return null
	for (const id of CHECK_ORDER) {
		const check = checks.find((candidate) => candidate.id === id)
		if (!check) return makeCheck(id, 'pending', 'this check has not been run')
		if (check.status !== 'passed') return check
	}
	return makeCheck('parses', 'pending', 'the sanity pipeline has not been run')
}

function requireOwnedSubmission(request: FastifyRequest, id: string): SubmissionRow {
	const user = requireUser(request)
	const row = db.select().from(submissions).where(eq(submissions.id, id)).get()
	if (!row) throw notFound(`no submission ${id}`)
	if (row.creatorId !== user.id) {
		request.log.warn({ submissionId: id, userId: user.id }, 'a caller asked for someone else’s draft')
		throw forbidden('this submission belongs to another creator')
	}
	return row
}

/** A published submission is the audit trail of what went live; it stops being editable. */
function requireEditable(submission: SubmissionRow): void {
	if (submission.status === 'live' || submission.strategyId) {
		throw conflict('this submission has already been published, so it can no longer be changed')
	}
}

function update(id: string, patch: Partial<typeof submissions.$inferInsert>): SubmissionRow {
	const row = db.update(submissions).set(patch).where(eq(submissions.id, id)).returning().get()
	if (!row) throw notFound(`no submission ${id}`)
	return row
}

function secretKeys(submissionId: string): string[] {
	return db
		.select({ key: secrets.key })
		.from(secrets)
		.where(eq(secrets.submissionId, submissionId))
		.orderBy(asc(secrets.key))
		.all()
		.map((row) => row.key)
}

/** Keys only. A ciphertext column exists; nothing reads it back out over the wire. */
function toDraft(row: SubmissionRow): SubmissionDraft {
	return {
		id: row.id,
		name: row.name,
		ticker: row.ticker,
		types: row.types,
		riskLevel: row.riskLevel,
		description: row.description,
		sourceCode: row.sourceCode,
		secretKeys: secretKeys(row.id),
		checks: row.checks,
		simulationLog: row.simulationLog,
		binaryHash: row.binaryHash,
		configHash: row.configHash,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
	}
}
