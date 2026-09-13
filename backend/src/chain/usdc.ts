// MockUSDC: balances, the faucet, and the approve/transfer pair the vault flow needs.
// Every amount is 6dp base units as a bigint — 1 USDC is 1_000_000n.

import type { Account, Address, Hex } from 'viem'
import { mockUsdcAbi } from './abis.js'
import { deployerAccount, localChain, publicClient, sendAndWait, walletFor } from './client.js'
import { usdcAddress } from './deployments.js'
import { onChain } from './errors.js'

export const USDC_DECIMALS = 6
export const ONE_USDC = 10n ** BigInt(USDC_DECIMALS)

export async function balanceOf(owner: Address): Promise<bigint> {
	return onChain('usdc.balanceOf', () =>
		publicClient.readContract({
			address: usdcAddress(),
			abi: mockUsdcAbi,
			functionName: 'balanceOf',
			args: [owner],
		}),
	)
}

export async function allowance(owner: Address, spender: Address): Promise<bigint> {
	return onChain('usdc.allowance', () =>
		publicClient.readContract({
			address: usdcAddress(),
			abi: mockUsdcAbi,
			functionName: 'allowance',
			args: [owner, spender],
		}),
	)
}

export async function totalSupply(): Promise<bigint> {
	return onChain('usdc.totalSupply', () =>
		publicClient.readContract({
			address: usdcAddress(),
			abi: mockUsdcAbi,
			functionName: 'totalSupply',
		}),
	)
}

/** The faucet. Open on MockUSDC, so any account may call it; the deployer does by default. */
export async function mint(
	to: Address,
	amount: bigint,
	account: Account = deployerAccount,
): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'usdc.mint',
		{ to, amount: amount.toString(), from: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: usdcAddress(),
				abi: mockUsdcAbi,
				functionName: 'mint',
				args: [to, amount],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

export async function approve(spender: Address, amount: bigint, account: Account): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'usdc.approve',
		{ spender, amount: amount.toString(), owner: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: usdcAddress(),
				abi: mockUsdcAbi,
				functionName: 'approve',
				args: [spender, amount],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

export async function transfer(to: Address, amount: bigint, account: Account): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'usdc.transfer',
		{ to, amount: amount.toString(), from: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: usdcAddress(),
				abi: mockUsdcAbi,
				functionName: 'transfer',
				args: [to, amount],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

/**
 * Approves only when the standing allowance is short. Re-approving on every deposit costs
 * a transaction per investment for no gain.
 */
export async function ensureAllowance(
	spender: Address,
	amount: bigint,
	account: Account,
): Promise<Hex | null> {
	const current = await allowance(account.address, spender)
	if (current >= amount) return null
	return approve(spender, amount, account)
}
