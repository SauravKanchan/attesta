// The backend's own workflow workspace.
//
// `cre workflow simulate` compiles TypeScript to WASM through bun on every run,
// which is the expensive part of a tick. Generating the workflow directory once
// per strategy and keeping it means a tick rewrites two JSON files and shells
// out, rather than regenerating a tree and re-linking node_modules each time.
//
// Layout, all under STRATEGY_WORKSPACE_DIR:
//
//   submissions/<submissionId>/   built by the sanity pipeline
//   strategies/<slug>/            the live strategy's directory; the published
//                                 submission directory is moved here, so the
//                                 binary that passed the pipeline is the binary
//                                 the scheduler keeps simulating
//
// Both scopes sit two levels below the workspace root because the toolkit
// symlinks node_modules with a path relative to the generated directory; the
// link is recreated after a move regardless.
//
// The CRE CLI resolves project.yaml by walking up from the workflow directory,
// so the workspace root carries a copy of the chainlink project's settings and
// the CLI is run from there. That is what lets the backend keep its workflows
// in its own data directory rather than inside the chainlink package.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import {
	chainlinkDir,
	generateWorkflow,
	type GeneratedWorkflow,
} from '../../../chainlink/strategy-toolkit/src/index.js'
import { strategyConfig } from './config.js'
import { consoleLogger, type Logger } from './ports.js'

export type WorkflowScope = 'submissions' | 'strategies'

const META_FILE = 'attesta-workspace.json'
const SECRETS_FILE = 'secrets.yaml'
const ENV_FILE = '.env'
const CONFIG_FILES = ['config.staging.json', 'config.production.json'] as const

export interface TickConfig {
	/** USDC under management for this tick, 6dp integer string. */
	totalAssets: string
	currentWeightsBps: Record<string, number>
	oracleUrl?: string
	schedule?: string
	/** Strategy secret id -> the id actually provisioned in the Vault. */
	secretAliases?: Record<string, string>
	secretNamespace?: string
}

export interface WorkspaceMeta {
	scope: WorkflowScope
	key: string
	/** sha256 of the source the directory was generated from. */
	sourceHash: string
	/** Name in workflow.yaml, and what the CRE CLI calls the workflow. */
	workflowName: string
	/** Secret ids provisioned into the generated secrets file. */
	secretIds: string[]
	binaryHash: string | null
	configHash: string | null
	generatedAt: string
}

export interface Workspace {
	scope: WorkflowScope
	key: string
	dir: string
	/** The directory as the CRE CLI wants it: relative to the chainlink project root. */
	relativeDir: string
	projectRoot: string
	/** Path to pass as `-e`, relative to the project root. */
	envFile: string
	workflowName: string
	sourceHash: string
	meta: WorkspaceMeta
	/** False when an existing directory was reused untouched. */
	regenerated: boolean
}

export const sourceFingerprint = (source: string): string =>
	createHash('sha256').update(source, 'utf8').digest('hex')

export const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'strategy'

export const workspacePath = (scope: WorkflowScope, key: string): string =>
	join(strategyConfig.workspaceDir, scope, slugify(key))

/** The CLI's project root: the workspace, carrying a copy of the CRE settings. */
export const workspaceRoot = (): string => strategyConfig.workspaceDir

/**
 * Mirrors chainlink/project.yaml into the workspace root. Copied rather than
 * symlinked so the file the CLI reads is a plain file in a directory the
 * backend owns, and refreshed every time so an edit to the project's settings
 * reaches the scheduler without a manual step.
 */
export async function ensureProjectSettings(): Promise<string> {
	const root = workspaceRoot()
	await mkdir(root, { recursive: true })
	const target = join(root, 'project.yaml')
	const desired = await readFile(join(chainlinkDir(), 'project.yaml'), 'utf8')
	const current = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') consoleLogger.warn({ target, err: error }, 'unreadable workspace project.yaml')
		return null
	})
	if (current !== desired) await writeFile(target, desired, 'utf8')
	return target
}

/** Env var name a secret id is released through. */
export const secretEnvVar = (id: string): string =>
	`SECRET_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`

async function readMeta(dir: string): Promise<WorkspaceMeta | null> {
	try {
		return JSON.parse(await readFile(join(dir, META_FILE), 'utf8')) as WorkspaceMeta
	} catch (error) {
		// Absent on a first generation, and unreadable if a run was interrupted
		// mid-write. Either way the directory is rebuilt rather than trusted.
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ENOENT') consoleLogger.warn({ dir, err: error }, 'unreadable workspace metadata')
		return null
	}
}

export async function writeMeta(dir: string, meta: WorkspaceMeta): Promise<void> {
	await writeFile(join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

/** Rewrites the per-tick config in place, leaving the compiled tree alone. */
export async function writeTickConfig(dir: string, config: TickConfig): Promise<void> {
	const body = `${JSON.stringify(
		{
			schedule: config.schedule ?? strategyConfig.schedule,
			oracleUrl: config.oracleUrl ?? strategyConfig.oracleUrl,
			secretNamespace: config.secretNamespace ?? 'main',
			secretAliases: config.secretAliases ?? {},
			totalAssets: config.totalAssets,
			currentWeightsBps: config.currentWeightsBps,
		},
		null,
		2,
	)}\n`
	await Promise.all(CONFIG_FILES.map((file) => writeFile(join(dir, file), body, 'utf8')))
}

/**
 * Provisions the strategy's secret ids for the simulator.
 *
 * The generated workflow rethrows when the Vault has no entry for an id it
 * asks for, which kills the whole tick — but the strategy contract says an
 * unset secret reads as an empty string. Declaring every id the strategy
 * actually asks for, with whatever value the platform holds (locally: none,
 * so an empty one), is what makes those two agree.
 *
 * Values are only ever what a caller passes in. The platform stores creator
 * secrets as ciphertext it cannot open, so locally that set is empty and every
 * strategy falls back to its own default, exactly as the contract documents.
 */
export async function writeSecretsFiles(
	dir: string,
	ids: readonly string[],
	values: Record<string, string> = {},
	logger: Logger = consoleLogger,
): Promise<string[]> {
	const unique = [...new Set(ids)].filter((id) => id.trim().length > 0).sort()

	const lines: string[] = [unique.length === 0 ? 'secretsNames: {}' : 'secretsNames:']
	const envLines: string[] = []
	for (const id of unique) {
		const variable = secretEnvVar(id)
		lines.push(`    ${id}:`, `        - ${variable}`)
		const raw = values[id] ?? ''
		if (/[\r\n]/.test(raw)) {
			logger.warn({ id }, 'secret value contains a newline and cannot be provisioned; using an empty value')
			envLines.push(`${variable}=`)
			continue
		}
		envLines.push(`${variable}=${raw}`)
	}

	await writeFile(join(dir, SECRETS_FILE), `${lines.join('\n')}\n`, 'utf8')
	await writeFile(join(dir, ENV_FILE), `${envLines.join('\n')}\n`, 'utf8')

	const yaml = await readFile(join(dir, 'workflow.yaml'), 'utf8')
	await writeFile(
		join(dir, 'workflow.yaml'),
		yaml.replace(/secrets-path: "[^"]*"/g, `secrets-path: "./${SECRETS_FILE}"`),
		'utf8',
	)

	return unique
}

// The reference runner's dependency set is what the toolkit links a generated
// workflow against; a moved directory has to be pointed back at it.
const runnerModules = (): string => join(chainlinkDir(), 'strategy-runner', 'node_modules')

async function relinkNodeModules(dir: string): Promise<void> {
	const target = runnerModules()
	if (!existsSync(target)) return
	const link = join(dir, 'node_modules')
	try {
		await unlink(link)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ENOENT') {
			consoleLogger.warn({ link, err: error }, 'could not remove the stale node_modules link')
		}
	}
	await symlink(relative(dir, target), link, 'dir')
}

const envFileFor = (dir: string): string => relative(workspaceRoot(), join(dir, ENV_FILE))

/** True when the directory still holds everything a simulate needs. */
const intact = (dir: string): boolean =>
	existsSync(join(dir, 'main.ts')) &&
	existsSync(join(dir, 'strategy.ts')) &&
	existsSync(join(dir, 'workflow.yaml')) &&
	existsSync(join(dir, 'node_modules'))

export interface EnsureWorkflowOptions {
	scope: WorkflowScope
	key: string
	source: string
	/** Secret ids the strategy asks for. Discovered by probing onTick. */
	secretIds?: readonly string[]
	secretValues?: Record<string, string>
	tick?: TickConfig
	/** Regenerate even when the fingerprint matches. */
	force?: boolean
	logger?: Logger
}

/**
 * Generates the workflow directory for `source`, or reuses the existing one
 * when it was generated from the same source and is still complete.
 */
export async function ensureWorkflow(options: EnsureWorkflowOptions): Promise<Workspace> {
	const logger = options.logger ?? consoleLogger
	const dir = workspacePath(options.scope, options.key)
	const sourceHash = sourceFingerprint(options.source)
	const secretIds = [...new Set(options.secretIds ?? [])].sort()

	const projectRoot = await ensureProjectSettings().then(() => workspaceRoot())
	const existing = await readMeta(dir)
	const reusable =
		!options.force &&
		existing !== null &&
		existing.sourceHash === sourceHash &&
		existing.secretIds.join(',') === secretIds.join(',') &&
		intact(dir)

	if (reusable && existing) {
		if (options.tick) await writeTickConfig(dir, options.tick)
		return {
			scope: options.scope,
			key: options.key,
			dir,
			relativeDir: relative(projectRoot, dir),
			projectRoot,
			envFile: envFileFor(dir),
			workflowName: existing.workflowName,
			sourceHash,
			meta: existing,
			regenerated: false,
		}
	}

	await mkdir(dirname(dir), { recursive: true })
	const name = slugify(options.key)
	const generated: GeneratedWorkflow = await generateWorkflow(options.source, {
		name,
		outDir: dir,
		oracleUrl: strategyConfig.oracleUrl,
		schedule: strategyConfig.schedule,
	})

	const provisioned = await writeSecretsFiles(dir, secretIds, options.secretValues, logger)
	if (options.tick) await writeTickConfig(dir, options.tick)

	const meta: WorkspaceMeta = {
		scope: options.scope,
		key: options.key,
		sourceHash,
		workflowName: `attesta-${name}`,
		secretIds: provisioned,
		binaryHash: existing?.sourceHash === sourceHash ? (existing?.binaryHash ?? null) : null,
		configHash: existing?.sourceHash === sourceHash ? (existing?.configHash ?? null) : null,
		generatedAt: new Date().toISOString(),
	}
	await writeMeta(dir, meta)

	logger.info(
		{ dir: generated.dir, secretIds: provisioned, sourceHash },
		'generated the CRE workflow directory',
	)

	return {
		scope: options.scope,
		key: options.key,
		dir,
		relativeDir: relative(projectRoot, dir),
		projectRoot,
		envFile: envFileFor(dir),
		workflowName: meta.workflowName,
		sourceHash,
		meta,
		regenerated: true,
	}
}

/**
 * Moves a generated directory between scopes, keeping the compiled artefacts —
 * a published submission's binary is the one the scheduler goes on simulating,
 * so its hash stays the hash that was anchored on-chain.
 */
export async function moveWorkspace(
	from: Workspace,
	scope: WorkflowScope,
	key: string,
	logger: Logger = consoleLogger,
): Promise<Workspace> {
	const dir = workspacePath(scope, key)
	if (dir === from.dir) return from

	await mkdir(dirname(dir), { recursive: true })
	await rm(dir, { recursive: true, force: true })
	await rename(from.dir, dir)
	await relinkNodeModules(dir)

	const name = slugify(key)
	const workflowName = `attesta-${name}`
	const yaml = await readFile(join(dir, 'workflow.yaml'), 'utf8')
	await writeFile(
		join(dir, 'workflow.yaml'),
		yaml.replace(/workflow-name: "[^"]*"/g, `workflow-name: "${workflowName}"`),
		'utf8',
	)

	const meta: WorkspaceMeta = { ...from.meta, scope, key, workflowName }
	await writeMeta(dir, meta)
	logger.info({ from: from.dir, to: dir }, 'moved the CRE workflow directory')

	return {
		...from,
		scope,
		key,
		dir,
		relativeDir: relative(from.projectRoot, dir),
		envFile: envFileFor(dir),
		workflowName,
		meta,
	}
}

/** Reopens a directory generated by an earlier process. Null when it is gone. */
export async function openWorkspace(scope: WorkflowScope, key: string): Promise<Workspace | null> {
	const dir = workspacePath(scope, key)
	const meta = await readMeta(dir)
	if (!meta || !intact(dir)) return null
	const projectRoot = await ensureProjectSettings().then(() => workspaceRoot())
	return {
		scope,
		key,
		dir,
		relativeDir: relative(projectRoot, dir),
		projectRoot,
		envFile: envFileFor(dir),
		workflowName: meta.workflowName,
		sourceHash: meta.sourceHash,
		meta,
		regenerated: false,
	}
}

export async function recordHashes(
	workspace: Workspace,
	hashes: { binaryHash: string | null; configHash: string | null },
): Promise<Workspace> {
	const meta: WorkspaceMeta = {
		...workspace.meta,
		binaryHash: hashes.binaryHash ?? workspace.meta.binaryHash,
		configHash: hashes.configHash ?? workspace.meta.configHash,
	}
	await writeMeta(workspace.dir, meta)
	return { ...workspace, meta }
}
