'use client'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatTile } from '@/components/ui/StatTile'
import { AlertIcon, WalletIcon } from '@/components/ui/icons'
import {
	EM_DASH,
	formatPercentPoints,
	formatUsd,
	formatSignedUsd,
	signTextClass,
	toNumber,
	truncateAddress,
} from '@/lib/format'
import type { PortfolioSummary } from '@/lib/types'

const gasFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

export interface PortfolioSummaryTilesProps {
	summary: PortfolioSummary | null
	loading: boolean
	onFaucet: () => void
	faucetPending: boolean
}

/**
 * Four figures, all of them read from `GET /portfolio`. Nothing here is derived in the
 * browser — the backend prices positions off the NAV series, and this renders what it
 * returned.
 */
export function PortfolioSummaryTiles({ summary, loading, onFaucet, faucetPending }: PortfolioSummaryTilesProps) {
	if (loading || summary === null) {
		return (
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="rounded-sm border border-hairline bg-surface-2 px-4 py-3">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="mt-3 h-6 w-32" />
						<Skeleton className="mt-2 h-3 w-16" />
					</div>
				))}
			</div>
		)
	}

	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<StatTile
				scale="display"
				label="Total value"
				value={formatUsd(summary.totalValue)}
				hint="Allocations at their latest attested NAV"
			/>
			<StatTile
				scale="display"
				label="Total invested"
				value={formatUsd(summary.totalInvested)}
				hint="Deposits minus withdrawals"
			/>
			<StatTile
				scale="display"
				label="All-time P&L"
				value={formatSignedUsd(summary.allTimePnl)}
				valueClassName={signTextClass(summary.allTimePnl)}
				delta={
					<span className={cn(signTextClass(summary.allTimePnlPct))}>
						{formatPercentPoints(summary.allTimePnlPct)}
					</span>
				}
			/>
			<StatTile
				scale="display"
				label="Available USDC"
				value={formatUsd(summary.availableUsdc)}
				hint={
					<span className="flex flex-col gap-1.5">
						<span className="flex flex-wrap items-center gap-2">
							<Button
								size="compact"
								onClick={onFaucet}
								loading={faucetPending}
								icon={<WalletIcon className="size-3.5" />}
							>
								Add funds
							</Button>
							<span className="num text-fg-muted">
								{summary.walletAddress ? truncateAddress(summary.walletAddress) : EM_DASH}
							</span>
						</span>
						<GasBalance balance={summary.gasBalance} />
					</span>
				}
			/>
		</div>
	)
}

/**
 * The browser signs its own approve, deposit and withdraw, so a wallet with no ETH cannot
 * transact however much USDC it holds. Shown next to the faucet that fixes it, and called
 * out when it hits zero rather than left to surface as a failed transaction.
 */
function GasBalance({ balance }: { balance: string }) {
	const parsed = toNumber(balance)
	if (parsed === null) return null
	if (parsed === 0) {
		return (
			<span className="flex items-center gap-1.5 text-warning-light">
				<AlertIcon className="size-3.5 shrink-0" />
				No ETH for gas — add funds before investing
			</span>
		)
	}
	return <span className="num text-fg-muted">{gasFormat.format(parsed)} ETH for gas</span>
}
