// Turning a decision into a signed USDC delta.
//
// The weights a strategy held over the last interval earn that interval's price
// move; the weights it just asked for cost turnover to reach. Both halves are
// integer arithmetic on 6dp base units, because this number is settled on-chain
// by `vault.applyPnl(int256)` and a float cent lost per tick compounds into a
// wrong NAV.
//
//   marketPnl_i = totalManagedAssets x weightBps_i x (priceNow - pricePrev)
//                 ---------------------------------------------------------
//                                    10000 x pricePrev
//
//   fee         = (totalManagedAssets + marketPnl) x turnoverBps x feeBps
//                 -------------------------------------------------------
//                                    10000 x 10000
//
//   netPnl      = marketPnl - fee
//
// ── Rounding ────────────────────────────────────────────────────────────────
// Every division truncates toward zero, the same convention as lib/money.ts.
// For a gain that rounds down and for a loss it rounds up, so a move and its
// mirror image differ only in sign, and the vault is never asked to pay out a
// base unit the arithmetic did not actually produce. Each asset truncates
// independently, so the summed error is under one base unit per asset per tick.
// The fee truncates the same way, which rounds the cost down — the one
// direction that cannot make a strategy look better than it was, since the fee
// is subtracted.

import { BPS } from '../../../chainlink/strategy-toolkit/src/index.js'

export interface PriceDecisionInput {
	/** USDC under management before this tick settles, 6dp. */
	totalManagedAssets: bigint
	/** What the strategy held over the interval being priced. */
	previousWeightsBps: Record<string, number>
	/** What it just asked for. */
	targetWeightsBps: Record<string, number>
	/** Prices at the previous tick, 6dp. Empty on a strategy's first tick. */
	previousPrices: Record<string, bigint>
	/** Prices now, 6dp. */
	currentPrices: Record<string, bigint>
	/** Venue cost on turnover, in bps. */
	feeBps: number
}

export interface LegPnl {
	symbol: string
	weightBps: number
	priceFrom: bigint
	priceTo: bigint
	pnl: bigint
}

export interface PlannedTrade {
	symbol: string
	pair: string
	side: 'buy' | 'sell'
	/** Signed change in allocation, bps. */
	deltaBps: number
	/**
	 * USDC moved, 6dp. This is what `recordTrade` and the trades table carry as
	 * `size`, per the chain layer's definition of the field.
	 */
	notional: bigint
	/** The same trade expressed as a quantity of the base asset, 6dp. */
	quantity: bigint
	/** Execution price, 6dp USDC per unit. */
	price: bigint
	/** The leg's share of the interval's market pnl, 6dp. */
	pnl: bigint
}

export interface PricedDecision {
	/** What the held weights earned over the interval, before costs. */
	marketPnl: bigint
	legs: LegPnl[]
	/** Assets after the market move, which is what turnover is charged on. */
	assetsAfterMarket: bigint
	/** Sum of absolute weight changes, bps. A full rotation between two assets is 20000. */
	turnoverBps: number
	fee: bigint
	/** marketPnl - fee: the delta handed to the vault. */
	netPnl: bigint
	trades: PlannedTrade[]
}

/** bigint division rounds toward negative infinity; money rounds toward zero. */
export function truncatingDiv(numerator: bigint, denominator: bigint): bigint {
	if (denominator === 0n) throw new Error('pricing: division by zero')
	const negative = numerator < 0n !== denominator < 0n
	const absNumerator = numerator < 0n ? -numerator : numerator
	const absDenominator = denominator < 0n ? -denominator : denominator
	const quotient = absNumerator / absDenominator
	return negative ? -quotient : quotient
}

const bpsScale = BigInt(BPS)

export function priceDecision(input: PriceDecisionInput): PricedDecision {
	const totalManagedAssets = input.totalManagedAssets
	const legs: LegPnl[] = []
	let marketPnl = 0n

	for (const [symbol, weightBps] of Object.entries(input.previousWeightsBps)) {
		if (weightBps === 0) continue
		const priceFrom = input.previousPrices[symbol]
		const priceTo = input.currentPrices[symbol]
		// No pair of prices means no measured move: a strategy's first tick, or a
		// symbol the oracle did not quote. Inventing a move here would be inventing
		// performance.
		if (priceFrom === undefined || priceTo === undefined || priceFrom <= 0n) continue

		const pnl = truncatingDiv(
			totalManagedAssets * BigInt(weightBps) * (priceTo - priceFrom),
			bpsScale * priceFrom,
		)
		legs.push({ symbol, weightBps, priceFrom, priceTo, pnl })
		marketPnl += pnl
	}

	const assetsAfterMarket = totalManagedAssets + marketPnl
	const chargeable = assetsAfterMarket > 0n ? assetsAfterMarket : 0n

	const symbols = new Set([
		...Object.keys(input.previousWeightsBps),
		...Object.keys(input.targetWeightsBps),
	])

	const legPnl = new Map(legs.map((leg) => [leg.symbol, leg.pnl]))
	const trades: PlannedTrade[] = []
	let turnoverBps = 0

	for (const symbol of [...symbols].sort()) {
		const from = input.previousWeightsBps[symbol] ?? 0
		const to = input.targetWeightsBps[symbol] ?? 0
		const deltaBps = to - from
		if (deltaBps === 0) continue
		turnoverBps += Math.abs(deltaBps)

		const price = input.currentPrices[symbol]
		if (price === undefined || price <= 0n) continue

		const notional = truncatingDiv(chargeable * BigInt(Math.abs(deltaBps)), bpsScale)
		trades.push({
			symbol,
			pair: `${symbol}/USDC`,
			side: deltaBps > 0 ? 'buy' : 'sell',
			deltaBps,
			notional,
			quantity: truncatingDiv(notional * 1_000_000n, price),
			price,
			pnl: legPnl.get(symbol) ?? 0n,
		})
	}

	const fee = truncatingDiv(
		chargeable * BigInt(turnoverBps) * BigInt(input.feeBps),
		bpsScale * bpsScale,
	)

	return {
		marketPnl,
		legs,
		assetsAfterMarket,
		turnoverBps,
		fee,
		netPnl: marketPnl - fee,
		trades,
	}
}

/**
 * Whether the vault can be asked to settle at all this tick.
 *
 * `applyPnl` reverts with `NoSharesOutstanding()` on a gain when nobody holds
 * shares — a gain with no owner would sit in managed assets until the next
 * depositor, who mints 1:1 against a zero supply and would redeem the whole
 * stranded amount. A strategy nobody has funded still runs, still decides and
 * still records a NAV snapshot; it simply has no capital to move, so the
 * settlement is skipped rather than attempted and lost to a revert.
 */
export interface Settlement {
	settle: boolean
	/** Why the settlement was skipped, for the execution log. Null when it went ahead. */
	skipped: string | null
}

export function settlementFor(
	delta: bigint,
	vault: { totalShares: bigint },
): Settlement {
	if (vault.totalShares === 0n) {
		return {
			settle: false,
			skipped:
				delta === 0n
					? 'vault has no depositors: nothing to settle, so applyPnl was not sent'
					: `vault has no depositors: applyPnl(${delta}) would revert with NoSharesOutstanding, so it was not sent`,
		}
	}
	return { settle: true, skipped: null }
}

export type PnlClamp = 'reserve' | 'managed-assets' | null

export interface ClampedPnl {
	applied: bigint
	clamped: PnlClamp
	/** Human note for the execution row when the delta had to be cut. */
	note: string | null
}

/**
 * The vault refuses a gain larger than its reserve and a loss larger than the
 * assets it manages, and rightly so — either would break the promise that every
 * share is redeemable. Reverting the whole tick over it would lose the
 * decision as well, so the delta is cut to what the vault can settle and the
 * cut is recorded on the execution rather than hidden.
 */
export function clampPnl(
	netPnl: bigint,
	vault: { reserve: bigint; totalManagedAssets: bigint },
): ClampedPnl {
	if (netPnl > 0n && netPnl > vault.reserve) {
		return {
			applied: vault.reserve,
			clamped: 'reserve',
			note: `pnl ${netPnl} exceeded the vault reserve ${vault.reserve} and was capped`,
		}
	}
	if (netPnl < 0n && -netPnl > vault.totalManagedAssets) {
		return {
			applied: -vault.totalManagedAssets,
			clamped: 'managed-assets',
			note: `loss ${-netPnl} exceeded managed assets ${vault.totalManagedAssets} and was capped`,
		}
	}
	return { applied: netPnl, clamped: null, note: null }
}
