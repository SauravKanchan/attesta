/**
 * The chain, as the backend describes it.
 *
 * Nothing about the network is written down here: the chain id, the RPC URL, the contract
 * addresses and even USDC's decimals all arrive from `GET /api/chain/config`, which reads
 * the same address book the backend and the scheduler use. A redeploy that moves MockUSDC
 * moves it for the browser too, with no rebuild.
 *
 * The fetch happens once per page load and is shared by every caller.
 */

import { createPublicClient, defineChain, getAddress, http } from 'viem'
import type { Address, Chain, PublicClient } from 'viem'
import { getChainConfig } from '@/lib/api'
import type { ChainConfig } from '@/lib/types'

/**
 * `ChainConfig` carries no gas token because nothing downstream needs one: the backend
 * formats `gasBalance` in ether itself, and viem only wants this to label the chain it
 * builds. anvil pays gas in ETH.
 */
const NATIVE_CURRENCY = { name: 'Ether', symbol: 'ETH', decimals: 18 } as const

export interface ResolvedChain {
	config: ChainConfig
	chain: Chain
	publicClient: PublicClient
	usdc: Address
	registry: Address
	/** USDC's decimals as the deployed token reports them, for parsing amounts. */
	usdcDecimals: number
}

let pending: Promise<ResolvedChain> | null = null

function resolve(config: ChainConfig): ResolvedChain {
	if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
		throw new Error(`the backend reported an unusable chain id: ${String(config.chainId)}`)
	}
	if (!config.rpcUrl) throw new Error('the backend reported no RPC URL for the chain')
	if (!Number.isInteger(config.usdcDecimals) || config.usdcDecimals < 0) {
		throw new Error(`the backend reported unusable USDC decimals: ${String(config.usdcDecimals)}`)
	}

	const chain = defineChain({
		id: config.chainId,
		name: `chain ${config.chainId}`,
		nativeCurrency: NATIVE_CURRENCY,
		rpcUrls: { default: { http: [config.rpcUrl] } },
	})

	return {
		config,
		chain,
		publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }),
		usdc: getAddress(config.usdcAddress),
		registry: getAddress(config.registryAddress),
		usdcDecimals: config.usdcDecimals,
	}
}

/**
 * The chain as configured, fetched at most once. A failure clears the memo so the next
 * caller retries rather than inheriting a dead promise for the life of the tab.
 */
export function loadChain(): Promise<ResolvedChain> {
	if (pending === null) {
		pending = getChainConfig()
			.then(resolve)
			.catch((error: unknown) => {
				console.error('attesta: could not read the chain configuration from the backend', error)
				pending = null
				throw error
			})
	}
	return pending
}

/** Drops the memo, so the next `loadChain()` re-reads the address book. */
export function forgetChain(): void {
	pending = null
}
