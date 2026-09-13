// The seam between this subsystem and the chain layer.
//
// Nothing here talks to a node. `publish` and the scheduler are handed a
// ChainPort and never construct one, so a tick can be driven against anvil, a
// fork, or a fake without either module changing. The concrete implementation
// lives in backend/src/chain/ and is wired in at the entry point.
//
// Every method is expected to wait for its transaction to be mined and to throw
// on revert: a caller that got a hash back may assume the state change happened.

import type { Address, Hex } from 'viem'

export interface VaultTotals {
	/** USDC the strategy is accountable for, 6dp base units. */
	totalManagedAssets: bigint
	totalShares: bigint
	/** USDC per share, 6dp. Par (1e6) while no shares are outstanding. */
	navPerShare: bigint
	/** USDC held beyond `totalManagedAssets` — the buffer gains are paid out of. */
	reserve: bigint
}

export interface TxResult {
	txHash: Hex
}

export interface DeployVaultParams {
	/** Vault display name, stored on-chain. */
	name: string
	/** The strategy's agent wallet — the only address allowed to settle ticks. */
	operator: Address
}

export interface DeployVaultResult extends TxResult {
	vaultAddress: Address
}

export interface RegisterStrategyParams {
	/** The strategy's platform id. The chain layer hashes it to the registry's bytes32. */
	strategyId: string
	vaultAddress: Address
	/** sha256 of the compiled WASM, hex, with or without the 0x. */
	binaryHash: string
	creator: Address
}

export interface ApplyPnlParams {
	vaultAddress: Address
	/** The agent wallet's key; the vault rejects anyone else. */
	operatorKey: Hex
	/** Signed 6dp delta. Positive draws from the reserve, negative returns to it. */
	delta: bigint
}

export interface RecordTradeParams {
	vaultAddress: Address
	operatorKey: Hex
	pair: string
	isBuy: boolean
	/** Quantity of the base asset, 6dp. */
	size: bigint
	/** USDC per unit, 6dp. */
	price: bigint
	/** Signed 6dp pnl attributed to this leg. */
	pnl: bigint
}

export interface ChainPort {
	deployVault(params: DeployVaultParams): Promise<DeployVaultResult>
	/** Moves USDC from the platform float into the vault's reserve. */
	fundReserve(params: { vaultAddress: Address; amount: bigint }): Promise<TxResult>
	registerStrategy(params: RegisterStrategyParams): Promise<TxResult>
	isStrategyRegistered(strategyId: string): Promise<boolean>
	/** Tops the address up to at least `minWei`. Returns null when no transfer was needed. */
	fundGas(params: { address: Address; minWei?: bigint }): Promise<TxResult | null>
	readVault(vaultAddress: Address): Promise<VaultTotals>
	applyPnl(params: ApplyPnlParams): Promise<TxResult>
	recordTrade(params: RecordTradeParams): Promise<TxResult>
}

/** Minimal logger surface, so a Fastify logger or console both satisfy it. */
export interface Logger {
	debug(payload: unknown, message?: string): void
	info(payload: unknown, message?: string): void
	warn(payload: unknown, message?: string): void
	error(payload: unknown, message?: string): void
}

const emit = (level: 'debug' | 'info' | 'warn' | 'error', payload: unknown, message?: string): void => {
	const line = message ?? ''
	if (level === 'error') console.error(line, payload)
	else if (level === 'warn') console.warn(line, payload)
	else if (level === 'info') console.info(line, payload)
	else console.debug(line, payload)
}

/** Fallback for callers that have no logger to hand. Never silent. */
export const consoleLogger: Logger = {
	debug: (payload, message) => emit('debug', payload, message),
	info: (payload, message) => emit('info', payload, message),
	warn: (payload, message) => emit('warn', payload, message),
	error: (payload, message) => emit('error', payload, message),
}
