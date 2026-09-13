'use client'

import { useId, useMemo, useState } from 'react'
import {
	Area,
	AreaChart,
	CartesianGrid,
	ReferenceDot,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { cn } from '@/lib/cn'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { formatDateTime, formatUsdc, toNumber } from '@/lib/format'
import type { TimeRange, TimeseriesPoint } from '@/lib/types'

const RANGES: { value: TimeRange; label: string }[] = [
	{ value: '24h', label: '24H' },
	{ value: '7d', label: '7D' },
	{ value: '30d', label: '30D' },
	{ value: '90d', label: '90D' },
	{ value: 'all', label: 'ALL' },
]

export interface ChartEvent {
	t: string
	kind: 'deposit' | 'withdraw'
	label: string
}

export interface ChartProps {
	points: readonly TimeseriesPoint[]
	/** Controlled range. Omit both this and `onRangeChange` to let the chart own it. */
	range?: TimeRange
	onRangeChange?: (next: TimeRange) => void
	/** A dashed horizontal line, e.g. cost basis against a position's value. */
	referenceValue?: number | null
	referenceLabel?: string
	events?: readonly ChartEvent[]
	valueFormatter?: (value: number) => string
	height?: number
	className?: string
}

interface Datum {
	ts: number
	value: number
}

export function Chart({
	points,
	range,
	onRangeChange,
	referenceValue = null,
	referenceLabel,
	events = [],
	valueFormatter = formatUsdc,
	height = 280,
	className,
}: ChartProps) {
	const [internalRange, setInternalRange] = useState<TimeRange>('30d')
	const activeRange = range ?? internalRange
	const gradientId = useId().replace(/:/g, '')

	const data = useMemo<Datum[]>(() => {
		const parsed: Datum[] = []
		for (const point of points) {
			const value = toNumber(point.v)
			const ts = new Date(point.t).getTime()
			if (value === null || Number.isNaN(ts)) continue
			parsed.push({ ts, value })
		}
		return parsed.sort((a, b) => a.ts - b.ts)
	}, [points])

	const first = data[0]
	const last = data[data.length - 1]
	const rising = first !== undefined && last !== undefined ? last.value >= first.value : true
	const stroke = rising ? 'var(--color-verified)' : 'var(--color-risk)'

	const markers = useMemo(() => {
		if (data.length === 0) return []
		return events
			.map((event) => {
				const ts = new Date(event.t).getTime()
				if (Number.isNaN(ts)) return null
				// Snap to the nearest sampled point so the dot sits on the line.
				let nearest = data[0] as Datum
				for (const datum of data) {
					if (Math.abs(datum.ts - ts) < Math.abs(nearest.ts - ts)) nearest = datum
				}
				return { ...event, ts: nearest.ts, value: nearest.value }
			})
			.filter((marker): marker is ChartEvent & Datum => marker !== null)
	}, [events, data])

	function handleRange(next: TimeRange) {
		if (onRangeChange) onRangeChange(next)
		else setInternalRange(next)
	}

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div className="flex items-center justify-end">
				<SegmentedControl
					mono
					ariaLabel="Time range"
					options={RANGES}
					value={activeRange}
					onChange={handleRange}
				/>
			</div>
			<div style={{ height }}>
				{data.length === 0 ? (
					<div className="flex h-full items-center justify-center rounded-sm border border-dashed border-hairline type-body-sm text-fg-muted">
						No data in this range yet
					</div>
				) : (
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
							<defs>
								<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
									<stop offset="100%" stopColor={stroke} stopOpacity={0} />
								</linearGradient>
							</defs>
							<CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 4" vertical={false} />
							<XAxis
								dataKey="ts"
								type="number"
								scale="time"
								domain={['dataMin', 'dataMax']}
								tickFormatter={(value: number) => formatAxisTime(value, activeRange)}
								tick={AXIS_TICK}
								tickLine={false}
								axisLine={{ stroke: 'var(--color-hairline)' }}
								minTickGap={40}
							/>
							<YAxis
								width={64}
								domain={['auto', 'auto']}
								tickFormatter={valueFormatter}
								tick={AXIS_TICK}
								tickLine={false}
								axisLine={false}
							/>
							<Tooltip
								cursor={{ stroke: 'var(--color-hairline-strong)', strokeWidth: 1 }}
								content={(props) => (
									<ChartTooltip {...props} valueFormatter={valueFormatter} />
								)}
							/>
							{referenceValue !== null ? (
								<ReferenceLine
									y={referenceValue}
									stroke="var(--color-fg-muted)"
									strokeDasharray="4 4"
									label={
										referenceLabel
											? {
												  value: referenceLabel,
												  position: 'insideTopLeft',
												  fill: 'var(--color-fg-muted)',
												  fontSize: 10,
											  }
											: undefined
									}
								/>
							) : null}
							<Area
								type="linear"
								dataKey="value"
								stroke={stroke}
								strokeWidth={1.5}
								fill={`url(#${gradientId})`}
								isAnimationActive={false}
								activeDot={{ r: 3, fill: stroke, stroke: 'var(--color-canvas)', strokeWidth: 1 }}
								dot={false}
							/>
							{markers.map((marker) => (
								<ReferenceDot
									key={`${marker.kind}-${marker.ts}-${marker.label}`}
									x={marker.ts}
									y={marker.value}
									r={3.5}
									fill={
										marker.kind === 'deposit'
											? 'var(--color-telemetry-hover)'
											: 'var(--color-warning)'
									}
									stroke="var(--color-canvas)"
									strokeWidth={1}
								/>
							))}
						</AreaChart>
					</ResponsiveContainer>
				)}
			</div>
		</div>
	)
}

const AXIS_TICK = {
	fill: 'var(--color-fg-muted)',
	fontSize: 10,
	fontFamily: 'var(--font-mono)',
} as const

function formatAxisTime(value: number, range: TimeRange): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	if (range === '24h') {
		return new Intl.DateTimeFormat('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'UTC',
		}).format(date)
	}
	return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date)
}

type ChartTooltipProps = TooltipContentProps & {
	valueFormatter: (value: number) => string
}

function ChartTooltip({ active, payload, label, valueFormatter }: ChartTooltipProps) {
	if (!active || !payload || payload.length === 0) return null
	const entry = payload[0]
	const value = typeof entry?.value === 'number' ? entry.value : null
	if (value === null) return null
	return (
		<div className="rounded-sm border border-hairline-strong bg-surface-2 px-2.5 py-2">
			<p className="type-label-caps text-fg-muted">{formatDateTime(typeof label === 'number' ? label : null)}</p>
			<p className="mt-1 type-code-lg text-fg">{valueFormatter(value)}</p>
		</div>
	)
}
