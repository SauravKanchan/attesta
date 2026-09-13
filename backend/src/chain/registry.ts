// StrategyRegistry: the on-chain anchor binding a strategy to its vault and to the hash
// of the workflow binary that produced its track record.
//
// Only the registrar — the account that deployed the registry, i.e. the deployer in the
// address book — may write, so registration always signs with that account.
//
// Every function here takes the registry key already in its bytes32 form. Hashing is done
// once, by the caller, through `toStrategyId` from lib/strategy-id.ts: a client that took
// a raw platform id here and hashed it internally would hash a second time whenever a
// caller had — reasonably — hashed it first, and anchor the strategy under a key nobody
// can look up.

import { getAddress, isHex, type Account, type Address, type Hex } from 'viem'
import { toStrategyId } from '../lib/strategy-id.js'
import { strategyRegistryAbi } from './abis.js'
import { deployerAccount, localChain, publicClient, sendAndWait, walletFor } from './client.js'
import { registryAddress } from './deployments.js'
import { onChain } from './errors.js'

export { toStrategyId }

export interface StrategyRecord {
	strategyId: Hex
	vault: Address
	binaryHash: Hex
	creator: Address
	/** Unix seconds, as the contract stores it. */
	registeredAt: number
}

function contract(): { address: Address; abi: typeof strategyRegistryAbi } {
	return { address: registryAddress(), abi: strategyRegistryAbi }
}

/** Normalises a sha256 digest (with or without 0x) into the bytes32 the registry takes. */
export function toBinaryHash(digest: string): Hex {
	const value = digest.trim().toLowerCase()
	const prefixed = value.startsWith('0x') ? value : `0x${value}`
	if (!isHex(prefixed) || prefixed.length !== 66) {
		throw new Error(`binary hash must be 32 bytes of hex, got ${JSON.stringify(digest)}`)
	}
	return prefixed as Hex
}

export interface RegisterInput {
	/** The registry key: keccak256 of the platform id, from `toStrategyId`. */
	strategyId: Hex
	vault: Address
	/** sha256 of the compiled WASM. */
	binaryHash: string
	creator: Address
}

export async function register(
	input: RegisterInput,
	account: Account = deployerAccount,
): Promise<Hex> {
	const { txHash } = await sendAndWait(
		'registry.register',
		{ strategyId: input.strategyId, vault: input.vault, registrar: account.address },
		async () => {
			const { request } = await publicClient.simulateContract({
				address: registryAddress(),
				abi: strategyRegistryAbi,
				functionName: 'register',
				args: [
					input.strategyId,
					getAddress(input.vault),
					toBinaryHash(input.binaryHash),
					getAddress(input.creator),
				],
				account,
				chain: localChain,
			})
			return walletFor(account).writeContract(request)
		},
	)
	return txHash
}

export async function isRegistered(strategyId: Hex): Promise<boolean> {
	return onChain('registry.isRegistered', () =>
		publicClient.readContract({
			...contract(),
			functionName: 'isRegistered',
			args: [strategyId],
		}),
	)
}

/** Null when the strategy was never anchored, rather than a revert the caller must catch. */
export async function getRecord(strategyId: Hex): Promise<StrategyRecord | null> {
	if (!(await isRegistered(strategyId))) return null

	const record = await onChain('registry.get', () =>
		publicClient.readContract({
			...contract(),
			functionName: 'get',
			args: [strategyId],
		}),
	)

	return {
		strategyId: record.strategyId,
		vault: record.vault,
		binaryHash: record.binaryHash,
		creator: record.creator,
		registeredAt: Number(record.registeredAt),
	}
}

export async function registeredCount(): Promise<number> {
	const count = await onChain('registry.count', () =>
		publicClient.readContract({ ...contract(), functionName: 'count' }),
	)
	return Number(count)
}

export async function registrar(): Promise<Address> {
	return onChain('registry.registrar', () =>
		publicClient.readContract({ ...contract(), functionName: 'registrar' }),
	)
}
