// The seam between the tick loop and the price oracle.
//
// `OracleSnapshot` is deliberately the exact payload the generated CRE workflow
// parses out of `GET /api/oracle/prices` — `{ t, prices, history }` with 6dp
// prices — so the numbers the enclave decides on and the numbers the scheduler
// prices the decision with come from one shape and cannot drift apart.
//
// The chain seam lives with the strategy subsystem, which publishes vaults with
// the same port; it is re-exported here so a caller wires one module, not two.

import type { PriceSnapshot } from '../../../shared/strategy-contract.js'

export type {
	ApplyPnlParams,
	ChainPort,
	DeployVaultParams,
	DeployVaultResult,
	Logger,
	RecordTradeParams,
	RegisterStrategyParams,
	TxResult,
	VaultTotals,
} from '../strategy/ports.js'
export { consoleLogger } from '../strategy/ports.js'

export interface OracleSnapshot {
	/** Unix seconds for the newest tick. */
	t: number
	/** Latest price per symbol, 6dp. */
	prices: PriceSnapshot[]
	/** Prior snapshots, oldest first, excluding the newest. */
	history: PriceSnapshot[][]
}

export interface OracleReadOptions {
	/** Symbols the caller cares about. An oracle may return more; it must not return fewer. */
	symbols?: readonly string[]
	/** Maximum number of prior snapshots to include. */
	historyLimit?: number
}

export interface OraclePort {
	/** Steps the seeded walk one tick forward, persists it, and returns the new snapshot. */
	advance(options?: OracleReadOptions): Promise<OracleSnapshot>
	/** The current snapshot, without advancing. */
	snapshot(options?: OracleReadOptions): Promise<OracleSnapshot>
}

/** Symbol -> 6dp price, the form the pricing maths wants. */
export const priceMap = (prices: readonly PriceSnapshot[]): Record<string, bigint> => {
	const map: Record<string, bigint> = {}
	for (const entry of prices) map[entry.symbol] = entry.price
	return map
}
