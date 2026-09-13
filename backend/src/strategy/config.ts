// Settings shared by the submission pipeline and the scheduler's simulator.
//
// Kept apart from lib/env.ts because these are the knobs of the strategy
// subsystem specifically, and because the CRE CLI is slow enough that its
// timeouts have to be tunable without touching the server's environment
// contract. Defaults are the local ones: everything works with an empty .env.

import { z } from 'zod'
import { env } from '../lib/env.js'
import { parseAmount } from '../lib/money.js'
import { resolveFromRoot } from '../lib/paths.js'

const schema = z.object({
	/** Where per-strategy CRE workflow directories live. Owned by the backend. */
	STRATEGY_WORKSPACE_DIR: z.string().min(1).default('./data/workflows'),
	/** What the enclave GETs prices from. Must be reachable from a spawned process. */
	ORACLE_URL: z.string().url().optional(),
	/** Set false to force the in-process fallback — useful when the CLI is not installed. */
	CRE_ENABLED: z.enum(['true', 'false']).default('true'),
	CRE_TARGET: z.string().min(1).default('staging-settings'),
	/** A cold `cre workflow build` compiles TypeScript to WASM through bun: minutes, not seconds. */
	CRE_BUILD_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
	CRE_SIMULATE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
	/** Written into the generated config. Validated by the simulator, honoured only once deployed. */
	CRE_SCHEDULE: z.string().min(1).default('0 */1 * * * *'),
	/** USDC prefunded into each new vault's reserve so gains are payable. Decimal string. */
	VAULT_RESERVE_USDC: z
		.string()
		.regex(/^\d+(\.\d{1,6})?$/, 'VAULT_RESERVE_USDC must be a positive USDC decimal')
		.default('250000'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
	console.error('invalid strategy environment', parsed.error.flatten().fieldErrors)
	throw new Error('invalid strategy environment: see the field errors logged above')
}

const raw = parsed.data

export const strategyConfig = {
	workspaceDir: resolveFromRoot(raw.STRATEGY_WORKSPACE_DIR),
	// 127.0.0.1 rather than localhost: the simulator resolves the URL in its own
	// process, and a v6-first localhost there does not reach a v4-bound Fastify.
	oracleUrl: raw.ORACLE_URL ?? `http://127.0.0.1:${env.PORT}/api/oracle/prices`,
	creEnabled: raw.CRE_ENABLED === 'true',
	creTarget: raw.CRE_TARGET,
	buildTimeoutMs: raw.CRE_BUILD_TIMEOUT_MS,
	simulateTimeoutMs: raw.CRE_SIMULATE_TIMEOUT_MS,
	schedule: raw.CRE_SCHEDULE,
	/** Reserve prefund in USDC base units. */
	reserveBaseUnits: parseAmount(raw.VAULT_RESERVE_USDC),
} as const

export type StrategyConfig = typeof strategyConfig
