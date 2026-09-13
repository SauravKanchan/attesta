// StrategyVault: one vault per strategy, deployed by the backend when a submission
// publishes because only then is the strategy's agent wallet — the vault's operator —
// known.
//
// Writes return what the vault emitted rather than what the caller guessed: share counts
// come from the receipt's own event, so the row the backend stores is the number the
// chain actually minted, not a local recomputation of the same rounding.

import { parseEventLogs, type Account, type Address, type Hex, type TransactionReceipt } from 'viem'
import { strategyVaultAbi, strategyVaultBytecode } from './abis.js'
import {
	deployerAccount,
	localChain,
	publicClient,
	sendAndWait,
	walletFor,
} from './client.js'
import { usdcAddress } from './deployments.js'
import { onChain } from './errors.js'

export interface VaultTotals {
	totalManagedAssets: bigint
	totalShares: bigint
	navPerShare: bigint
	reserve: bigint
}

export interface DeployVaultResult {
	address: Address
	txHash: Hex
}

export interface DepositResult {
	txHash: Hex
	assets: bigint
	shares: bigint
	totalManagedAssets: bigint
	totalShares: bigint
}

export interface WithdrawResult {
	txHash: Hex
	shares: bigint
	assets: bigint
	totalManagedAssets: bigint
	totalShares: bigint
}

export interface ApplyPnlResult {
	txHash: Hex
	delta: bigint
	totalManagedAssets: bigint
	reserve: bigint
	navPerShare: bigint
}

function firstEvent<T>(receipt: TransactionReceipt, eventName: string, decoded: readonly T[]): T {
	const event = decoded[0]
	if (!event) {
		throw new Error(`transaction ${receipt.transactionHash} emitted no ${eventName} event`)
	}
	return event
}

// ─── Deployment ─────────────────────────────────────────────

/**
 * Deploys a fresh vault bound to MockUSDC, with `operator` as the only account that may
 * settle a tick.
 */
export async function deployVault(
	name: string,
	operator: Address,
	account: Account = deployerAccount,
): Promise<DeployVaultResult> {
	return onChain(
		'vault.deploy',
		async () => {
			const txHash = await walletFor(account).deployContract({
				abi: strategyVaultAbi,
				bytecode: strategyVaultBytecode,
				args: [usdcAddress(), operator, name],
				account,
				chain: localChain,
			})
			const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
			if (receipt.status !== 'success' || !receipt.contractAddress) {
				throw new Error(`vault deployment ${txHash} produced no contract address`)
			}
			return { address: receipt.contractAddress, txHash }
		},
		{ name, operator, deployer: account.address },
	)
}

// ─── Investor writes ────────────────────────────────────────

/** The caller must already have approved `vault` for `assets` — see usdc.ensureAllowance. */
export async function deposit(
	vault: Address,
	assets: bigint,
	account: Account,
): Promise<DepositResult> {
	const { txHash, receipt } = await sendAndWait(
		'vault.deposit',
		{ vault, assets: assets.toString(), investor: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: vault,
				abi: strategyVaultAbi,
				functionName: 'deposit',
				args: [assets],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)

	const event = firstEvent(
		receipt,
		'Deposited',
		parseEventLogs({ abi: strategyVaultAbi, eventName: 'Deposited', logs: receipt.logs }),
	)
	return {
		txHash,
		assets: event.args.assets,
		shares: event.args.shares,
		totalManagedAssets: event.args.totalManagedAssets,
		totalShares: event.args.totalShares,
	}
}

export async function withdraw(
	vault: Address,
	shares: bigint,
	account: Account,
): Promise<WithdrawResult> {
	const { txHash, receipt } = await sendAndWait(
		'vault.withdraw',
		{ vault, shares: shares.toString(), investor: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: vault,
				abi: strategyVaultAbi,
				functionName: 'withdraw',
				args: [shares],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)

	const event = firstEvent(
		receipt,
		'Withdrawn',
		parseEventLogs({ abi: strategyVaultAbi, eventName: 'Withdrawn', logs: receipt.logs }),
	)
	return {
		txHash,
		shares: event.args.shares,
		assets: event.args.assets,
		totalManagedAssets: event.args.totalManagedAssets,
		totalShares: event.args.totalShares,
	}
}

/**
 * Tops up the buffer that gains are paid out of. `account` must have approved the vault
 * for `amount` first — the vault pulls the USDC.
 */
export async function fundReserve(
	vault: Address,
	amount: bigint,
	account: Account = deployerAccount,
): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'vault.fundReserve',
		{ vault, amount: amount.toString(), from: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: vault,
				abi: strategyVaultAbi,
				functionName: 'fundReserve',
				args: [amount],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

// ─── Operator writes ────────────────────────────────────────

/**
 * Settles one tick. `account` must be the vault's operator — the strategy's agent wallet
 * — or the call reverts with NotOperator.
 */
export async function applyPnl(
	vault: Address,
	delta: bigint,
	account: Account,
): Promise<ApplyPnlResult> {
	const { txHash, receipt } = await sendAndWait(
		'vault.applyPnl',
		{ vault, delta: delta.toString(), operator: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: vault,
				abi: strategyVaultAbi,
				functionName: 'applyPnl',
				args: [delta],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)

	const event = firstEvent(
		receipt,
		'PnlApplied',
		parseEventLogs({ abi: strategyVaultAbi, eventName: 'PnlApplied', logs: receipt.logs }),
	)
	return {
		txHash,
		delta: event.args.delta,
		totalManagedAssets: event.args.totalManagedAssets,
		reserve: event.args.reserve,
		navPerShare: event.args.navPerShare,
	}
}

export interface RecordTradeInput {
	pair: string
	isBuy: boolean
	/** Notional traded in USDC, 6dp. */
	size: bigint
	/** USDC per unit, 6dp. */
	price: bigint
	/** Signed result attributed to this fill, 6dp. */
	pnl: bigint
}

export async function recordTrade(
	vault: Address,
	trade: RecordTradeInput,
	account: Account,
): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'vault.recordTrade',
		{ vault, pair: trade.pair, operator: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: vault,
				abi: strategyVaultAbi,
				functionName: 'recordTrade',
				args: [trade.pair, trade.isBuy, trade.size, trade.price, trade.pnl],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

// ─── Reads ──────────────────────────────────────────────────

export async function totalManagedAssets(vault: Address): Promise<bigint> {
	return onChain('vault.totalManagedAssets', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'totalManagedAssets',
		}),
	)
}

export async function totalShares(vault: Address): Promise<bigint> {
	return onChain('vault.totalShares', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'totalShares',
		}),
	)
}

export async function navPerShare(vault: Address): Promise<bigint> {
	return onChain('vault.navPerShare', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'navPerShare',
		}),
	)
}

export async function reserve(vault: Address): Promise<bigint> {
	return onChain('vault.reserve', () =>
		publicClient.readContract({ address: vault, abi: strategyVaultAbi, functionName: 'reserve' }),
	)
}

export async function sharesOf(vault: Address, investor: Address): Promise<bigint> {
	return onChain('vault.sharesOf', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'sharesOf',
			args: [investor],
		}),
	)
}

/** An investor's claim in USDC rather than in shares. */
export async function balanceOfInvestor(vault: Address, investor: Address): Promise<bigint> {
	return onChain('vault.balanceOfInvestor', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'balanceOfInvestor',
			args: [investor],
		}),
	)
}

export async function previewDeposit(vault: Address, assets: bigint): Promise<bigint> {
	return onChain('vault.previewDeposit', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'previewDeposit',
			args: [assets],
		}),
	)
}

export async function previewWithdraw(vault: Address, shares: bigint): Promise<bigint> {
	return onChain('vault.previewWithdraw', () =>
		publicClient.readContract({
			address: vault,
			abi: strategyVaultAbi,
			functionName: 'previewWithdraw',
			args: [shares],
		}),
	)
}

export async function operatorOf(vault: Address): Promise<Address> {
	return onChain('vault.operator', () =>
		publicClient.readContract({ address: vault, abi: strategyVaultAbi, functionName: 'operator' }),
	)
}

/** The four numbers a NAV snapshot needs, read together. */
export async function vaultTotals(vault: Address): Promise<VaultTotals> {
	const [managed, shares, nav, buffer] = await Promise.all([
		totalManagedAssets(vault),
		totalShares(vault),
		navPerShare(vault),
		reserve(vault),
	])
	return { totalManagedAssets: managed, totalShares: shares, navPerShare: nav, reserve: buffer }
}
