// The address book: where the singletons live, and where each strategy's vault lives.
//
// contracts/deploy-local.sh writes MockUSDC and StrategyRegistry to
// contracts/deployments/local.json at deploy time. Vaults are not in that file — the
// backend deploys one per strategy when a submission publishes, so those addresses are
// recorded in the `deployments` table instead. Both are read through here so callers
// never care which side an address came from.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { getAddress, isAddress, type Address } from 'viem'
import { db } from '../db/index.js'
import { deployments } from '../db/schema.js'
import { BACKEND_ROOT } from '../lib/paths.js'

export const ADDRESS_BOOK_PATH = path.resolve(
	BACKEND_ROOT,
	'..',
	'contracts',
	'deployments',
	'local.json',
)

export const USDC_KEY = 'usdc'
export const REGISTRY_KEY = 'registry'
export const DEPLOYER_KEY = 'deployer'
export const CHAIN_ID_KEY = 'chainId'

export interface AddressBook {
	chainId: number
	deployer: Address
	registry: Address
	usdc: Address
}

export class DeploymentError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DeploymentError'
	}
}

/** Populated on first read from the table, invalidated by every write through here. */
let cache: Map<string, string> | null = null

function loadCache(): Map<string, string> {
	if (cache) return cache
	const rows = db.select().from(deployments).all()
	const next = new Map<string, string>()
	for (const row of rows) next.set(row.key, row.value)

	// A fresh database has no rows yet, so fold in whatever the deploy step wrote.
	if (!next.has(USDC_KEY) || !next.has(REGISTRY_KEY)) {
		const book = readAddressBook()
		if (book) {
			for (const [key, value] of addressBookEntries(book)) {
				if (!next.has(key)) {
					writeRow(key, value)
					next.set(key, value)
				}
			}
		}
	}

	cache = next
	return next
}

export function refreshDeployments(): void {
	cache = null
}

function addressBookEntries(book: AddressBook): Array<[string, string]> {
	return [
		[USDC_KEY, book.usdc],
		[REGISTRY_KEY, book.registry],
		[DEPLOYER_KEY, book.deployer],
		[CHAIN_ID_KEY, String(book.chainId)],
	]
}

function requireAddress(key: string, value: unknown): Address {
	if (typeof value !== 'string' || !isAddress(value)) {
		throw new DeploymentError(`address book field ${key} is not an address: ${String(value)}`)
	}
	return getAddress(value)
}

/** The file contracts/deploy-local.sh writes. Null when the chain was never deployed to. */
export function readAddressBook(): AddressBook | null {
	if (!existsSync(ADDRESS_BOOK_PATH)) return null
	try {
		const parsed = JSON.parse(readFileSync(ADDRESS_BOOK_PATH, 'utf8')) as Record<string, unknown>
		return {
			chainId: Number(parsed.chainId),
			deployer: requireAddress('deployer', parsed.deployer),
			registry: requireAddress('registry', parsed.registry),
			usdc: requireAddress('usdc', parsed.usdc),
		}
	} catch (error) {
		console.error('could not read the address book', { path: ADDRESS_BOOK_PATH, error })
		throw error
	}
}

/**
 * Re-reads the address book and overwrites the singleton rows with it. Call after a
 * redeploy: the file is authoritative for the singletons, the table only caches them.
 */
export function syncAddressBook(): AddressBook | null {
	const book = readAddressBook()
	if (!book) {
		console.warn('no address book to sync', { path: ADDRESS_BOOK_PATH })
		return null
	}
	for (const [key, value] of addressBookEntries(book)) writeRow(key, value)
	refreshDeployments()
	return book
}

function writeRow(key: string, value: string): void {
	db.insert(deployments)
		.values({ key, value })
		.onConflictDoUpdate({ target: deployments.key, set: { value, updatedAt: new Date() } })
		.run()
}

export function getDeployment(key: string): string | null {
	return loadCache().get(key) ?? null
}

export function setDeployment(key: string, value: string): void {
	writeRow(key, value)
	loadCache().set(key, value)
}

export function deleteDeployment(key: string): void {
	db.delete(deployments).where(eq(deployments.key, key)).run()
	loadCache().delete(key)
}

export function requireDeployment(key: string): string {
	const value = getDeployment(key)
	if (!value) {
		throw new DeploymentError(
			`deployment "${key}" is unknown — deploy the contracts first (contracts/deploy-local.sh)`,
		)
	}
	return value
}

export function usdcAddress(): Address {
	return requireAddress(USDC_KEY, requireDeployment(USDC_KEY))
}

export function registryAddress(): Address {
	return requireAddress(REGISTRY_KEY, requireDeployment(REGISTRY_KEY))
}

export function deployerAddress(): Address {
	return requireAddress(DEPLOYER_KEY, requireDeployment(DEPLOYER_KEY))
}

export function deployedChainId(): number | null {
	const value = getDeployment(CHAIN_ID_KEY)
	return value ? Number(value) : null
}

/** One row per strategy vault, so the table doubles as the strategy address book. */
export function vaultKey(strategyId: string): string {
	return `vault:${strategyId}`
}

export function setVaultAddress(strategyId: string, address: Address): void {
	setDeployment(vaultKey(strategyId), getAddress(address))
}

export function getVaultAddress(strategyId: string): Address | null {
	const value = getDeployment(vaultKey(strategyId))
	return value ? requireAddress(vaultKey(strategyId), value) : null
}

export function requireVaultAddress(strategyId: string): Address {
	const address = getVaultAddress(strategyId)
	if (!address) throw new DeploymentError(`strategy ${strategyId} has no deployed vault`)
	return address
}

export function allDeployments(): Record<string, string> {
	return Object.fromEntries(loadCache())
}
