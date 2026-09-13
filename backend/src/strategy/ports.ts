// The seam between this subsystem and the chain layer.
//
// Nothing here talks to a node. `publish` and the scheduler are handed a
// ChainPort and never construct one, so a tick can be driven against anvil, a
// fork, or a fake without either module changing. The concrete implementation is
// `createChainPort()` in backend/src/chain/port.ts, and backend/src/services.ts
// is the composition root that hands it to both.
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
	/**
	 * The registry key: the platform id already hashed to bytes32 by
	 * `toStrategyId` from lib/strategy-id.ts. Pre-hashed rather than raw so that
	 * exactly one side of this seam ever hashes, and a caller holding the key can
	 * compare it against what the registry returns without guessing a convention.
	 */
	onChainStrategyId: Hex
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

/** One Deposited or Withdrawn log, decoded. Both carry the same five values. */
export interface VaultTransferEvent {
	kind: 'deposit' | 'withdraw'
	/** The vault that emitted it, so a caller can tell whose money moved. */
	vaultAddress: Address
	investor: Address
	/** USDC that moved, 6dp base units. */
	assets: bigint
	shares: bigint
	/** Vault totals after the event, straight out of the log. */
	totalManagedAssets: bigint
	totalShares: bigint
}

/**
 * A transaction someone else broadcast, read back off the chain. Mined is not the same as
 * successful — a reverted transaction has a receipt like any other — so the status is
 * reported rather than assumed, and the events are whatever the receipt actually carries.
 */
export interface VaultTransaction {
	txHash: Hex
	status: 'success' | 'reverted'
	blockNumber: bigint
	events: VaultTransferEvent[]
}

export interface ChainPort {
	deployVault(params: DeployVaultParams): Promise<DeployVaultResult>
	/** Moves USDC from the platform float into the vault's reserve. */
	fundReserve(params: { vaultAddress: Address; amount: bigint }): Promise<TxResult>
	registerStrategy(params: RegisterStrategyParams): Promise<TxResult>
	/** Takes the same pre-hashed bytes32 key `registerStrategy` anchors under. */
	isStrategyRegistered(onChainStrategyId: Hex): Promise<boolean>
	/** Tops the address up to at least `minWei`. Returns null when no transfer was needed. */
	fundGas(params: { address: Address; minWei?: bigint }): Promise<TxResult | null>
	readVault(vaultAddress: Address): Promise<VaultTotals>
	/**
	 * The receipt for a hash the caller did not send — an investor's browser-signed deposit
	 * or withdrawal. Null when the node has never seen the transaction. This is the read that
	 * lets the backend record what the chain says happened instead of what a client claims.
	 */
	readVaultTransaction(txHash: Hex): Promise<VaultTransaction | null>
	/** USDC an address holds, 6dp base units. */
	usdcBalanceOf(address: Address): Promise<bigint>
	/** Native balance in wei — what a browser-signed transaction is paid for with. */
	gasBalanceOf(address: Address): Promise<bigint>
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
