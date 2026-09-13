// Vault share accounting, expressed over the base-unit strings the database stores.
//
// The maths itself comes from shared/strategy-contract.ts, so the backend, the strategy
// template and the on-chain vault all round the same way. A strategy that overrides the
// default accounting is priced with its own functions at the same seam.

import {
	INITIAL_SHARE_PRICE,
	defaultBalanceOf,
	defaultOnDeposit,
	defaultOnWithdraw,
	type AccountingResult,
	type VaultState,
} from '../../../shared/strategy-contract.js'
import { toBigInt } from './money.js'

export interface VaultTotals {
	/** USDC under management, base units. */
	totalAssets: string
	/** Shares outstanding, base units. */
	totalShares: string
}

export interface ShareChange {
	shares: string
	assets: string
}

export function toVaultState(totals: VaultTotals): VaultState {
	return { totalAssets: toBigInt(totals.totalAssets), totalShares: toBigInt(totals.totalShares) }
}

/** USDC one share is worth. An empty vault prices at inception, not at zero. */
export function navPerShare(totals: VaultTotals): string {
	const vault = toVaultState(totals)
	if (vault.totalShares === 0n) return INITIAL_SHARE_PRICE.toString()
	return ((vault.totalAssets * INITIAL_SHARE_PRICE) / vault.totalShares).toString()
}

/** What an investor's shares are worth right now. */
export function positionValue(shares: string, totals: VaultTotals): string {
	return defaultBalanceOf({ shares: toBigInt(shares) }, toVaultState(totals)).toString()
}

export function previewDeposit(totals: VaultTotals, assets: string): ShareChange {
	return toShareChange(defaultOnDeposit(toVaultState(totals), toBigInt(assets)))
}

export function previewWithdraw(totals: VaultTotals, shares: string): ShareChange {
	return toShareChange(defaultOnWithdraw(toVaultState(totals), toBigInt(shares)))
}

function toShareChange(result: AccountingResult): ShareChange {
	return { shares: result.shares.toString(), assets: result.assets.toString() }
}
