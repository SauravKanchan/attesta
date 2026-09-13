// Locating the repo's shared contract from wherever this package ends up.
// The toolkit is standalone — it has no dependency on the backend — but it does
// treat shared/strategy-contract.ts as the single source of truth for the
// interface it enforces, so it walks up for it rather than keeping a copy that
// can drift.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The bare specifier a submitted strategy imports the contract from. */
export const CONTRACT_SPECIFIER = '@attesta/strategy-contract'

/** File name the strategy is written under inside temp dirs and workflows. */
export const STRATEGY_FILE_NAME = 'strategy.ts'

/** File name the contract is written under alongside it. */
export const CONTRACT_FILE_NAME = 'strategy-contract.ts'

const cache = new Map<string, string>()

function locate(relative: string): string {
	const cached = cache.get(relative)
	if (cached !== undefined) return cached

	let dir = HERE
	for (;;) {
		const candidate = join(dir, relative)
		if (existsSync(candidate)) {
			cache.set(relative, candidate)
			return candidate
		}
		const parent = dirname(dir)
		if (parent === dir) {
			throw new Error(`strategy-toolkit: cannot find ${relative} in any directory above ${HERE}`)
		}
		dir = parent
	}
}

export const contractSourcePath = (): string => locate('shared/strategy-contract.ts')

/** The CRE project root — the directory holding project.yaml and secrets.yaml. */
export const chainlinkDir = (): string => dirname(locate('chainlink/project.yaml'))

/** The reference workflow. Read-only: its node_modules is reused for builds. */
export const strategyRunnerDir = (): string => join(chainlinkDir(), 'strategy-runner')

export const templatesDir = (): string => join(chainlinkDir(), 'templates')

export const toolkitDir = (): string => dirname(locate('chainlink/strategy-toolkit/package.json'))

export const readContractSource = (): string => readFileSync(contractSourcePath(), 'utf8')
