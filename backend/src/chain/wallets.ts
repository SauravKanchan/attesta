// Local EOAs. Every investor gets one standing in for a Privy embedded wallet, and every
// strategy gets one standing in for its Circle Agent Wallet; neither service has a local
// runtime, and neither key ever holds anything of value.
//
// A fresh key has no ETH, so it cannot approve, deposit or settle a tick until the anvil
// deployer funds it. That funding is the reason this file exists.

import { formatEther, parseEther, type Address, type Hex, type PrivateKeyAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { deployerAccount, publicClient, walletFor } from './client.js'
import { onChain } from './errors.js'

/** Enough for thousands of local transactions; anvil accounts start with 10000 ETH. */
export const DEFAULT_GAS_TOPUP = parseEther('10')

/** Below this a wallet is topped back up rather than left to fail mid-flow. */
export const MIN_GAS_BALANCE = parseEther('1')

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/

export interface GeneratedWallet {
	privateKey: Hex
	address: Address
}

export function generateWallet(): GeneratedWallet {
	const privateKey = generatePrivateKey()
	return { privateKey, address: privateKeyToAccount(privateKey).address }
}

/** Rejects a malformed key loudly: a truncated key otherwise fails later as a bad signature. */
export function accountFromKey(privateKey: string): PrivateKeyAccount {
	const key = privateKey.trim()
	const prefixed = key.startsWith('0x') ? key : `0x${key}`
	if (!PRIVATE_KEY_RE.test(prefixed)) {
		const error = new Error('stored private key is not 32 bytes of hex')
		console.error('could not derive an account from a stored key', {
			length: key.length,
			error,
		})
		throw error
	}
	return privateKeyToAccount(prefixed as Hex)
}

export async function gasBalance(address: Address): Promise<bigint> {
	return onChain('wallet.getBalance', () => publicClient.getBalance({ address }))
}

/** Sends ETH from the deployer and waits for the receipt. */
export async function fundGas(
	address: Address,
	value: bigint = DEFAULT_GAS_TOPUP,
): Promise<Hex> {
	return onChain(
		'wallet.fundGas',
		async () => {
			const txHash = await walletFor(deployerAccount).sendTransaction({
				account: deployerAccount,
				chain: null,
				to: address,
				value,
			})
			const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
			if (receipt.status !== 'success') {
				throw new Error(`gas funding ${txHash} was mined with status ${receipt.status}`)
			}
			return txHash
		},
		{ to: address, value: formatEther(value) },
	)
}

export interface EnsureGasOptions {
	minimum?: bigint
	topUp?: bigint
}

/**
 * Funds the wallet only when it is short, so calling it on every login or every tick is
 * cheap. Returns the funding hash, or null when nothing was needed.
 */
export async function ensureGas(
	address: Address,
	options: EnsureGasOptions = {},
): Promise<Hex | null> {
	const minimum = options.minimum ?? MIN_GAS_BALANCE
	const balance = await gasBalance(address)
	if (balance >= minimum) return null
	return fundGas(address, options.topUp ?? DEFAULT_GAS_TOPUP)
}
