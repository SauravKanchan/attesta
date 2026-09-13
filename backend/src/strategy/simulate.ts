// Driving the `cre` CLI over a directory the backend already generated.
//
// The toolkit's buildWorkflow/simulateWorkflow regenerate the directory on every
// call, which is right for a one-shot check and wrong for a tick loop. These run
// the same two verbs against a kept directory, so a tick only rewrites its
// config before shelling out.
//
// `cre workflow simulate` fires the cron trigger exactly once and exits: the
// schedule in the config is validated but not honoured, and `--listen` is
// rejected for cron triggers. The interval belongs to the scheduler.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TickDecision } from '../../../shared/strategy-contract.js'
import {
	creBinary,
	extractDecision,
	extractEnclaveLogs,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import { strategyConfig } from './config.js'
import { consoleLogger, type Logger } from './ports.js'
import type { Workspace } from './workspace.js'

/** The CLI prints both hashes once the WASM is compiled, on build and on simulate. */
const BINARY_HASH = /Binary hash:\s*(?:0x)?([0-9a-f]{64})/i
const CONFIG_HASH = /Config hash:\s*(?:0x)?([0-9a-f]{64})/i

/** Lines worth keeping in a submission's simulation log; the rest is compiler noise. */
const INTERESTING = [
	'[USER LOG]',
	'[SIMULATION]',
	'Binary hash:',
	'Config hash:',
	'Workflow Simulation Result',
	'AWS Nitro',
	'Workflow compiled',
	'workflow execution failed',
	'error',
	'Error',
]

export interface CreRun {
	ok: boolean
	exitCode: number | null
	command: string
	stdout: string
	stderr: string
	durationMs: number
	timedOut: boolean
}

export interface CreBuildOutcome extends CreRun {
	binaryHash: string | null
	configHash: string | null
	wasmPath: string
}

export interface CreSimulateOutcome extends CreBuildOutcome {
	decision: TickDecision | null
	enclaveLogs: string[]
	/** Curated CLI output, for the submission's simulation log. */
	log: string[]
}

export interface CreRunOptions {
	timeoutMs?: number
	target?: string
	logger?: Logger
}

/** True when a `cre` binary can be found. The scheduler falls back when it cannot. */
export function creAvailable(): boolean {
	if (!strategyConfig.creEnabled) return false
	const binary = creBinary()
	// creBinary() returns the bare name when neither CRE_BIN nor ~/.cre/bin holds
	// one; leave that to PATH resolution and let the spawn report ENOENT.
	return binary !== 'cre' || (process.env.PATH ?? '').length > 0
}

const matchHash = (output: string, pattern: RegExp): string | null => pattern.exec(output)?.[1] ?? null

const tail = (output: string, lines = 8): string =>
	output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(-lines)
		.join(' | ')

function collectLog(output: string): string[] {
	const lines: string[] = []
	for (const raw of output.split('\n')) {
		const line = raw.trim()
		if (line.length === 0) continue
		if (INTERESTING.some((marker) => line.includes(marker))) lines.push(line)
	}
	return lines
}

function run(args: string[], cwd: string, timeoutMs: number): Promise<CreRun> {
	const binary = creBinary()
	const command = `${binary} ${args.join(' ')}`
	const startedAt = Date.now()

	return new Promise((resolve) => {
		const child = spawn(binary, args, { cwd, env: process.env })
		let stdout = ''
		let stderr = ''
		let timedOut = false

		const timer = setTimeout(() => {
			timedOut = true
			child.kill('SIGKILL')
		}, timeoutMs)

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString()
		})
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString()
		})

		child.on('error', (error) => {
			clearTimeout(timer)
			resolve({
				ok: false,
				exitCode: null,
				command,
				stdout,
				stderr: `${stderr}\ncould not run ${binary}: ${error.message}`,
				durationMs: Date.now() - startedAt,
				timedOut,
			})
		})

		child.on('close', (exitCode) => {
			clearTimeout(timer)
			resolve({
				ok: exitCode === 0 && !timedOut,
				exitCode,
				command,
				stdout,
				stderr: timedOut ? `${stderr}\ntimed out after ${timeoutMs}ms` : stderr,
				durationMs: Date.now() - startedAt,
				timedOut,
			})
		})
	})
}

function cliArgs(verb: 'build' | 'simulate', workspace: Workspace, target: string): string[] {
	// The CLI does not read .env by itself; without -e a declared secret is
	// reported as missing and the enclave run fails.
	return ['workflow', verb, workspace.relativeDir, '--target', target, '-e', workspace.envFile]
}

/** `cre workflow build` over the kept directory. Yields the binary hash. */
export async function buildWorkspace(
	workspace: Workspace,
	options: CreRunOptions = {},
): Promise<CreBuildOutcome> {
	const logger = options.logger ?? consoleLogger
	const target = options.target ?? strategyConfig.creTarget
	const result = await run(
		cliArgs('build', workspace, target),
		workspace.projectRoot,
		options.timeoutMs ?? strategyConfig.buildTimeoutMs,
	)
	const output = `${result.stdout}\n${result.stderr}`
	const outcome: CreBuildOutcome = {
		...result,
		binaryHash: matchHash(output, BINARY_HASH),
		configHash: matchHash(output, CONFIG_HASH),
		wasmPath: join(workspace.dir, 'binary.wasm'),
	}

	if (!outcome.ok) logger.error({ command: result.command, detail: tail(output) }, 'cre workflow build failed')
	return outcome
}

/**
 * `cre workflow simulate` over the kept directory. One cron firing, then exit.
 * A run that exits cleanly without a parseable decision has not done its job,
 * so it is reported as a failure rather than as an empty tick.
 */
export async function simulateWorkspace(
	workspace: Workspace,
	options: CreRunOptions = {},
): Promise<CreSimulateOutcome> {
	const logger = options.logger ?? consoleLogger
	const target = options.target ?? strategyConfig.creTarget
	const result = await run(
		cliArgs('simulate', workspace, target),
		workspace.projectRoot,
		options.timeoutMs ?? strategyConfig.simulateTimeoutMs,
	)
	const output = `${result.stdout}\n${result.stderr}`
	const decision = extractDecision(output)

	const outcome: CreSimulateOutcome = {
		...result,
		ok: result.ok && decision !== null,
		binaryHash: matchHash(output, BINARY_HASH),
		configHash: matchHash(output, CONFIG_HASH),
		wasmPath: join(workspace.dir, 'binary.wasm'),
		decision,
		enclaveLogs: extractEnclaveLogs(output),
		log: collectLog(output),
	}

	if (!outcome.ok) {
		logger.error(
			{ command: result.command, exitCode: result.exitCode, detail: tail(output) },
			'cre workflow simulate did not produce a decision',
		)
	}
	return outcome
}

/** One-line summary of a failed run, for a check detail or an execution row. */
export const failureDetail = (result: CreRun): string =>
	tail(`${result.stdout}\n${result.stderr}`)

export const wasmExists = (workspace: Workspace): boolean => existsSync(join(workspace.dir, 'binary.wasm'))
