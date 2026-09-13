// ─── attesta strategy template ──────────────────────────────────────────────
//
// Copy this file, edit describe() and onTick(), submit it. The four accounting
// functions on the last lines are re-exported defaults — leave them alone
// unless you need custom share maths.
//
// Your code runs inside an AWS Nitro enclave on every tick, and the workflow
// binary compiled from this source is the strategy's on-chain identity. That is
// what makes the track record verifiable, and it imposes two rules:
//
//  1. onTick() must be DETERMINISTIC — same context in, same decision out. No
//     Date.now(), no Math.random(), no network, no filesystem. DON consensus
//     compares enclave results, so a decision that varies cannot be attested,
//     and the submission checks reject the usual culprits before you get there.
//
//  2. Your CODE is public, your PARAMETERS are not. The binary is handed to the
//     enclave by the Workflow DON, so anything hardcoded below is published
//     with the strategy. Thresholds you want to keep are read at runtime with
//     ctx.getSecret() — the Chainlink Vault DON releases those only into an
//     attested enclave, and the platform never holds a key that opens them.

import type {
	PriceSnapshot,
	StrategyContext,
	StrategyDescription,
	TickDecision,
} from '@attesta/strategy-contract'

// ERC4626 share maths, already correct. These four are part of the required
// export surface so the platform can verify them and the vault can settle
// deposits and withdrawals against the same code investors see.
export {
	defaultBalanceOf as balanceOf,
	defaultOnDeposit as onDeposit,
	defaultOnWithdraw as onWithdraw,
	defaultTotalAssets as totalAssets,
} from '@attesta/strategy-contract'

// ─── Tuning ─────────────────────────────────────────────────────────────────
// Public defaults. The values that actually matter come from the Vault below.

const SYMBOL = 'ETH'
const LOOKBACK = 12
const DEFAULT_TARGET_BPS = 8_000

/** Vault secret holding the target allocation, in basis points. */
const TARGET_BPS_SECRET = 'TARGET_WEIGHT_BPS'

// ─── Metadata ───────────────────────────────────────────────────────────────
// `assets` is a hard boundary, not a hint: the vault's spending policy is built
// from it, so a symbol you do not declare here is one you cannot hold.

export const describe = (): StrategyDescription => ({
	name: 'Mean Crossover',
	ticker: 'XOVR',
	assets: [SYMBOL],
	summary:
		'Holds ETH while its price sits above the mean of the last 12 ticks, and sits in USDC otherwise.',
})

// ─── Decision ───────────────────────────────────────────────────────────────

export const onTick = (ctx: StrategyContext): TickDecision => {
	// Reading the secret here rather than baking the number in is the whole
	// point of running in the enclave: the allocation size stays private even
	// though this source is published.
	const targetBps = readBpsSecret(ctx, TARGET_BPS_SECRET, DEFAULT_TARGET_BPS)

	const price = priceOf(ctx.prices, SYMBOL)
	const mean = meanPrice(ctx.history, SYMBOL, LOOKBACK)
	const heldBps = ctx.currentWeightsBps[SYMBOL] ?? 0

	// Early ticks have no window to average over. Sitting still is a decision;
	// returning the current weights unchanged is how you express it.
	if (price === null || mean === null) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `waiting for ${LOOKBACK} ticks of ${SYMBOL} history`,
		}
	}

	const above = price > mean
	const wantBps = above ? targetBps : 0

	if (wantBps === heldBps) {
		return {
			action: 'HOLD',
			targetWeightsBps: { [SYMBOL]: heldBps },
			reason: `${SYMBOL} still ${above ? 'above' : 'below'} its ${LOOKBACK}-tick mean`,
		}
	}

	// ctx.log() lands in the execution record investors can read. Never log a
	// secret or anything derived from one closely enough to invert.
	ctx.log(`${SYMBOL} ${above ? 'crossed above' : 'fell below'} the ${LOOKBACK}-tick mean`)

	return {
		action: wantBps > heldBps ? 'ENTER' : 'EXIT',
		targetWeightsBps: { [SYMBOL]: wantBps },
		reason: `${SYMBOL} ${above ? 'above' : 'below'} its ${LOOKBACK}-tick mean`,
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// Prices are USDC with 6 decimals carried as bigint, so the maths below is
// exact. Floats would drift between enclaves and break consensus.

/** Price of `symbol` in this tick's snapshot, or null if the oracle omitted it. */
function priceOf(snapshot: PriceSnapshot[], symbol: string): bigint | null {
	for (const entry of snapshot) {
		if (entry.symbol === symbol) return entry.price
	}
	return null
}

/** Mean price of `symbol` over the last `lookback` ticks, or null if empty. */
function meanPrice(
	history: PriceSnapshot[][],
	symbol: string,
	lookback: number,
): bigint | null {
	let sum = 0n
	let count = 0n
	for (const snapshot of history.slice(-lookback)) {
		const price = priceOf(snapshot, symbol)
		if (price !== null) {
			sum += price
			count += 1n
		}
	}
	return count === 0n ? null : sum / count
}

/**
 * Reads a basis-point parameter from the Vault, falling back to the public
 * default when the secret is missing or out of range — a strategy that throws
 * on a bad parameter simply stops trading.
 */
function readBpsSecret(ctx: StrategyContext, id: string, fallback: number): number {
	// An unset secret comes back as an empty string, and Number('') is 0 — which
	// would silently flatten the position. Blank means "not provided".
	const raw = ctx.getSecret(id).trim()
	if (raw.length === 0) return fallback
	const value = Number(raw)
	if (!Number.isFinite(value) || value < 0 || value > 10_000) return fallback
	return Math.round(value)
}
