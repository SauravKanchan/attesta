'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { GridIcon } from '@/components/ui/icons'
import {
	EM_DASH,
	formatPercent,
	formatPercentPoints,
	formatUsd,
	formatSignedUsd,
	signTextClass,
} from '@/lib/format'
import { unitsOrZero } from '@/components/portfolio/units'
import type { Position, StrategySummary } from '@/lib/types'

export interface InvestmentsTableProps {
	positions: readonly Position[]
	/** Keyed by strategy id. APY lives on the strategy, not on the position. */
	strategies: ReadonlyMap<string, StrategySummary>
	onWithdraw: (position: Position) => void
	loading: boolean
}

export function InvestmentsTable({ positions, strategies, onWithdraw, loading }: InvestmentsTableProps) {
	// Share of book is measured against allocated capital, which is the sum of the
	// position values right here — not against `totalValue`, which also counts idle USDC.
	const allocatedTotal = useMemo(
		() => positions.reduce((total, position) => total + unitsOrZero(position.currentValue), 0n),
		[positions],
	)

	if (loading) return <Card className="h-40" />

	if (positions.length === 0) {
		return (
			<EmptyState
				icon={<GridIcon className="size-4" />}
				title="No allocations yet"
				description="Allocate USDC to a strategy and it appears here with its own value series, P&L and withdrawal."
				action={
					<Link href="/">
						<Button variant="primary">Browse the marketplace</Button>
					</Link>
				}
			/>
		)
	}

	return (
		<Card flush>
			<Table>
				<TableHead>
					<TableRow>
						<TableHeaderCell>Strategy</TableHeaderCell>
						<TableHeaderCell numeric>Allocated</TableHeaderCell>
						<TableHeaderCell numeric>Value</TableHeaderCell>
						<TableHeaderCell numeric>P&L</TableHeaderCell>
						<TableHeaderCell numeric>APY</TableHeaderCell>
						<TableHeaderCell numeric title="Share of your allocated capital">
							Share
						</TableHeaderCell>
						<TableHeaderCell className="text-right">Action</TableHeaderCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{positions.map((position) => {
						const strategy = strategies.get(position.strategyId)
						const value = unitsOrZero(position.currentValue)
						// Basis points, so a fractional share still reads exactly.
						const shareBps = allocatedTotal > 0n ? Number((value * 10_000n) / allocatedTotal) : null

						return (
							<TableRow key={position.id} className="h-12">
								<TableCell>
									<Link
										href={`/strategy/${position.strategySlug}`}
										className="flex flex-col transition-colors hover:text-fg"
									>
										<span className="flex items-center gap-2">
											<span className="type-body-md text-fg">{position.strategyName}</span>
											{strategy ? (
												<span className="type-code-sm text-fg-muted">
													{strategy.ticker}
												</span>
											) : null}
										</span>
										<span className="type-body-sm text-fg-muted">
											@{position.creatorUsername}
										</span>
									</Link>
								</TableCell>
								<TableCell numeric>{formatUsd(position.costBasis)}</TableCell>
								<TableCell numeric>{formatUsd(position.currentValue)}</TableCell>
								<TableCell numeric>
									<span className={cn('block', signTextClass(position.unrealisedPnl))}>
										{formatSignedUsd(position.unrealisedPnl)}
									</span>
									<span
										className={cn(
											'block type-code-sm',
											signTextClass(position.unrealisedPnlPct),
										)}
									>
										{formatPercentPoints(position.unrealisedPnlPct)}
									</span>
								</TableCell>
								<TableCell numeric>
									<span className={cn(signTextClass(strategy?.metrics.apy ?? null))}>
										{strategy ? formatPercent(strategy.metrics.apy) : EM_DASH}
									</span>
								</TableCell>
								<TableCell numeric>
									{shareBps === null ? EM_DASH : `${(shareBps / 100).toFixed(2)}%`}
								</TableCell>
								<TableCell className="text-right">
									<Button size="compact" onClick={() => onWithdraw(position)}>
										Withdraw
									</Button>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</Card>
	)
}
