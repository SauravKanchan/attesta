// The creator submission pipeline: nine checks, in the order docs/build-plan.md
// sets out, stopping at the first failure.
//
// The analysis itself belongs to @attesta/strategy-toolkit and is not repeated
// here. What this adds is the two things a submission route needs and the
// toolkit's one-shot runPipeline cannot give it:
//
//   observable   every check is emitted the moment it resolves, as `running`
//                then as its result, so progress can be streamed while a
//                `cre workflow build` takes its minute
//   resumable    a run can be handed the checks an earlier run recorded and
//                pick up after any of them, which is what makes re-simulating
//                a submission cheap
//
// It also keeps the generated workflow directory instead of discarding it, so
// the binary that passed cre-simulate is the binary the strategy publishes with.

import type { StrategyDescription, StrategyModule, TickDecision } from '../../../shared/strategy-contract.js'
import type { SanityCheck } from '../../../shared/types.js'
import {
	analyse,
	CHECK_ORDER,
	checkDescribe,
	checkDeterminism,
	errorText,
	loadStrategy,
	makeCheck,
	typecheck,
	type CheckId,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import { consoleLogger, type Logger } from './ports.js'
import { discoverSecretIds } from './secrets.js'
import { buildWorkspace, creAvailable, failureDetail, simulateWorkspace } from './simulate.js'
import { ensureWorkflow, type Workspace, recordHashes } from './workspace.js'

export type { CheckId }

export type CheckEvent =
	| { type: 'check'; check: SanityCheck }
	| { type: 'log'; line: string }
	| { type: 'done'; result: CheckRunResult }

export interface CheckRunResult {
	checks: SanityCheck[]
	/** `[USER LOG]` and simulator lines, in order — the submission's simulation log. */
	simulationLog: string[]
	binaryHash: string | null
	configHash: string | null
	decision: TickDecision | null
	/** Kept generated directory, ready for the scheduler to adopt on publish. */
	workflowDir: string | null
	workspaceKey: string
	/** Secret ids the strategy asked for, declared to the Vault for the run. */
	requestedSecrets: string[]
	describe: StrategyDescription | null
	passed: boolean
	durationMs: number
}

export interface RunChecksOptions {
	/** Workspace key; the submission id in normal use. */
	key?: string
	/** Stop before the two cre checks — the fast path for an editor. */
	skipCre?: boolean
	/** Checks an earlier run recorded, used to resume. */
	priorChecks?: readonly SanityCheck[]
	/** Re-run only the checks after this one, taking earlier ones from priorChecks. */
	resumeAfter?: CheckId
	/** Values for the strategy's secret ids. Empty locally: the platform holds ciphertext only. */
	secretValues?: Record<string, string>
	/** USDC under management written into the simulated tick's config, 6dp integer string. */
	totalAssets?: string
	currentWeightsBps?: Record<string, number>
	logger?: Logger
	/** Mirror of the yielded events, for an emitter-style consumer. */
	onEvent?: (event: CheckEvent) => void
}

const LOAD_FAILURE_CHECK: CheckId = 'describe-valid'

const pendingRest = (done: readonly SanityCheck[], detail: string | null = null): SanityCheck[] =>
	CHECK_ORDER.slice(done.length).map((id) => makeCheck(id, 'pending', detail))

/**
 * Runs the pipeline, yielding each check as it resolves. The final value is the
 * whole run; a caller that only wants the end state can use
 * `runChecksToCompletion`.
 */
export async function* runChecks(
	source: string,
	options: RunChecksOptions = {},
): AsyncGenerator<CheckEvent, CheckRunResult> {
	const logger = options.logger ?? consoleLogger
	const startedAt = Date.now()
	const key = options.key ?? 'scratch'
	const prior = new Map((options.priorChecks ?? []).map((check) => [check.id, check]))
	const resumeIndex = options.resumeAfter ? CHECK_ORDER.indexOf(options.resumeAfter) : -1

	const checks: SanityCheck[] = []
	const simulationLog: string[] = []
	let module: StrategyModule | null = null
	let describe: StrategyDescription | null = null
	let requestedSecrets: string[] = []
	let workspace: Workspace | null = null
	let binaryHash: string | null = null
	let configHash: string | null = null
	let decision: TickDecision | null = null

	const result = (): CheckRunResult => ({
		checks,
		simulationLog,
		binaryHash,
		configHash,
		decision,
		workflowDir: workspace?.dir ?? null,
		workspaceKey: key,
		requestedSecrets,
		describe,
		passed: checks.length === CHECK_ORDER.length && checks.every((check) => check.status === 'passed'),
		durationMs: Date.now() - startedAt,
	})

	// A resumed check is reported from what the earlier run recorded, so a
	// resumed run still emits all nine in order rather than starting mid-list.
	const resumed = (id: CheckId): SanityCheck =>
		prior.get(id) ?? makeCheck(id, 'passed', 'carried over from the previous run')

	const push = (event: CheckEvent): CheckEvent => {
		options.onEvent?.(event)
		return event
	}

	// ── 1..4 static analysis ────────────────────────────────────
	const staticIds = CHECK_ORDER.slice(0, 4)
	const staticChecks = resumeIndex >= 3 ? staticIds.map(resumed) : analyse(source)

	for (const check of staticChecks) {
		yield push({ type: 'check', check: makeCheck(check.id, 'running') })
		checks.push(check)
		yield push({ type: 'check', check })
		if (check.status !== 'passed') {
			for (const rest of pendingRest(checks)) {
				checks.push(rest)
				yield push({ type: 'check', check: rest })
			}
			const done = result()
			yield push({ type: 'done', result: done })
			return done
		}
	}

	// ── 5 typechecks ────────────────────────────────────────────
	yield push({ type: 'check', check: makeCheck('typechecks', 'running') })
	const typecheckResult = resumeIndex >= 4 ? resumed('typechecks') : await typecheck(source)
	checks.push(typecheckResult)
	yield push({ type: 'check', check: typecheckResult })
	if (typecheckResult.status !== 'passed') {
		for (const rest of pendingRest(checks)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	// ── 6 describe-valid ────────────────────────────────────────
	yield push({ type: 'check', check: makeCheck('describe-valid', 'running') })
	try {
		module = loadStrategy(source)
	} catch (error) {
		logger.error({ err: error, key }, 'strategy could not be loaded')
		const failure = makeCheck(LOAD_FAILURE_CHECK, 'failed', `could not load the strategy: ${errorText(error)}`)
		checks.push(failure)
		yield push({ type: 'check', check: failure })
		for (const rest of pendingRest(checks)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	const describeCheck = checkDescribe(module)
	checks.push(describeCheck)
	yield push({ type: 'check', check: describeCheck })
	if (describeCheck.status !== 'passed') {
		for (const rest of pendingRest(checks)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	try {
		describe = module.describe()
	} catch (error) {
		// checkDescribe already passed, so this cannot normally happen; if it
		// does the run still reports rather than throwing out of the generator.
		logger.error({ err: error, key }, 'describe() threw after passing its check')
		describe = null
	}

	// ── 7 deterministic ─────────────────────────────────────────
	yield push({ type: 'check', check: makeCheck('deterministic', 'running') })
	const determinismCheck = checkDeterminism(module)
	checks.push(determinismCheck)
	yield push({ type: 'check', check: determinismCheck })
	if (determinismCheck.status !== 'passed') {
		for (const rest of pendingRest(checks)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	// ── 8..9 cre build and simulate ─────────────────────────────
	if (options.skipCre || !creAvailable()) {
		const detail = options.skipCre
			? 'skipped: cre checks were not requested'
			: 'skipped: the cre CLI is not available on this host'
		if (!options.skipCre) logger.warn({ key }, 'cre CLI unavailable; the cre checks cannot run')
		for (const rest of pendingRest(checks, detail)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	requestedSecrets = discoverSecretIds(module, { logger })
	if (requestedSecrets.length > 0) {
		const line = `declaring ${requestedSecrets.length} creator secret id(s) to the Vault: ${requestedSecrets.join(', ')}`
		simulationLog.push(line)
		yield push({ type: 'log', line })
	}

	yield push({ type: 'check', check: makeCheck('cre-build', 'running') })
	workspace = await ensureWorkflow({
		scope: 'submissions',
		key,
		source,
		secretIds: requestedSecrets,
		secretValues: options.secretValues,
		logger,
		tick: {
			totalAssets: options.totalAssets ?? '1000000000',
			currentWeightsBps: options.currentWeightsBps ?? {},
		},
	})

	const build = await buildWorkspace(workspace, { logger })
	binaryHash = build.binaryHash
	configHash = build.configHash
	if (!build.ok) simulationLog.push(failureDetail(build))

	const buildCheck = !build.ok
		? makeCheck('cre-build', 'failed', failureDetail(build))
		: build.binaryHash === null
			? makeCheck('cre-build', 'failed', 'build succeeded but no binary hash appeared in the output')
			: makeCheck('cre-build', 'passed', `binary hash ${build.binaryHash}`)
	checks.push(buildCheck)
	yield push({ type: 'check', check: buildCheck })

	if (buildCheck.status !== 'passed') {
		for (const rest of pendingRest(checks)) {
			checks.push(rest)
			yield push({ type: 'check', check: rest })
		}
		const done = result()
		yield push({ type: 'done', result: done })
		return done
	}

	yield push({ type: 'check', check: makeCheck('cre-simulate', 'running') })
	const simulation = await simulateWorkspace(workspace, { logger })
	for (const line of simulation.log) {
		simulationLog.push(line)
		yield push({ type: 'log', line })
	}
	decision = simulation.decision
	if (simulation.configHash) configHash = simulation.configHash
	if (simulation.binaryHash && simulation.binaryHash !== binaryHash) {
		// Two compilations of one directory disagreeing would undermine the whole
		// "the hash is the strategy's identity" claim, so it is never silent.
		logger.warn(
			{ key, build: binaryHash, simulate: simulation.binaryHash },
			'binary hash differs between build and simulate',
		)
		binaryHash = simulation.binaryHash
	}

	const simulateCheck = simulation.decision
		? makeCheck(
				'cre-simulate',
				'passed',
				`${simulation.decision.action}${describeWeights(simulation.decision)}`,
			)
		: makeCheck(
				'cre-simulate',
				'failed',
				simulation.exitCode === 0
					? 'simulation finished without returning a parseable decision'
					: failureDetail(simulation),
			)
	checks.push(simulateCheck)
	yield push({ type: 'check', check: simulateCheck })

	workspace = await recordHashes(workspace, { binaryHash, configHash })

	const done = result()
	yield push({ type: 'done', result: done })
	return done
}

const describeWeights = (decision: TickDecision): string => {
	const weights = Object.entries(decision.targetWeightsBps)
		.map(([symbol, bps]) => `${symbol} ${bps}bps`)
		.join(', ')
	return weights ? ` -> ${weights}` : ''
}

/** Drives `runChecks` to the end, discarding the intermediate events. */
export async function runChecksToCompletion(
	source: string,
	options: RunChecksOptions = {},
): Promise<CheckRunResult> {
	const iterator = runChecks(source, options)
	for (;;) {
		const step = await iterator.next()
		if (step.done) return step.value
	}
}
