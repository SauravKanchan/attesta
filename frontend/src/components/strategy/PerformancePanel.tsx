'use client'

import { useMemo, useState } from 'react'
import { Chart } from '@/components/Chart'
import type { ChartEvent } from '@/components/Chart'
import { Skeleton } from '@/components/ui/Skeleton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { getStrategyPositionSeries, getStrategySeries } from '@/lib/api'
import { formatUsd, formatUsdc, formatUsdcPrecise, toNumber } from '@/lib/format'
import type { Position, TimeRange } from '@/lib/types'
import { RequestError } from '@/components/strategy/RequestError'
import { useResource } from '@/components/strategy/useResource'

type SeriesView = 'strategy' | 'position'

const VIEW_OPTIONS: readonly { value: SeriesView; label: string }[] = [
	{ value: 'position', label: 'Your value' },
	{ value: 'strategy', label: 'Strategy NAV' },
]

const CHART_HEIGHT = 300

export interface PerformancePanelProps {
	slug: string
	/** Present only when the caller holds a position; it selects the default view. */
	position: Position | null
}

/**
 * Two different series live here. The strategy's NAV per share is the public record;
 * an investor's own value is the answer to "what happened to my money", which starts at
 * their first deposit and is the one they came for, so it leads when they hold a position.
 */
export function PerformancePanel({ slug, position }: PerformancePanelProps) {
	const invested = position !== null
	const [view, setView] = useState<SeriesView>(invested ? 'position' : 'strategy')
	const [range, setRange] = useState<TimeRange>('30d')

	const activeView: SeriesView = invested ? view : 'strategy'

	const nav = useResource(() => getStrategySeries(slug, range), [slug, range])
	const own = useResource(() => getStrategyPositionSeries(slug, range), [slug, range], { enabled: invested })

	const events = useMemo<ChartEvent[]>(
		() =>
			(own.data?.events ?? []).map((event) => ({
				t: event.t,
				kind: event.kind,
				label: `${event.kind === 'deposit' ? 'Deposit' : 'Withdrawal'} ${formatUsd(event.amount)}`,
			})),
		[own.data],
	)

	const resource = activeView === 'position' ? own : nav
	const points = activeView === 'position' ? (own.data?.points ?? []) : (nav.data ?? [])
	const costBasis = activeView === 'position' ? toNumber(own.data?.costBasis) : null

	return (
		<section className="rounded-sm border border-hairline bg-surface-1">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3">
				<div>
					<h2 className="type-headline-sm text-fg">
						{activeView === 'position' ? 'Your value over time' : 'Performance'}
					</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						{activeView === 'position'
							? 'Your position from your first deposit, marked with every deposit and withdrawal.'
							: 'NAV per share, snapshotted after each attested tick.'}
					</p>
				</div>
				{invested ? (
					<SegmentedControl
						ariaLabel="Series"
						options={VIEW_OPTIONS}
						value={view}
						onChange={setView}
					/>
				) : null}
			</div>

			<div className="p-4">
				{resource.loading ? (
					<div className="flex flex-col gap-3">
						<Skeleton className="ml-auto h-7 w-56" />
						<Skeleton className="h-[300px] w-full" />
					</div>
				) : resource.error ? (
					<RequestError
						error={resource.error}
						what={activeView === 'position' ? 'your position history' : 'the NAV series'}
						onRetry={resource.reload}
					/>
				) : (
					<>
						<Chart
							points={points}
							range={range}
							onRangeChange={setRange}
							height={CHART_HEIGHT}
							events={activeView === 'position' ? events : []}
							referenceValue={costBasis}
							valueFormatter={activeView === 'position' ? formatUsdc : formatUsdcPrecise}
						/>
						{activeView === 'position' ? (
							<div className="mt-3 flex flex-wrap items-center gap-4 border-t border-hairline pt-3">
								<LegendDot className="bg-telemetry-hover" label="Deposit" />
								<LegendDot className="bg-warning" label="Withdrawal" />
								<span className="flex items-center gap-2 type-body-sm text-fg-secondary">
									<span className="h-px w-4 border-t border-dashed border-fg-muted" />
									Cost basis
								</span>
							</div>
						) : null}
					</>
				)}
			</div>
		</section>
	)
}

function LegendDot({ className, label }: { className: string; label: string }) {
	return (
		<span className="flex items-center gap-2 type-body-sm text-fg-secondary">
			<span className={`size-1.5 rounded-xs ${className}`} />
			{label}
		</span>
	)
}
