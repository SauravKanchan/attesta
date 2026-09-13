'use client'

import Link from 'next/link'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusPill } from '@/components/ui/StatusPill'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { CodeIcon } from '@/components/ui/icons'
import { EM_DASH, formatPercent, formatUsd, signTextClass } from '@/lib/format'
import type { StrategySummary } from '@/lib/types'

export interface MyStrategiesTableProps {
	strategies: readonly StrategySummary[]
	loading: boolean
}

export function MyStrategiesTable({ strategies, loading }: MyStrategiesTableProps) {
	if (loading) return <Card className="h-40" />

	if (strategies.length === 0) {
		return (
			<EmptyState
				icon={<CodeIcon className="size-4" />}
				title="You have not published a strategy"
				description="Write a TypeScript CRE workflow, encrypt its parameters in your browser, and publish it once the pre-flight checks pass."
				action={
					<Link href="/create">
						<Button variant="primary">Create strategy</Button>
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
						<TableHeaderCell>Status</TableHeaderCell>
						<TableHeaderCell numeric>Investors</TableHeaderCell>
						<TableHeaderCell numeric>AUM</TableHeaderCell>
						<TableHeaderCell numeric>APY</TableHeaderCell>
						<TableHeaderCell numeric>Fees earned</TableHeaderCell>
						<TableHeaderCell className="text-right">Action</TableHeaderCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{strategies.map((strategy) => (
						<TableRow key={strategy.id} className="h-12">
							<TableCell>
								<Link
									href={`/strategy/${strategy.slug}`}
									className="flex flex-col transition-colors hover:text-fg"
								>
									<span className="flex items-center gap-2">
										<span className="type-body-md text-fg">{strategy.name}</span>
										<span className="type-code-sm text-fg-muted">{strategy.ticker}</span>
									</span>
									<span className="type-body-sm text-fg-muted">
										{strategy.metrics.navSnapshotCount} NAV snapshots
									</span>
								</Link>
							</TableCell>
							<TableCell>
								<StatusPill status={strategy.status} />
							</TableCell>
							<TableCell numeric>{strategy.metrics.investorCount}</TableCell>
							<TableCell numeric>{formatUsd(strategy.metrics.aum)}</TableCell>
							<TableCell numeric>
								<span className={cn(signTextClass(strategy.metrics.apy))}>
									{formatPercent(strategy.metrics.apy)}
								</span>
							</TableCell>
							<TableCell numeric className="text-fg-muted">
								{EM_DASH}
							</TableCell>
							<TableCell className="text-right">
								<Link href={`/strategy/${strategy.slug}`}>
									<Button size="compact">Manage</Button>
								</Link>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<p className="border-t border-hairline px-3 py-2 type-body-sm text-fg-muted">
				Fees earned reads {EM_DASH} because no fee is charged yet: the vault redeems shares at NAV and
				takes nothing on the way through. The creator fee model is still open — see
				docs/project-overview.md.
			</p>
		</Card>
	)
}
