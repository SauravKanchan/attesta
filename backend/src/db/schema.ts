// Drizzle schema for the attesta backend.
//
// Two conventions hold everywhere:
//   money      TEXT holding the integer base-unit value (USDC, 6dp). Never REAL — a float
//              cent lost per tick compounds into a wrong NAV, and NAV is the product.
//   timestamps INTEGER epoch milliseconds, so range filters and ORDER BY stay on an index.

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { EncryptedSecret, RiskLevel, SanityCheck, StrategyStatus, StrategyType } from '../../../shared/types.js'

const id = () => text('id').primaryKey()
// Millisecond resolution matters: two position events inside the same second must still
// order deterministically in a series.
const now = (column: string) =>
	integer(column, { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)

// ─── Identity ───────────────────────────────────────────────

// The private key is a local anvil EOA standing in for a Privy embedded wallet, which has
// no local runtime. Nothing of value is ever held by these keys.
export const users = sqliteTable(
	'users',
	{
		id: id(),
		username: text('username').notNull(),
		walletAddress: text('wallet_address').notNull(),
		privateKey: text('private_key').notNull(),
		createdAt: now('created_at'),
	},
	(t) => [
		uniqueIndex('users_username_unique').on(t.username),
		uniqueIndex('users_wallet_address_unique').on(t.walletAddress),
	],
)

export const sessions = sqliteTable(
	'sessions',
	{
		token: text('token').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: now('created_at'),
	},
	(t) => [index('sessions_user_id_idx').on(t.userId)],
)

// ─── Strategies ─────────────────────────────────────────────

// The agent wallet is the vault's operator: the anvil EOA standing in for the strategy's
// Circle Agent Wallet, which cannot be provisioned locally.
export const strategies = sqliteTable(
	'strategies',
	{
		id: id(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		ticker: text('ticker').notNull(),
		types: text('types', { mode: 'json' }).$type<StrategyType[]>().notNull(),
		riskLevel: text('risk_level').$type<RiskLevel>().notNull(),
		description: text('description').notNull().default(''),
		status: text('status').$type<StrategyStatus>().notNull().default('draft'),
		creatorId: text('creator_id')
			.notNull()
			.references(() => users.id),
		vaultAddress: text('vault_address'),
		agentWalletAddress: text('agent_wallet_address'),
		agentWalletKey: text('agent_wallet_key'),
		sourceCode: text('source_code'),
		/** sha256 of the compiled WASM — the strategy's permanent identity. */
		binaryHash: text('binary_hash'),
		configHash: text('config_hash'),
		workflowId: text('workflow_id'),
		assets: text('assets', { mode: 'json' }).$type<string[]>().notNull(),
		createdAt: now('created_at'),
		updatedAt: now('updated_at'),
	},
	(t) => [
		uniqueIndex('strategies_slug_unique').on(t.slug),
		index('strategies_status_idx').on(t.status),
		index('strategies_creator_id_idx').on(t.creatorId),
		index('strategies_risk_level_idx').on(t.riskLevel),
		index('strategies_status_created_at_idx').on(t.status, t.createdAt),
	],
)

/** A strategy before it goes live: editable, re-checkable, not yet listed. */
export const submissions = sqliteTable(
	'submissions',
	{
		id: id(),
		creatorId: text('creator_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull().default(''),
		ticker: text('ticker').notNull().default(''),
		types: text('types', { mode: 'json' }).$type<StrategyType[]>().notNull(),
		riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
		description: text('description').notNull().default(''),
		sourceCode: text('source_code').notNull().default(''),
		checks: text('checks', { mode: 'json' }).$type<SanityCheck[]>().notNull(),
		simulationLog: text('simulation_log', { mode: 'json' }).$type<string[]>().notNull(),
		binaryHash: text('binary_hash'),
		configHash: text('config_hash'),
		status: text('status').$type<StrategyStatus>().notNull().default('draft'),
		/** Set when the submission publishes; the row stays as the draft's audit trail. */
		strategyId: text('strategy_id').references(() => strategies.id),
		createdAt: now('created_at'),
		updatedAt: now('updated_at'),
	},
	(t) => [
		index('submissions_creator_id_idx').on(t.creatorId),
		index('submissions_status_idx').on(t.status),
		index('submissions_created_at_idx').on(t.createdAt),
	],
)

// Creator parameters, encrypted in the creator's browser. There is deliberately no
// plaintext column: the platform relays ciphertext and holds no key that opens it.
export const secrets = sqliteTable(
	'secrets',
	{
		id: id(),
		submissionId: text('submission_id').references(() => submissions.id, { onDelete: 'cascade' }),
		strategyId: text('strategy_id').references(() => strategies.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		ciphertext: text('ciphertext').notNull(),
		scheme: text('scheme').$type<EncryptedSecret['scheme']>().notNull(),
		createdAt: now('created_at'),
	},
	(t) => [
		uniqueIndex('secrets_submission_key_unique').on(t.submissionId, t.key),
		uniqueIndex('secrets_strategy_key_unique').on(t.strategyId, t.key),
	],
)

// ─── Investor positions ─────────────────────────────────────

export const positions = sqliteTable(
	'positions',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		strategyId: text('strategy_id')
			.notNull()
			.references(() => strategies.id, { onDelete: 'cascade' }),
		shares: text('shares').notNull().default('0'),
		/** Deposits minus withdrawals, base units. */
		costBasis: text('cost_basis').notNull().default('0'),
		firstAllocatedAt: now('first_allocated_at'),
	},
	(t) => [
		uniqueIndex('positions_user_strategy_unique').on(t.userId, t.strategyId),
		index('positions_strategy_id_idx').on(t.strategyId),
		index('positions_user_id_idx').on(t.userId),
	],
)

export const positionEvents = sqliteTable(
	'position_events',
	{
		id: id(),
		positionId: text('position_id')
			.notNull()
			.references(() => positions.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<'deposit' | 'withdraw'>().notNull(),
		amount: text('amount').notNull(),
		shares: text('shares').notNull(),
		txHash: text('tx_hash'),
		t: now('t'),
	},
	(t) => [index('position_events_position_t_idx').on(t.positionId, t.t)],
)

// ─── Derived performance ────────────────────────────────────

// One row per tick. Every reported metric is computed from this series, never stored as
// an input, so a strategy's APY is whatever its own decisions produced.
export const navSnapshots = sqliteTable(
	'nav_snapshots',
	{
		id: id(),
		strategyId: text('strategy_id')
			.notNull()
			.references(() => strategies.id, { onDelete: 'cascade' }),
		t: integer('t', { mode: 'timestamp_ms' }).notNull(),
		navPerShare: text('nav_per_share').notNull(),
		totalAssets: text('total_assets').notNull(),
		totalShares: text('total_shares').notNull(),
	},
	(t) => [index('nav_snapshots_strategy_t_idx').on(t.strategyId, t.t)],
)

export const trades = sqliteTable(
	'trades',
	{
		id: id(),
		strategyId: text('strategy_id')
			.notNull()
			.references(() => strategies.id, { onDelete: 'cascade' }),
		t: integer('t', { mode: 'timestamp_ms' }).notNull(),
		pair: text('pair').notNull(),
		side: text('side').$type<'buy' | 'sell'>().notNull(),
		size: text('size').notNull(),
		price: text('price').notNull(),
		pnl: text('pnl').notNull().default('0'),
		txHash: text('tx_hash'),
	},
	(t) => [index('trades_strategy_t_idx').on(t.strategyId, t.t)],
)

/** One row per scheduler tick, successful or not — the strategy's execution log. */
export const executions = sqliteTable(
	'executions',
	{
		id: id(),
		strategyId: text('strategy_id')
			.notNull()
			.references(() => strategies.id, { onDelete: 'cascade' }),
		t: integer('t', { mode: 'timestamp_ms' }).notNull(),
		status: text('status').$type<'ok' | 'failed'>().notNull(),
		action: text('action'),
		targetWeightsBps: text('target_weights_bps', { mode: 'json' }).$type<Record<string, number>>(),
		reason: text('reason'),
		pnlApplied: text('pnl_applied'),
		txHash: text('tx_hash'),
		durationMs: integer('duration_ms').notNull().default(0),
		error: text('error'),
	},
	(t) => [
		index('executions_strategy_t_idx').on(t.strategyId, t.t),
		index('executions_status_idx').on(t.status),
	],
)

// ─── Oracle and chain ───────────────────────────────────────

/** The seeded price walk the workflow reads through GET /api/oracle/prices. */
export const priceTicks = sqliteTable(
	'price_ticks',
	{
		id: id(),
		symbol: text('symbol').notNull(),
		t: integer('t', { mode: 'timestamp_ms' }).notNull(),
		price: text('price').notNull(),
	},
	(t) => [uniqueIndex('price_ticks_symbol_t_unique').on(t.symbol, t.t)],
)

/** Singleton key/value for chain addresses written by the local deploy step. */
export const deployments = sqliteTable('deployments', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: now('updated_at'),
})

export type UserRow = typeof users.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type StrategyRow = typeof strategies.$inferSelect
export type SubmissionRow = typeof submissions.$inferSelect
export type SecretRow = typeof secrets.$inferSelect
export type PositionRow = typeof positions.$inferSelect
export type PositionEventRow = typeof positionEvents.$inferSelect
export type NavSnapshotRow = typeof navSnapshots.$inferSelect
export type TradeRow = typeof trades.$inferSelect
export type ExecutionRow = typeof executions.$inferSelect
export type PriceTickRow = typeof priceTicks.$inferSelect
export type DeploymentRow = typeof deployments.$inferSelect
