// StrategyRegistry: the on-chain anchor binding a strategy to its vault and to the hash
// of the workflow binary that produced its track record.
//
// Only the registrar — the account that deployed the registry, i.e. the deployer in the
// address book — may write, so registration always signs with that account.

import { getAddress, isHex, keccak256, toHex, type Account, type Address, type Hex } from 'viem'
import { strategyRegistryAbi } from './abis.js'
import { deployerAccount, localChain, publicClient, sendAndWait, walletFor } from './client.js'
import { registryAddress } from './deployments.js'
import { onChain } from './errors.js'

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

/**
 * A strategy's database id is a uuid, and the registry keys on bytes32, so the id is
 * hashed rather than truncated: keccak of the id is stable, collision-free in practice,
 * and recomputable by anyone holding the public id.
 */
export function toStrategyId(id: string): Hex {
	return keccak256(toHex(id))
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
	/** The strategy's database id; hashed to bytes32 by `toStrategyId`. */
	strategyId: string
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
					toStrategyId(input.strategyId),
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

export async function isRegistered(strategyId: string): Promise<boolean> {
	return onChain('registry.isRegistered', () =>
		publicClient.readContract({
			...contract(),
			functionName: 'isRegistered',
			args: [toStrategyId(strategyId)],
		}),
	)
}

/** Null when the strategy was never anchored, rather than a revert the caller must catch. */
export async function getRecord(strategyId: string): Promise<StrategyRecord | null> {
	if (!(await isRegistered(strategyId))) return null

	const record = await onChain('registry.get', () =>
		publicClient.readContract({
			...contract(),
			functionName: 'get',
			args: [toStrategyId(strategyId)],
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
