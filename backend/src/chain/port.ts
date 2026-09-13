// The ChainPort implementation: the one adapter between the interfaces the strategy
// subsystem and the tick loop are written against and the viem clients in this directory.
//
// Everything above this file — publish, runTick, the scheduler — is handed a ChainPort and
// never constructs one, so a tick can be driven against anvil, a fork or a fake without
// either module changing. This is the concrete side of that seam, and the composition root
// (backend/src/services.ts) is what puts the two together.
//
// Two vault behaviours are absorbed here rather than left to every caller:
//
//   the reserve is what a gain is paid out of, and the platform float has to both hold the
//   USDC and have approved the vault for it before `fundReserve` can pull anything. MockUSDC
//   has an open faucet, so a short float mints the difference rather than failing publish.
//
//   `applyPnl` costs a transaction even when the delta is zero, and a zero delta changes no
//   state. The tick loop decides whether a settlement is warranted; this file only refuses
//   to invent one.

import { parseEventLogs, TransactionReceiptNotFoundError, type Address, type Hex } from 'viem'
import type { ChainPort, VaultTransaction, VaultTransferEvent } from '../strategy/ports.js'
import { strategyVaultAbi } from './abis.js'
import { deployerAccount, publicClient } from './client.js'
import * as registry from './registry.js'
import * as usdc from './usdc.js'
import * as vault from './vault.js'
import * as wallets from './wallets.js'

/** The address the platform float is held by: anvil's deployer, standing in for treasury. */
export const platformAddress = (): Address => deployerAccount.address

/**
 * Makes sure the platform float can cover `amount` before something tries to pull it.
 * Returns the mint hash, or null when the float was already sufficient.
 */
export async function ensurePlatformUsdc(amount: bigint): Promise<Hex | null> {
	const held = await usdc.balanceOf(deployerAccount.address)
	if (held >= amount) return null
	return usdc.mint(deployerAccount.address, amount - held)
}

/** The vault, registry and wallet calls the strategy subsystem and the tick loop need. */
export function createChainPort(): ChainPort {
	return {
		async deployVault({ name, operator }) {
			const deployed = await vault.deployVault(name, operator)
			return { vaultAddress: deployed.address, txHash: deployed.txHash }
		},

		async fundReserve({ vaultAddress, amount }) {
			await ensurePlatformUsdc(amount)
			// The vault pulls the USDC, so the platform float has to approve it first.
			await usdc.ensureAllowance(vaultAddress, amount, deployerAccount)
			return { txHash: await vault.fundReserve(vaultAddress, amount) }
		},

		async registerStrategy({ onChainStrategyId, vaultAddress, binaryHash, creator }) {
			const txHash = await registry.register({
				strategyId: onChainStrategyId,
				vault: vaultAddress,
				binaryHash,
				creator,
			})
			return { txHash }
		},

		isStrategyRegistered: (onChainStrategyId) => registry.isRegistered(onChainStrategyId),

		async fundGas({ address, minWei }) {
			const txHash = await wallets.ensureGas(address, { minimum: minWei })
			return txHash === null ? null : { txHash }
		},

		readVault: (vaultAddress) => vault.vaultTotals(vaultAddress),

		readVaultTransaction: (txHash) => readVaultTransaction(txHash),

		usdcBalanceOf: (address) => usdc.balanceOf(address),

		gasBalanceOf: (address) => wallets.gasBalance(address),

		async applyPnl({ vaultAddress, operatorKey, delta }) {
			const account = wallets.accountFromKey(operatorKey)
			const result = await vault.applyPnl(vaultAddress, delta, account)
			return { txHash: result.txHash }
		},

		async recordTrade({ vaultAddress, operatorKey, pair, isBuy, size, price, pnl }) {
			const account = wallets.accountFromKey(operatorKey)
			const txHash = await vault.recordTrade(
				vaultAddress,
				{ pair, isBuy, size, price, pnl },
				account,
			)
			return { txHash }
		},
	}
}

/**
 * Decodes the vault events in one transaction's receipt.
 *
 * An unknown hash is null rather than an exception: a client can hand the backend any
 * 32 bytes it likes, and "the chain has never seen this" is an ordinary answer to that,
 * not a fault. Everything else — reverted, wrong vault, wrong investor — is left visible
 * in the returned value for the caller to judge, because only the caller knows which
 * vault and which investor the transaction was supposed to be for.
 */
async function readVaultTransaction(txHash: Hex): Promise<VaultTransaction | null> {
	let receipt
	try {
		receipt = await publicClient.getTransactionReceipt({ hash: txHash })
	} catch (error) {
		if (error instanceof TransactionReceiptNotFoundError) {
			console.warn('no receipt for the submitted transaction', { txHash, error })
			return null
		}
		// A node that cannot be reached is not a client presenting a hash that never existed,
		// and answering "the chain has no such transaction" to an outage would send the caller
		// looking for a bug in their wallet.
		console.error('could not read a transaction receipt', { txHash, error })
		throw error
	}

	const events: VaultTransferEvent[] = []
	for (const log of parseEventLogs({ abi: strategyVaultAbi, eventName: 'Deposited', logs: receipt.logs })) {
		events.push({
			kind: 'deposit',
			vaultAddress: log.address,
			investor: log.args.investor,
			assets: log.args.assets,
			shares: log.args.shares,
			totalManagedAssets: log.args.totalManagedAssets,
			totalShares: log.args.totalShares,
		})
	}
	for (const log of parseEventLogs({ abi: strategyVaultAbi, eventName: 'Withdrawn', logs: receipt.logs })) {
		events.push({
			kind: 'withdraw',
			vaultAddress: log.address,
			investor: log.args.investor,
			assets: log.args.assets,
			shares: log.args.shares,
			totalManagedAssets: log.args.totalManagedAssets,
			totalShares: log.args.totalShares,
		})
	}

	return {
		txHash: receipt.transactionHash,
		status: receipt.status === 'success' ? 'success' : 'reverted',
		blockNumber: receipt.blockNumber,
		events,
	}
}
