/**
 * The browser's signer, and the two money actions it signs.
 *
 * No key ever reaches this module or the backend. Signing in proves control of an address
 * by signing a server nonce; depositing and withdrawing are transactions this browser
 * builds, signs and broadcasts itself. The backend only ever sees a transaction hash and
 * checks the receipt.
 *
 * ── The Privy seam ──────────────────────────────────────────────────────────────────
 * The one implementation of `Signer` below is a Privy embedded wallet reached through its
 * EIP-1193 provider. It supplies three capabilities — an address, a personal_sign, and a
 * viem wallet client — and everything that calls `getAddress`, `signMessage`,
 * `investInStrategy` or `withdrawFromStrategy` goes through that interface rather than
 * through Privy, so another signer can be added without touching a caller.
 */

import {
	BaseError,
	ContractFunctionRevertedError,
	createWalletClient,
	custom,
	formatEther,
	formatUnits,
	getAddress as toChecksumAddress,
	parseUnits,
	type Account,
	type Address,
	type Chain,
	type Hex,
	type Transport,
	type WalletClient,
} from 'viem'
import { loadChain } from '@/lib/chain'
import type { ResolvedChain } from '@/lib/chain'

/* ── The contract surface the browser touches ────────────── */

const usdcAbi = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'value', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'error',
		name: 'ERC20InsufficientAllowance',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'allowance', type: 'uint256' },
			{ name: 'needed', type: 'uint256' },
		],
	},
	{
		type: 'error',
		name: 'ERC20InsufficientBalance',
		inputs: [
			{ name: 'sender', type: 'address' },
			{ name: 'balance', type: 'uint256' },
			{ name: 'needed', type: 'uint256' },
		],
	},
	{ type: 'error', name: 'ERC20InvalidSpender', inputs: [{ name: 'spender', type: 'address' }] },
] as const

const vaultAbi = [
	{
		type: 'function',
		name: 'deposit',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'assets', type: 'uint256' }],
		outputs: [{ name: 'shares', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'withdraw',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'shares', type: 'uint256' }],
		outputs: [{ name: 'assets', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'sharesOf',
		stateMutability: 'view',
		inputs: [{ name: 'investor', type: 'address' }],
		outputs: [{ name: 'shares', type: 'uint256' }],
	},
	{
		type: 'error',
		name: 'InsufficientShares',
		inputs: [
			{ name: 'requested', type: 'uint256' },
			{ name: 'held', type: 'uint256' },
		],
	},
	{ type: 'error', name: 'ZeroAmount', inputs: [] },
	{ type: 'error', name: 'ZeroShares', inputs: [] },
	{ type: 'error', name: 'SafeERC20FailedOperation', inputs: [{ name: 'token', type: 'address' }] },
	{
		type: 'error',
		name: 'ERC20InsufficientAllowance',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'allowance', type: 'uint256' },
			{ name: 'needed', type: 'uint256' },
		],
	},
	{
		type: 'error',
		name: 'ERC20InsufficientBalance',
		inputs: [
			{ name: 'sender', type: 'address' },
			{ name: 'balance', type: 'uint256' },
			{ name: 'needed', type: 'uint256' },
		],
	},
	{ type: 'error', name: 'ERC20InvalidSpender', inputs: [{ name: 'spender', type: 'address' }] },
] as const

/* ── Errors ──────────────────────────────────────────────── */

export type WalletErrorCode =
	| 'no-wallet'
	| 'invalid-amount'
	| 'no-gas'
	| 'insufficient-usdc'
	| 'chain-error'

/** Every failure out of this module, with a code a caller can branch on. */
export class WalletError extends Error {
	readonly code: WalletErrorCode

	constructor(code: WalletErrorCode, message: string, cause?: unknown) {
		super(message)
		this.name = 'WalletError'
		this.code = code
		this.cause = cause
	}
}

/* ── The signer ──────────────────────────────────────────── */

/** One member today; the union is the seam another signer would join. */
export type SignerKind = 'privy'

export type BrowserWalletClient = WalletClient<Transport, Chain, Account>

export interface Signer {
	/** Which implementation this is. */
	readonly kind: SignerKind
	readonly address: Address
	/** personal_sign over the exact string the server issued. */
	signMessage(message: string): Promise<Hex>
	/** A viem wallet client bound to the configured chain, for sending transactions. */
	walletClient(): Promise<BrowserWalletClient>
}

/**
 * Which implementation signed in last. A Privy session outlives a page load in Privy's own
 * storage, but the embedded wallet is not in hand until its provider has booted — so on
 * reload this is the only thing that distinguishes "wait for Privy" from "signed out".
 */
const KIND_STORAGE_KEY = 'attesta.wallet.kind'

/**
 * Nothing writes this any more, and a browser that still holds one is holding a raw
 * private key for no reason. Dropped on load rather than on sign-out, because a tab that
 * never signs out would keep it forever.
 */
const LEGACY_KEY_STORAGE_KEY = 'attesta.wallet.key'

if (typeof window !== 'undefined') {
	try {
		window.localStorage.removeItem(LEGACY_KEY_STORAGE_KEY)
	} catch (error) {
		console.error('attesta: could not clear the stored wallet key from localStorage', error)
	}
}

let active: Signer | null = null

/**
 * viem's `custom` transport only ever calls `request`, and both `on`/`removeListener` and
 * viem's per-method `params` unions are where wallet SDKs and viem disagree on typing.
 * Asking for the one method actually used keeps any EIP-1193 provider assignable.
 */
interface Eip1193Requester {
	request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

/**
 * The parts of Privy's `ConnectedWallet` this module needs. Declared structurally rather
 * than imported so nothing outside the React tree depends on the Privy SDK.
 */
export interface PrivyEmbeddedWallet {
	address: string
	/** Throws when the target chain is not in `PrivyProvider`'s `supportedChains`. */
	switchChain(chainId: number): Promise<void>
	getEthereumProvider(): Promise<Eip1193Requester>
}

/**
 * A Privy embedded wallet as a `Signer`. Signing goes through viem rather than through a
 * hand-rolled `personal_sign`, so the message is hex-encoded exactly the way
 * `recoverMessageAddress` on the backend expects it.
 */
function privySigner(wallet: PrivyEmbeddedWallet): Signer {
	const address = toChecksumAddress(wallet.address)
	let client: BrowserWalletClient | null = null

	async function connect(): Promise<BrowserWalletClient> {
		if (client) return client
		const { chain } = await loadChain()
		try {
			await wallet.switchChain(chain.id)
		} catch (error) {
			console.error('attesta: the embedded wallet would not switch to the configured chain', {
				chainId: chain.id,
				error,
			})
			throw new WalletError(
				'chain-error',
				`The embedded wallet could not switch to chain ${chain.id}`,
				error,
			)
		}
		let provider: Eip1193Requester
		try {
			provider = await wallet.getEthereumProvider()
		} catch (error) {
			console.error('attesta: the embedded wallet did not hand over a provider', error)
			throw new WalletError('no-wallet', 'The embedded wallet is not ready yet', error)
		}
		client = createWalletClient({ account: address, chain, transport: custom(provider) })
		return client
	}

	return {
		kind: 'privy',
		address,
		async signMessage(message: string): Promise<Hex> {
			try {
				const connected = await connect()
				return await connected.signMessage({ account: address, message })
			} catch (error) {
				if (error instanceof WalletError) throw error
				console.error('attesta: the embedded wallet could not sign the challenge', error)
				throw new WalletError('chain-error', 'The wallet could not sign the message', error)
			}
		},
		walletClient: connect,
	}
}

/**
 * Installs a Privy embedded wallet as this session's signer. Nothing secret is stored —
 * Privy holds the session — so only the kind is remembered, for the reload case.
 */
export function signInWithPrivy(wallet: PrivyEmbeddedWallet): Signer {
	let signer: Signer
	try {
		signer = privySigner(wallet)
	} catch (error) {
		console.error('attesta: the Privy wallet did not yield a usable address', {
			address: wallet.address,
			error,
		})
		throw new WalletError('no-wallet', 'That Privy wallet has no usable address', error)
	}
	writeStoredKind('privy')
	active = signer
	return signer
}

function writeStoredKind(kind: SignerKind | null): void {
	if (typeof window === 'undefined') return
	try {
		if (kind === null) window.localStorage.removeItem(KIND_STORAGE_KEY)
		else window.localStorage.setItem(KIND_STORAGE_KEY, kind)
	} catch (error) {
		console.error('attesta: could not persist the signer kind to localStorage', error)
	}
}

/** Which signer signed in last, as far as this browser remembers. */
export function storedSignerKind(): SignerKind | null {
	if (typeof window === 'undefined') return null
	try {
		const stored = window.localStorage.getItem(KIND_STORAGE_KEY)
		return stored === 'privy' ? stored : null
	} catch (error) {
		console.error('attesta: could not read the signer kind from localStorage', error)
		return null
	}
}

/**
 * The signer for this session. There is nothing to restore from storage: a Privy wallet is
 * installed by the React tree once the provider has booted, on sign-in and on reload alike.
 */
export function getSigner(): Signer | null {
	return active
}

export function requireSigner(): Signer {
	const signer = getSigner()
	if (signer === null) {
		throw new WalletError('no-wallet', 'No wallet in this browser — sign in again to unlock it')
	}
	return signer
}

/** The signed-in address, or null when this browser holds no key. */
export function getAddress(): Address | null {
	return getSigner()?.address ?? null
}

/** Signs the exact string the server issued, so `recoverMessageAddress` matches. */
export function signMessage(message: string): Promise<Hex> {
	return requireSigner().signMessage(message)
}

export function getWalletClient(): Promise<BrowserWalletClient> {
	return requireSigner().walletClient()
}

/** Forgets the wallet, in memory and in storage. Sign-out must leave nothing behind. */
export function clear(): void {
	active = null
	writeStoredKind(null)
}

/* ── Money ───────────────────────────────────────────────── */

function parseAmount(value: string, decimals: number, label: string): bigint {
	let units: bigint
	try {
		units = parseUnits(value.trim(), decimals)
	} catch (error) {
		console.error(`attesta: ${label} is not a number`, { value, error })
		throw new WalletError('invalid-amount', `Enter ${label} as a number`, error)
	}
	if (units <= 0n) throw new WalletError('invalid-amount', `Enter ${label} greater than zero`)
	return units
}

/** Gas costs are fractions of an ETH; three significant digits is enough to compare them. */
const ethFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 })

/**
 * Gas each write burns on the deployed contracts, taken from real receipts on this chain
 * — approve 46,330, deposit 74,041, withdraw 55,969 — and rounded up to the next 10k so
 * a first-time depositor writing cold storage is still covered. Only the units are fixed:
 * what they cost is priced off the chain's own fee, below.
 */
export const GAS_UNITS = {
	approve: 50_000n,
	deposit: 80_000n,
	withdraw: 60_000n,
} as const

/** An allocation is two transactions: the approve, then the deposit. */
export const DEPOSIT_GAS_UNITS = GAS_UNITS.approve + GAS_UNITS.deposit

/**
 * What `units` of gas cost right now, in wei, at the fee the chain quotes. Returns null
 * when the node will not quote one: no warning is better than a warning built on a number
 * nobody supplied.
 */
export async function gasFloor(units: bigint): Promise<bigint | null> {
	try {
		const chain = await loadChain()
		const fees = await chain.publicClient.estimateFeesPerGas()
		const perGas = fees.maxFeePerGas ?? (await chain.publicClient.getGasPrice())
		return perGas * units
	} catch (error) {
		console.error('attesta: could not price gas against the chain', { units: units.toString(), error })
		return null
	}
}

/**
 * The ETH an allocation needs before it can be signed at all. The portfolio page warns
 * against this figure so an empty tank is named up front rather than surfacing as a
 * failed approve that reads like a contract bug.
 */
export function depositGasFloor(): Promise<bigint | null> {
	return gasFloor(DEPOSIT_GAS_UNITS)
}

/**
 * A wallet that cannot pay for the transaction is told so before it signs, because the
 * node's own message for it is unreadable. `units` is what this particular flow burns,
 * so a withdrawal is not blocked by the cost of a deposit it is not making.
 */
async function assertGas(chain: ResolvedChain, address: Address, units: bigint): Promise<void> {
	let balance: bigint
	try {
		balance = await chain.publicClient.getBalance({ address })
	} catch (error) {
		console.error('attesta: could not read the gas balance', { address, error })
		throw new WalletError('chain-error', 'The chain did not answer — is anvil running?', error)
	}
	if (balance === 0n) {
		throw new WalletError(
			'no-gas',
			'This wallet holds no ETH, so it cannot pay for the transaction. Use Add funds on the portfolio page to top it up.',
		)
	}
	const floor = await gasFloor(units)
	if (floor !== null && balance < floor) {
		throw new WalletError(
			'no-gas',
			`This wallet holds ${ethFormat.format(Number(formatEther(balance)))} ETH but the transaction costs about ${ethFormat.format(Number(formatEther(floor)))} ETH in gas. Use Add funds on the portfolio page to top it up.`,
		)
	}
}

async function assertUsdc(chain: ResolvedChain, address: Address, needed: bigint): Promise<void> {
	let balance: bigint
	try {
		balance = await chain.publicClient.readContract({
			address: chain.usdc,
			abi: usdcAbi,
			functionName: 'balanceOf',
			args: [address],
		})
	} catch (error) {
		console.error('attesta: could not read the USDC balance', { address, error })
		throw new WalletError('chain-error', 'The chain did not answer — is anvil running?', error)
	}
	if (balance < needed) {
		const held = formatUnits(balance, chain.usdcDecimals)
		const want = formatUnits(needed, chain.usdcDecimals)
		throw new WalletError(
			'insufficient-usdc',
			`This wallet holds ${held} USDC but the deposit needs ${want}. Use Add funds on the portfolio page to mint more.`,
		)
	}
}

/**
 * viem buries the useful part of a revert several `cause` hops down, and a selector alone
 * says nothing. Both ABIs above carry the contracts' custom errors so this can name the
 * one that actually fired — `InsufficientShares(100000000, 250000)` rather than
 * `reverted with signature 0xcb1d8bba`.
 */
function chainMessage(error: unknown): string {
	if (error instanceof BaseError) {
		const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError)
		if (reverted instanceof ContractFunctionRevertedError) {
			const name = reverted.data?.errorName
			if (name) {
				const args = reverted.data?.args ?? []
				return args.length > 0 ? `${name}(${args.map((arg) => String(arg)).join(', ')})` : name
			}
			return reverted.reason ?? reverted.shortMessage
		}
		return error.shortMessage || error.message
	}
	if (error instanceof Error) return error.message
	return String(error)
}

/** Logs, then rethrows as a `WalletError` so no failure reaches a caller undecorated. */
function asWalletError(operation: string, error: unknown): WalletError {
	if (error instanceof WalletError) return error
	const message = chainMessage(error)
	console.error(`attesta: ${operation} failed on chain`, { message, error })
	if (/insufficient funds/i.test(message)) {
		return new WalletError(
			'no-gas',
			'This wallet cannot cover the gas for that transaction. Use Add funds on the portfolio page to top it up.',
			error,
		)
	}
	return new WalletError('chain-error', `${operation} failed: ${message}`, error)
}

/**
 * Runs one write and blocks until the receipt says it actually succeeded. A
 * mined-but-reverted transaction returns a hash like any other, so a hash alone is never
 * treated as success.
 */
async function submit(chain: ResolvedChain, operation: string, send: () => Promise<Hex>): Promise<Hex> {
	try {
		const txHash = await send()
		const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: txHash })
		if (receipt.status !== 'success') {
			throw new Error(`transaction ${txHash} was mined with status ${receipt.status}`)
		}
		return txHash
	} catch (error) {
		throw asWalletError(operation, error)
	}
}

/**
 * Approve then deposit, both signed here, both waited on. Returns the deposit hash —
 * that is the one the backend verifies, because it carries the `Deposited` event.
 *
 * Each write is simulated first: the simulation is what turns a revert into the vault's
 * own custom error rather than an opaque send failure, and it fails before a nonce is
 * consumed. The simulation is run as the wallet client's own account, so the request it
 * hands to `writeContract` is signed by whoever the signer is — the key in this browser,
 * or the provider behind an embedded wallet — rather than being posted to the node as a
 * `from` address for it to sign, which only a node holding that key could honour.
 */
export async function investInStrategy(vaultAddress: string, amount: string): Promise<Hex> {
	const signer = requireSigner()
	const chain = await loadChain()
	const vault = toChecksumAddress(vaultAddress)
	const assets = parseAmount(amount, chain.usdcDecimals, 'an amount in USDC')

	await assertGas(chain, signer.address, DEPOSIT_GAS_UNITS)
	await assertUsdc(chain, signer.address, assets)

	const wallet = await signer.walletClient()

	await submit(chain, 'approving the vault', async () => {
		const { request } = await chain.publicClient.simulateContract({
			account: wallet.account,
			address: chain.usdc,
			abi: usdcAbi,
			functionName: 'approve',
			args: [vault, assets],
		})
		return wallet.writeContract(request)
	})

	return submit(chain, 'depositing into the vault', async () => {
		const { request } = await chain.publicClient.simulateContract({
			account: wallet.account,
			address: vault,
			abi: vaultAbi,
			functionName: 'deposit',
			args: [assets],
		})
		return wallet.writeContract(request)
	})
}

/** Redeems shares against the vault. Returns the withdrawal hash. */
export async function withdrawFromStrategy(vaultAddress: string, shares: string): Promise<Hex> {
	const signer = requireSigner()
	const chain = await loadChain()
	const vault = toChecksumAddress(vaultAddress)
	const units = parseAmount(shares, chain.usdcDecimals, 'a number of shares')

	await assertGas(chain, signer.address, GAS_UNITS.withdraw)

	const wallet = await signer.walletClient()
	return submit(chain, 'withdrawing from the vault', async () => {
		const { request } = await chain.publicClient.simulateContract({
			account: wallet.account,
			address: vault,
			abi: vaultAbi,
			functionName: 'withdraw',
			args: [units],
		})
		return wallet.writeContract(request)
	})
}
