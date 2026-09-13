'use client'

import { useEffect, useState } from 'react'
import { formatEther, parseEther } from 'viem'
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
	truncateAddress,
} from '@/lib/format'
import { depositGasFloor } from '@/lib/wallet'
import type { PortfolioSummary } from '@/lib/types'

const gasFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
/** Under a hundredth of an ETH, four places collapse a balance and the fee it cannot cover
 * into the same 0.0001, so small figures are shown to three significant digits instead. */
const gasFineFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 })

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

/** `gasBalance` is whole ETH, 18dp, so it is parsed as wei rather than through a float. */
function toWei(balance: string): bigint | null {
	try {
		return parseEther(balance.trim())
	} catch (error) {
		console.error('attesta: the portfolio reported an unreadable gas balance', { balance, error })
		return null
	}
}

function formatEth(wei: bigint): string {
	const eth = Number(formatEther(wei))
	if (!Number.isFinite(eth)) return formatEther(wei)
	return eth > 0 && eth < 0.01 ? gasFineFormat.format(eth) : gasFormat.format(eth)
}

/** What an allocation costs in gas at the chain's current fee, or null until it answers. */
function useDepositGasFloor(): bigint | null {
	const [floor, setFloor] = useState<bigint | null>(null)

	useEffect(() => {
		let live = true
		depositGasFloor()
			.then((next) => {
				if (live) setFloor(next)
			})
			.catch((error: unknown) => {
				console.error('attesta: could not price the gas an allocation needs', error)
			})
		return () => {
			live = false
		}
	}, [])

	return floor
}

/**
 * The browser signs its own approve, deposit and withdraw, so a wallet with no ETH cannot
 * transact however much USDC it holds. Shown next to the faucet that fixes it, and called
 * out while it is still too thin to pay for an allocation — the approve is the first
 * thing that fails, and it fails looking like a contract fault rather than an empty tank.
 */
function GasBalance({ balance }: { balance: string }) {
	const floor = useDepositGasFloor()
	const wei = toWei(balance)
	if (wei === null) return null

	if (wei === 0n) {
		return (
			<span className="flex items-center gap-1.5 text-warning-light">
				<AlertIcon className="size-3.5 shrink-0" />
				No ETH for gas — add funds before investing
			</span>
		)
	}

	if (floor !== null && wei < floor) {
		return (
			<span className="flex items-start gap-1.5 text-warning-light">
				<AlertIcon className="mt-0.5 size-3.5 shrink-0" />
				<span className="num">
					{formatEth(wei)} ETH — under the {formatEth(floor)} ETH an allocation costs. Add funds first.
				</span>
			</span>
		)
	}

	return <span className="num text-fg-muted">{formatEth(wei)} ETH for gas</span>
}
