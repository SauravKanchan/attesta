'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { getStrategyExecutions, getStrategyTrades } from '@/lib/api'
import type { ApiError } from '@/lib/api'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Tag } from '@/components/ui/Tag'
import {
	EM_DASH,
	formatDateTime,
	formatDuration,
	formatSignedUsd,
	formatUsdcPrecise,
	signTextClass,
	truncateHash,
} from '@/lib/format'
import { RequestError } from '@/components/strategy/RequestError'
import { useResource } from '@/components/strategy/useResource'

type ActivityTab = 'trades' | 'executions'

export interface ActivityPanelProps {
	slug: string
	className?: string
}

/**
 * Two records of the same loop: the trades the vault settled, and the enclave runs that
 * decided them. Keeping the runs one click from the trades is what lets a reader tie a
 * number on this page back to an attested decision.
 */
export function ActivityPanel({ slug, className }: ActivityPanelProps) {
	const [tab, setTab] = useState<ActivityTab>('trades')

	const trades = useResource(() => getStrategyTrades(slug), [slug])
	const executions = useResource(() => getStrategyExecutions(slug), [slug], { enabled: tab === 'executions' })

	return (
		<section className={cn('rounded-sm border border-hairline bg-surface-1', className)}>
			<div className="px-4 pt-1">
				<Tabs
					ariaLabel="Strategy activity"
					value={tab}
					onChange={setTab}
					items={[
						{
							value: 'trades',
							label: 'Recent trades',
							badge: trades.data ? <Count value={trades.data.length} /> : undefined,
						},
						{
							value: 'executions',
							label: 'Enclave runs',
							badge: executions.data ? <Count value={executions.data.length} /> : undefined,
						},
					]}
				/>
			</div>

			{tab === 'trades' ? (
				<Panel
					loading={trades.loading}
					error={trades.error}
					onRetry={trades.reload}
					what="the trade history"
					empty={trades.data !== null && trades.data.length === 0}
					emptyLabel="No trade has settled for this strategy yet."
				>
					<Table>
						<TableHead>
							<TableRow>
								<TableHeaderCell>Time</TableHeaderCell>
								<TableHeaderCell>Pair</TableHeaderCell>
								<TableHeaderCell>Side</TableHeaderCell>
								<TableHeaderCell numeric>Size</TableHeaderCell>
								<TableHeaderCell numeric>Price</TableHeaderCell>
								<TableHeaderCell numeric>P&amp;L</TableHeaderCell>
								<TableHeaderCell>Tx</TableHeaderCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{(trades.data ?? []).map((trade) => (
								<TableRow key={trade.id}>
									<TableCell mono>{formatDateTime(trade.t)}</TableCell>
									<TableCell mono>{trade.pair}</TableCell>
									<TableCell>
										<Tag tone={trade.side === 'buy' ? 'verified' : 'risk'} mono>
											{trade.side.toUpperCase()}
										</Tag>
									</TableCell>
									<TableCell numeric>{formatUsdcPrecise(trade.size)}</TableCell>
									<TableCell numeric>{formatUsdcPrecise(trade.price)}</TableCell>
									<TableCell numeric className={signTextClass(trade.pnl)}>
										{formatSignedUsd(trade.pnl)}
									</TableCell>
									<TableCell mono title={trade.txHash ?? undefined}>
										{truncateHash(trade.txHash)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Panel>
			) : (
				<Panel
					loading={executions.loading}
					error={executions.error}
					onRetry={executions.reload}
					what="the execution log"
					empty={executions.data !== null && executions.data.length === 0}
					emptyLabel="The scheduler has not run this workflow yet."
				>
					<Table>
						<TableHead>
							<TableRow>
								<TableHeaderCell>Time</TableHeaderCell>
								<TableHeaderCell>Status</TableHeaderCell>
								<TableHeaderCell>Action</TableHeaderCell>
								<TableHeaderCell>Reason</TableHeaderCell>
								<TableHeaderCell numeric>P&amp;L applied</TableHeaderCell>
								<TableHeaderCell numeric>Duration</TableHeaderCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{(executions.data ?? []).map((execution) => (
								<TableRow key={execution.id}>
									<TableCell mono>{formatDateTime(execution.t)}</TableCell>
									<TableCell>
										<Tag tone={execution.status === 'ok' ? 'verified' : 'risk'} mono>
											{execution.status.toUpperCase()}
										</Tag>
									</TableCell>
									<TableCell mono>{execution.action ?? EM_DASH}</TableCell>
									<TableCell className="max-w-xs truncate whitespace-normal">
										{execution.error ?? execution.reason ?? EM_DASH}
									</TableCell>
									<TableCell numeric className={signTextClass(execution.pnlApplied)}>
										{execution.pnlApplied === null
											? EM_DASH
											: formatSignedUsd(execution.pnlApplied)}
									</TableCell>
									<TableCell numeric>{formatDuration(execution.durationMs)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Panel>
			)}
		</section>
	)
}

function Count({ value }: { value: number }) {
	return <span className="num rounded-xs bg-interact px-1.5 type-code-sm text-fg-secondary">{value}</span>
}

interface PanelProps {
	loading: boolean
	error: ApiError | null
	onRetry: () => void
	what: string
	empty: boolean
	emptyLabel: string
	children: ReactNode
}

function Panel({ loading, error, onRetry, what, empty, emptyLabel, children }: PanelProps) {
	if (loading) {
		return (
			<div className="flex flex-col gap-2 p-4">
				{Array.from({ length: 5 }, (_, index) => (
					<Skeleton key={index} className="h-8 w-full" />
				))}
			</div>
		)
	}
	if (error !== null) {
		return <RequestError className="m-4" error={error} what={what} onRetry={onRetry} />
	}
	if (empty) {
		return <p className="px-4 py-10 text-center type-body-md text-fg-muted">{emptyLabel}</p>
	}
	return <div className="pt-1">{children}</div>
}
