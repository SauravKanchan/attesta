// `tsc --noEmit` against the real strategy contract, in a throwaway directory.
//
// This runs the actual compiler binary rather than the compiler API, because
// the check a creator sees has to be the check their editor gives them — the
// same tsconfig, the same diagnostics, the same wording.

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { SanityCheck } from '../../../shared/types'
import { failed, passed } from './checks'
import {
	CONTRACT_FILE_NAME,
	CONTRACT_SPECIFIER,
	readContractSource,
	STRATEGY_FILE_NAME,
} from './paths'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

/** Asserting the namespace against StrategyModule is what makes this check bite:
 *  it fails when an export is missing, mistyped, or has the wrong signature. */
const CONFORMANCE_FILE_NAME = 'conformance.ts'

const CONFORMANCE_SOURCE = `import type { StrategyModule } from './${CONTRACT_FILE_NAME.replace(/\.ts$/, '')}'
import * as strategy from './${STRATEGY_FILE_NAME.replace(/\.ts$/, '')}'

export const conformsToContract: StrategyModule = strategy
`

const TSCONFIG = {
	compilerOptions: {
		target: 'ESNext',
		module: 'ESNext',
		moduleResolution: 'bundler',
		lib: ['ESNext'],
		types: [],
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		forceConsistentCasingInFileNames: true,
		baseUrl: '.',
		paths: {
			[CONTRACT_SPECIFIER]: [`./${CONTRACT_FILE_NAME}`],
		},
	},
	include: [STRATEGY_FILE_NAME, CONFORMANCE_FILE_NAME, CONTRACT_FILE_NAME],
}

/** Path to the tsc entry point in this package's own typescript dependency. */
function tscBinary(): string {
	return resolve(dirname(require.resolve('typescript')), '..', 'bin', 'tsc')
}

export interface TypecheckOptions {
	/** Leave the temp directory behind for debugging a confusing diagnostic. */
	keepTempDir?: boolean
	timeoutMs?: number
}

export interface TypecheckResult {
	check: SanityCheck
	stdout: string
	tempDir: string
}

const MAX_DIAGNOSTIC_LINES = 8

function summariseDiagnostics(output: string): string {
	const lines = output
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)

	const conformance = lines.some((line) => line.startsWith(CONFORMANCE_FILE_NAME))
	const shown = lines.slice(0, MAX_DIAGNOSTIC_LINES)
	const hint = conformance
		? 'the module does not match StrategyModule — check the six required signatures. '
		: ''

	return `${hint}${shown.join(' | ')}${lines.length > shown.length ? ` (and ${lines.length - shown.length} more lines)` : ''}`
}

/** Runs tsc over the submission plus the contract and returns the `typechecks` check. */
export async function typecheckVerbose(
	source: string,
	options: TypecheckOptions = {},
): Promise<TypecheckResult> {
	const dir = await mkdtemp(join(tmpdir(), 'attesta-typecheck-'))

	try {
		await Promise.all([
			writeFile(join(dir, CONTRACT_FILE_NAME), readContractSource(), 'utf8'),
			writeFile(join(dir, STRATEGY_FILE_NAME), source, 'utf8'),
			writeFile(join(dir, CONFORMANCE_FILE_NAME), CONFORMANCE_SOURCE, 'utf8'),
			writeFile(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, '\t'), 'utf8'),
		])

		let stdout = ''
		let ok = true
		try {
			const result = await execFileAsync(
				process.execPath,
				[tscBinary(), '--noEmit', '--pretty', 'false', '--project', 'tsconfig.json'],
				{ cwd: dir, timeout: options.timeoutMs ?? 120_000, maxBuffer: 8 * 1024 * 1024 },
			)
			stdout = `${result.stdout}${result.stderr}`
		} catch (error) {
			// tsc exits non-zero on any diagnostic, so a rejection here is the
			// normal failure path — the diagnostics are on the error object.
			ok = false
			const shell = error as { stdout?: string; stderr?: string; message?: string }
			stdout = `${shell.stdout ?? ''}${shell.stderr ?? ''}` || (shell.message ?? String(error))
		}

		return {
			check: ok
				? passed('typechecks', 'tsc --noEmit clean against the strategy contract')
				: failed('typechecks', summariseDiagnostics(stdout)),
			stdout,
			tempDir: dir,
		}
	} finally {
		if (!options.keepTempDir) {
			await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
				console.warn(`strategy-toolkit: could not remove ${dir}:`, error)
			})
		}
	}
}

export async function typecheck(
	source: string,
	options: TypecheckOptions = {},
): Promise<SanityCheck> {
	const { check } = await typecheckVerbose(source, options)
	return check
}
