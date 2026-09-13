'use client'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatTile } from '@/components/ui/StatTile'
import { WalletIcon } from '@/components/ui/icons'
import { EM_DASH, formatPercentPoints, formatUsd, formatSignedUsd, signTextClass, truncateAddress } from '@/lib/format'
import type { PortfolioSummary } from '@/lib/types'

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
				}
			/>
		</div>
	)
}
