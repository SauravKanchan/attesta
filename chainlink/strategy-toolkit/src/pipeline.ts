// The whole sanity pipeline in one call, in the order docs/build-plan.md sets
// out. A failure stops the rest: every check after it stays `pending`, which is
// what the submission UI streams.

import type { StrategyModule, TickDecision } from '../../../shared/strategy-contract'
import type { SanityCheck } from '../../../shared/types'
import { analyse } from './analyse'
import { CHECK_ORDER, failed, pending } from './checks'
import { creBuildCheck, creSimulateCheck, simulateWorkflow, type WorkflowOptions } from './cre'
import { loadStrategy } from './load'
import { checkDescribe, checkDeterminism, errorText } from './runtime-checks'
import { typecheck } from './typecheck'

export interface PipelineOptions extends WorkflowOptions {
	/** Stop before shelling out to the cre CLI — the fast path for an editor. */
	skipCre?: boolean
}

export interface PipelineResult {
	checks: SanityCheck[]
	/** Loaded only if the static checks passed. */
	module: StrategyModule | null
	binaryHash: string | null
	configHash: string | null
	decision: TickDecision | null
}

const remaining = (done: readonly SanityCheck[]): SanityCheck[] =>
	CHECK_ORDER.slice(done.length).map((id) => pending(id))

export async function runPipeline(
	source: string,
	options: PipelineOptions = {},
): Promise<PipelineResult> {
	const empty = { module: null, binaryHash: null, configHash: null, decision: null }

	const checks: SanityCheck[] = analyse(source)
	if (checks.some((check) => check.status !== 'passed')) {
		return { ...empty, checks: [...checks, ...remaining(checks)] }
	}

	checks.push(await typecheck(source))
	if (checks[checks.length - 1]?.status !== 'passed') {
		return { ...empty, checks: [...checks, ...remaining(checks)] }
	}

	let module: StrategyModule
	try {
		module = loadStrategy(source)
	} catch (error) {
		checks.push(failed('describe-valid', `could not load the strategy: ${errorText(error)}`))
		return { ...empty, checks: [...checks, ...remaining(checks)] }
	}

	checks.push(checkDescribe(module))
	if (checks[checks.length - 1]?.status !== 'passed') {
		return { ...empty, module, checks: [...checks, ...remaining(checks)] }
	}

	checks.push(checkDeterminism(module))
	if (checks[checks.length - 1]?.status !== 'passed') {
		return { ...empty, module, checks: [...checks, ...remaining(checks)] }
	}

	if (options.skipCre) {
		return { ...empty, module, checks: [...checks, ...remaining(checks)] }
	}

	const name = options.name ?? module.describe().ticker
	const simulation = await simulateWorkflow(source, { ...options, name })
	checks.push(creBuildCheck(simulation))
	if (checks[checks.length - 1]?.status !== 'passed') {
		return {
			...empty,
			module,
			binaryHash: simulation.binaryHash,
			configHash: simulation.configHash,
			checks: [...checks, ...remaining(checks)],
		}
	}

	checks.push(creSimulateCheck(simulation))

	return {
		checks,
		module,
		binaryHash: simulation.binaryHash,
		configHash: simulation.configHash,
		decision: simulation.decision,
	}
}
