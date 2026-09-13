// viem clients for the local anvil chain.
//
// One public client for reads and a wallet client per signer, cached by address: every
// investor and every strategy agent wallet signs its own transactions, and rebuilding a
// transport per call would open a new HTTP agent each time.

import {
	createPublicClient,
	createWalletClient,
	defineChain,
	http,
	type Account,
	type Address,
	type Chain,
	type Hex,
	type HttpTransport,
	type TransactionReceipt,
	type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { env } from '../lib/env.js'
import { onChain } from './errors.js'

/** anvil's first account. It deploys the singletons, holds the USDC float and pays gas. */
export const ANVIL_DEPLOYER_KEY: Hex =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const configuredKey = process.env.DEPLOYER_PRIVATE_KEY?.trim()
export const deployerAccount = privateKeyToAccount(
	(configuredKey && configuredKey.length > 0 ? configuredKey : ANVIL_DEPLOYER_KEY) as Hex,
)

export const localChain = defineChain({
	id: env.CHAIN_ID,
	name: 'anvil',
	nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
	rpcUrls: { default: { http: [env.RPC_URL] } },
})

export const publicClient = createPublicClient({
	chain: localChain,
	transport: http(env.RPC_URL),
})

export type LocalWalletClient = WalletClient<HttpTransport, Chain, Account>

const wallets = new Map<Address, LocalWalletClient>()

export function walletFor(account: Account): LocalWalletClient {
	const existing = wallets.get(account.address)
	if (existing) return existing
	const client = createWalletClient({ account, chain: localChain, transport: http(env.RPC_URL) })
	wallets.set(account.address, client)
	return client
}

export function deployerWallet(): LocalWalletClient {
	return walletFor(deployerAccount)
}

export interface WriteOutcome {
	txHash: Hex
	receipt: TransactionReceipt
}

/**
 * Wraps a write: log and rethrow with the decoded revert, then block until the receipt
 * confirms the transaction actually succeeded. A mined-but-reverted transaction returns a
 * hash like any other, so nothing may treat a hash alone as success.
 *
 * Callers simulate before sending — the simulation is what turns a revert into the
 * contract's own custom error instead of an opaque send failure, and it fails before a
 * nonce is consumed.
 */
export async function sendAndWait(
	operation: string,
	context: Record<string, unknown>,
	send: () => Promise<Hex>,
): Promise<WriteOutcome> {
	return onChain(
		operation,
		async () => {
			const txHash = await send()
			const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
			if (receipt.status !== 'success') {
				throw new Error(`transaction ${txHash} was mined with status ${receipt.status}`)
			}
			return { txHash, receipt }
		},
		context,
	)
}

/** True when the node is reachable. For boot checks, not for request paths. */
export async function isChainUp(): Promise<boolean> {
	try {
		await publicClient.getBlockNumber()
		return true
	} catch (error) {
		console.warn('chain is not reachable', { rpcUrl: env.RPC_URL, error })
		return false
	}
}

/** Empty bytecode means the address book points at a chain that has since been reset. */
export async function isContractDeployed(address: Address): Promise<boolean> {
	const code = await publicClient.getCode({ address })
	return code !== undefined && code !== '0x'
}
