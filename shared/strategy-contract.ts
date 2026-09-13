// The interface every attesta strategy implements. Creators normally write only
// `describe()` and `onTick()`; the accounting functions have correct defaults that
// the template re-exports, and are part of the required surface so the platform can
// verify them and the frontend can read balances and process withdrawals.
//
// Money is USDC with 6 decimals, carried as bigint.

export interface StrategyDescription {
	name: string
	ticker: string
	/** Symbols the strategy is allowed to hold, e.g. ['ETH', 'BTC']. USDC is implicit. */
	assets: string[]
	summary: string
}

export interface PriceSnapshot {
	symbol: string
	/** USDC per unit, 6dp. */
	price: bigint
	t: number
}

export interface StrategyContext {
	/** Unix seconds for this tick. */
	now: number
	/** USDC currently under management, 6dp. */
	totalAssets: bigint
	/** Latest prices for the strategy's declared assets. */
	prices: PriceSnapshot[]
	/** Prior ticks, newest last. Bounded to the last 128 by the runtime. */
	history: PriceSnapshot[][]
	/** Current allocation in basis points, keyed by symbol. Remainder is USDC. */
	currentWeightsBps: Record<string, number>
	/**
	 * Reads a creator secret. Inside a confidential workflow this resolves through
	 * the Vault DON and is only available in an attested enclave.
	 */
	getSecret(id: string): string
	log(message: string): void
}

export type StrategyAction = 'HOLD' | 'REBALANCE' | 'ENTER' | 'EXIT'

export interface TickDecision {
	action: StrategyAction
	/** Target allocation in bps, keyed by symbol. Must sum to <= 10000. */
	targetWeightsBps: Record<string, number>
	/** Human-readable rationale, surfaced in the execution log. */
	reason: string
}

export interface VaultState {
	totalAssets: bigint
	totalShares: bigint
}

export interface InvestorState {
	shares: bigint
}

export interface AccountingResult {
	/** Shares to mint (deposit) or burn (withdraw). */
	shares: bigint
	/** USDC moved, 6dp. */
	assets: bigint
}

// ─── Required exports ───────────────────────────────────────
// A submission is rejected unless all six are exported.

export type DescribeFn = () => StrategyDescription
export type OnTickFn = (ctx: StrategyContext) => TickDecision
export type BalanceOfFn = (investor: InvestorState, vault: VaultState) => bigint
export type TotalAssetsFn = (vault: VaultState) => bigint
export type OnDepositFn = (vault: VaultState, assets: bigint) => AccountingResult
export type OnWithdrawFn = (vault: VaultState, shares: bigint) => AccountingResult

export interface StrategyModule {
	describe: DescribeFn
	onTick: OnTickFn
	balanceOf: BalanceOfFn
	totalAssets: TotalAssetsFn
	onDeposit: OnDepositFn
	onWithdraw: OnWithdrawFn
}

export const REQUIRED_EXPORTS = [
	'describe',
	'onTick',
	'balanceOf',
	'totalAssets',
	'onDeposit',
	'onWithdraw',
] as const

/**
 * Modules a strategy may not import. Enforced by static analysis before the build,
 * because compiling creator code means running an untrusted dependency tree.
 */
export const FORBIDDEN_IMPORTS = [
	'fs',
	'node:fs',
	'child_process',
	'node:child_process',
	'net',
	'node:net',
	'http',
	'node:http',
	'https',
	'node:https',
	'os',
	'node:os',
	'path',
	'node:path',
	'process',
	'node:process',
	'worker_threads',
	'node:worker_threads',
	'vm',
	'node:vm',
	'dgram',
	'node:dgram',
] as const

/** Identifiers that may not appear anywhere in submitted source. */
export const FORBIDDEN_GLOBALS = [
	'eval',
	'Function',
	'require',
	'globalThis',
	'setTimeout',
	'setInterval',
	'fetch',
	'XMLHttpRequest',
	'WebAssembly',
] as const

// ─── Default accounting (ERC4626 share math) ────────────────
// Re-exported by the template so a creator inherits correct behaviour.

export const INITIAL_SHARE_PRICE = 1_000_000n // 1 share == 1 USDC at inception

export const defaultTotalAssets: TotalAssetsFn = (vault) => vault.totalAssets

export const defaultBalanceOf: BalanceOfFn = (investor, vault) => {
	if (vault.totalShares === 0n) return 0n
	return (investor.shares * vault.totalAssets) / vault.totalShares
}

export const defaultOnDeposit: OnDepositFn = (vault, assets) => {
	if (assets <= 0n) throw new Error('deposit must be positive')
	const shares =
		vault.totalShares === 0n || vault.totalAssets === 0n
			? assets
			: (assets * vault.totalShares) / vault.totalAssets
	return { shares, assets }
}

export const defaultOnWithdraw: OnWithdrawFn = (vault, shares) => {
	if (shares <= 0n) throw new Error('withdrawal must be positive')
	if (shares > vault.totalShares) throw new Error('withdrawal exceeds total shares')
	const assets = (shares * vault.totalAssets) / vault.totalShares
	return { shares, assets }
}
