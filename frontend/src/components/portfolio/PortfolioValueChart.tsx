'use client'

import { useMemo, useState } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Chart } from '@/components/Chart'
import { formatUsdc } from '@/lib/format'
import type { TimeRange, TimeseriesPoint } from '@/lib/types'

/** Window each range covers, in milliseconds. `all` has none. */
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	'90d': 90 * 24 * 60 * 60 * 1000,
}

/**
 * `GET /portfolio` returns the whole value series in one payload — there is no ranged
 * endpoint for it — so the range control filters what is already here rather than
 * refetching. The window is measured back from the newest point, not from the wall
 * clock, so a series that stops when the scheduler stops still renders.
 */
export function filterByRange(points: readonly TimeseriesPoint[], range: TimeRange): TimeseriesPoint[] {
	if (range === 'all' || points.length === 0) return [...points]
	let newest = Number.NEGATIVE_INFINITY
	for (const point of points) {
		const t = new Date(point.t).getTime()
		if (!Number.isNaN(t) && t > newest) newest = t
	}
	if (newest === Number.NEGATIVE_INFINITY) return []
	const cutoff = newest - RANGE_MS[range]
	return points.filter((point) => {
		const t = new Date(point.t).getTime()
		return !Number.isNaN(t) && t >= cutoff
	})
}

export interface PortfolioValueChartProps {
	points: readonly TimeseriesPoint[]
	loading: boolean
}

export function PortfolioValueChart({ points, loading }: PortfolioValueChartProps) {
	const [range, setRange] = useState<TimeRange>('30d')
	const visible = useMemo(() => filterByRange(points, range), [points, range])

	return (
		<Card flush>
			<CardHeader
				title="Portfolio value"
				description="Every allocation you hold, valued at each NAV snapshot the scheduler wrote."
			/>
			<div className="p-4">
				{loading ? (
					<Skeleton className="h-70 w-full" />
				) : (
					<Chart
						points={visible}
						range={range}
						onRangeChange={setRange}
						valueFormatter={formatUsdc}
						height={280}
					/>
				)}
			</div>
		</Card>
	)
}
