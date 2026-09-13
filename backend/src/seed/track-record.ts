// The track record a seeded marketplace needs before anybody can look at it.
//
// Publishing proves the pipeline; it gives the marketplace nothing to show. Every
// performance figure on a card is derived from the vault's own settlement log and every
// verification badge from an execution row, so a database that has only ever published
// serves nulls: no total return, no drawdown, no sparkline, zero AUM, and an amber
// "awaiting attestation" on every card.
//
// This phase closes that gap without writing a single figure by hand. It funds an investor
// through the faucet, signs `approve` and `deposit` with that investor's own key exactly as
// the browser does, records the deposit against its receipt through the public API, and
// then runs the scheduler's own `tickOnce` — the same call the 60 s loop makes — a few
// times. What lands in the database is what the chain and the enclave produced.
//
// Order matters: `StrategyVault.applyPnl` reverts with `NoSharesOutstanding()` while
// `totalShares` is zero, so a tick against an unfunded vault settles nothing and NAV never
// moves. The deposit has to come first.
//
// A funded vault is still not enough. A strategy that is out of the market settles
// `applyPnl(0)` and NAV comes back byte-identical, so a short run against a flat stretch
// leaves exactly the card a run that never happened would: par NAV, a total return of
// zero, a straight sparkline. The phase therefore ticks until NAV has actually moved, up
// to `maxTicks`, and says plainly in its result when it never did.
//
// Only one strategy is funded and ticked by default. The amber badge on the other two is
// not an oversight — it is the contrast that shows the badge tracks runs rather than
// intentions.

import { setTimeout as sleep } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { getAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { LoginChallenge, Position, Session } from '../../../shared/types.js'
import { usdc, vault } from '../chain/index.js'
import { db } from '../db/index.js'
import { strategies } from '../db/schema.js'
import { formatAmount, parseAmount } from '../lib/money.js'
import { getScheduler } from '../services.js'
import type { TickOutcome } from '../scheduler/index.js'

/**
 * anvil's account #1. It is the investor the login screen offers and the runbook names,
 * and it is deliberately not account #0 — the platform deploys, funds reserves and runs the
 * faucet from #0, so signing investor transactions with it too would race its nonce.
 */
const ANVIL_INVESTOR_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

/** The overtrader flips its whole book every tick, so it is the one that moves NAV. */
const DEFAULT_SLUG = 'churn'

/** A round number, large enough that the position reads as a real allocation. */
const DEFAULT_DEPOSIT_USDC = '5000'

/** Enough NAV points to draw a line and compute a return from. */
const DEFAULT_TICKS = 3

/**
 * The ceiling on ticks taken while waiting for NAV to move.
 *
 * A strategy that is out of the market settles `applyPnl(0)`: the tick is real, the
 * decision is real, and NAV per share comes back byte-identical. A run made entirely of
 * those points is a track record of nothing — par NAV, a total return of exactly zero and
 * a sparkline that is a straight line — which is indistinguishable on a card from a
 * strategy that never ran at all.
 *
 * How likely that is depends entirely on which strategy is funded. Replayed over the
 * seeded walk, the overtrader settles a non-zero delta on every tick, momentum on 61% of
 * them and mean reversion on 49%; momentum's longest unbroken flat stretch is 58 ticks and
 * mean reversion's is 469. So a three-tick record on momentum is flat about a third of the
 * time and on mean reversion about half.
 *
 * The phase therefore keeps ticking until the vault's NAV has actually moved, up to this
 * many ticks in total. Nothing about the decisions changes — the strategy is simply given
 * longer to take a position, and every figure is still the one its own weights earned.
 * When the ceiling is reached with NAV still at its starting value the result says so
 * rather than reporting a record it did not produce.
 */
const DEFAULT_MAX_TICKS = 12

export interface TrackRecordOptions {
	/** Base URL of a running API, including the /api prefix. */
	baseUrl: string
	slug: string
	investorKey: Hex
	/** USDC to allocate, in 6dp base units. */
	depositBaseUnits: bigint
	ticks: number
	/**
	 * Hard ceiling on ticks. Once `ticks` have run the phase keeps going while NAV per
	 * share is still exactly where it started, and stops at this count either way.
	 */
	maxTicks: number
	/** Seconds to wait between ticks. Each tick advances the price walk itself. */
	gapSeconds: number
}

export interface TrackRecordResult {
	slug: string
	investorAddress: Address
	deposited: string
	depositTxHash: Hex
	/** Ticks that reached the enclave path, which is what the green badge counts. */
	attestedTicks: number
	/** Ticks that settled a non-zero delta. The rest left NAV byte-identical. */
	settledTicks: number
	/** NAV per share before the first tick, 6dp decimal. */
	navFrom: string
	/** NAV per share after the last one. Equal to `navFrom` when nothing moved. */
	navTo: string
	/**
	 * Whether the run produced a track record at all. False means par NAV, a total return
	 * of exactly zero and a flat sparkline — a card that reads as if nothing ran.
	 */
	navMoved: boolean
	outcomes: TickOutcome[]
}

/**
 * Options from the environment, or null when `SEED_TRACK_RECORD=false` asks for the bare
 * published marketplace.
 */
export function trackRecordFromEnv(baseUrl: string): TrackRecordOptions | null {
	if (process.env.SEED_TRACK_RECORD === 'false') return null

	const ticks = Number(process.env.SEED_TICKS ?? DEFAULT_TICKS)
	if (!Number.isFinite(ticks) || ticks < 1) {
		throw new Error(`SEED_TICKS must be a positive number, got ${JSON.stringify(process.env.SEED_TICKS)}`)
	}
	const maxTicks = Number(process.env.SEED_MAX_TICKS ?? Math.max(ticks, DEFAULT_MAX_TICKS))
	if (!Number.isFinite(maxTicks) || maxTicks < ticks) {
		throw new Error(
			`SEED_MAX_TICKS must be at least SEED_TICKS (${ticks}), got ${JSON.stringify(process.env.SEED_MAX_TICKS)}`,
		)
	}
	const gapSeconds = Number(process.env.SEED_TICK_GAP_SECONDS ?? 0)
	if (!Number.isFinite(gapSeconds) || gapSeconds < 0) {
		throw new Error(
			`SEED_TICK_GAP_SECONDS must be a non-negative number, got ${JSON.stringify(process.env.SEED_TICK_GAP_SECONDS)}`,
		)
	}

	return {
		baseUrl,
		slug: process.env.SEED_DEMO_SLUG ?? DEFAULT_SLUG,
		investorKey: (process.env.SEED_INVESTOR_KEY ?? ANVIL_INVESTOR_KEY) as Hex,
		depositBaseUnits: BigInt(parseAmount(process.env.SEED_DEPOSIT_USDC ?? DEFAULT_DEPOSIT_USDC)),
		ticks: Math.floor(ticks),
		maxTicks: Math.floor(maxTicks),
		gapSeconds,
	}
}

/* ── the HTTP client ─────────────────────────────────────── */

async function call<T>(baseUrl: string, method: string, route: string, token: string | null, body?: unknown): Promise<T> {
	const response = await fetch(`${baseUrl}${route}`, {
		method,
		headers: {
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`${method} ${route} -> ${response.status} ${text}`)
	}
	return JSON.parse(text) as T
}

/** Signs in the way the browser does: server nonce, local signature, recovered signer. */
async function signIn(baseUrl: string, key: Hex): Promise<{ token: string; address: Address }> {
	const account = privateKeyToAccount(key)
	const challenge = await call<LoginChallenge>(baseUrl, 'POST', '/auth/challenge', null, {
		address: account.address,
	})
	const signature = await account.signMessage({ message: challenge.message })
	const session = await call<Session>(baseUrl, 'POST', '/auth/verify', null, {
		address: challenge.address,
		signature,
	})
	return { token: session.token, address: getAddress(session.user.walletAddress as Address) }
}

/* ── the phase ───────────────────────────────────────────── */

/**
 * Funds one strategy and ticks it. Throws only on a failure that leaves the database in a
 * state the caller should know about; the caller decides whether a marketplace without a
 * track record is still worth keeping.
 */
export async function giveTrackRecord(options: TrackRecordOptions): Promise<TrackRecordResult> {
	const strategy = db.select().from(strategies).where(eq(strategies.slug, options.slug)).get()
	if (!strategy) throw new Error(`no strategy with slug ${JSON.stringify(options.slug)} to give a record to`)
	if (!strategy.vaultAddress) throw new Error(`strategy ${strategy.slug} has no vault, so nothing can be deposited`)
	if (strategy.status !== 'live') {
		console.warn(`  strategy ${strategy.slug} is ${strategy.status}, not live — funding and ticking it anyway`)
	}
	const vaultAddress = getAddress(strategy.vaultAddress as Address)

	const investorAccount = privateKeyToAccount(options.investorKey)
	const { token, address } = await signIn(options.baseUrl, options.investorKey)
	console.log(`  investor        ${address}`)

	// The faucet mints USDC and tops the gas up together: approve and deposit both cost ETH,
	// and an account holding USDC it cannot spend fails in an unreadable way.
	await call(options.baseUrl, 'POST', '/wallet/faucet', token, {
		amount: formatAmount(options.depositBaseUnits.toString()),
	})

	const approvalTxHash = await usdc.ensureAllowance(vaultAddress, options.depositBaseUnits, investorAccount)
	if (approvalTxHash) console.log(`  approve         ${approvalTxHash}`)

	const deposited = await vault.deposit(vaultAddress, options.depositBaseUnits, investorAccount)
	console.log(
		`  deposit         ${formatAmount(deposited.assets.toString())} USDC -> ${formatAmount(deposited.shares.toString())} shares (tx ${deposited.txHash})`,
	)

	// Recorded through the public route rather than by an insert: the backend fetches the
	// receipt, parses the Deposited event and checks the investor, so the seeded position is
	// verified against the chain the same way an investor's own is.
	const position = await call<Position>(
		options.baseUrl,
		'POST',
		`/strategies/${strategy.slug}/invest`,
		token,
		{ txHash: deposited.txHash },
	)
	console.log(`  position        ${position.shares} shares, cost basis ${position.costBasis} USDC`)

	// The baseline every later NAV is compared against. Read from the vault rather than
	// assumed to be par: the strategy may already have settled ticks before this run.
	const navFrom = await vault.navPerShare(vaultAddress)
	console.log(`  navPerShare     ${formatAmount(navFrom.toString())} before the first tick`)

	const scheduler = getScheduler()
	const outcomes: TickOutcome[] = []
	let navTo = navFrom

	// The requested ticks, then as many more as it takes for NAV to leave where it started.
	// A tick a flat strategy takes is a real tick — it decided, it recorded and it settled
	// applyPnl(0) — but a record made only of those is a straight line at par, so the phase
	// keeps going rather than handing back a card with nothing on it.
	for (let i = 0; i < options.maxTicks; i += 1) {
		if (i >= options.ticks && navTo !== navFrom) break
		if (i > 0 && options.gapSeconds > 0) await sleep(options.gapSeconds * 1_000)

		const outcome = await scheduler.tickOnce(strategy.id)
		outcomes.push(outcome)
		if (outcome.navPerShare !== null) navTo = BigInt(outcome.navPerShare)

		const beyond = i >= options.ticks ? ' (extra: NAV has not moved yet)' : ''
		console.log(
			`  tick ${i + 1}/${options.ticks}         ${outcome.status}  via ${outcome.source ?? 'no decision'}  ${outcome.decision?.action ?? '—'}  pnl ${outcome.pnlApplied === null ? '—' : formatAmount(outcome.pnlApplied)}  navPerShare ${outcome.navPerShare === null ? 'unchanged' : formatAmount(outcome.navPerShare)}${beyond}`,
		)
		if (outcome.error) console.warn(`                  ${outcome.error}`)
	}

	const attestedTicks = outcomes.filter(
		(outcome) => outcome.status === 'ok' && outcome.source === 'cre-simulate',
	).length
	const settledTicks = outcomes.filter(
		(outcome) => outcome.pnlApplied !== null && BigInt(outcome.pnlApplied) !== 0n,
	).length

	if (navTo === navFrom) {
		console.warn(
			`  ${strategy.slug} took ${outcomes.length} ticks without settling a non-zero delta: NAV is still ${formatAmount(navFrom.toString())}, so the card will show a flat line and a total return of exactly zero`,
		)
	}

	return {
		slug: strategy.slug,
		investorAddress: address,
		deposited: formatAmount(deposited.assets.toString()),
		depositTxHash: deposited.txHash,
		attestedTicks,
		settledTicks,
		navFrom: formatAmount(navFrom.toString()),
		navTo: formatAmount(navTo.toString()),
		navMoved: navTo !== navFrom,
		outcomes,
	}
}
