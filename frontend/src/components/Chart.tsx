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

	/**
	 * recharts derives an automatic domain from the plotted series alone, so a reference
	 * line outside it is clipped away silently — the cost basis of a position that has
	 * only ever been under water would be promised by the legend and never drawn. When
	 * there is a reference value, the domain is widened to hold it.
	 */
	const yDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
		if (referenceValue === null || !Number.isFinite(referenceValue) || data.length === 0) {
			return ['auto', 'auto']
		}
		let min = referenceValue
		let max = referenceValue
		for (const datum of data) {
			if (datum.value < min) min = datum.value
			if (datum.value > max) max = datum.value
		}
		return niceBounds(min, max)
	}, [data, referenceValue])

	/**
	 * The axis labels the data, not the range control: a 30D window holding an hour of
	 * ticks would otherwise stamp every point "Sep 13" and pile the labels on top of one
	 * another. Under a day and a half the reader needs the time of day; past that, the date.
	 */
	const xFormat: 'time' | 'date' | 'month' = useMemo(() => {
		if (data.length < 2) return 'time'
		const span = (data[data.length - 1] as Datum).ts - (data[0] as Datum).ts
		if (span < 36 * 60 * 60 * 1000) return 'time'
		if (span < 365 * 24 * 60 * 60 * 1000) return 'date'
		return 'month'
	}, [data])

	/**
	 * Evenly spaced ticks rather than one per sample. recharts thins its own ticks only
	 * once their boxes collide, which leaves a dense series with an unreadable axis.
	 */
	const xTicks = useMemo<number[] | undefined>(() => {
		if (data.length === 0) return undefined
		if (data.length <= AXIS_TICK_COUNT) return data.map((datum) => datum.ts)
		const first = (data[0] as Datum).ts
		const last = (data[data.length - 1] as Datum).ts
		if (last === first) return [first]
		return Array.from({ length: AXIS_TICK_COUNT }, (_, index) =>
			Math.round(first + ((last - first) * index) / (AXIS_TICK_COUNT - 1)),
		)
	}, [data])

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
								ticks={xTicks}
								tickFormatter={(value: number) => formatAxisTime(value, xFormat)}
								tick={AXIS_TICK}
								tickLine={false}
								axisLine={{ stroke: 'var(--color-hairline)' }}
								minTickGap={40}
							/>
							<YAxis
								width={64}
								domain={yDomain}
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

/**
 * Bounds rounded out to a round step. Handing recharts an explicit domain switches off its
 * own tick-rounding, so without this the axis reads 2,506.90 / 2,466.88 / 2,436.88 instead
 * of round figures a reader can compare at a glance.
 */
function niceBounds(min: number, max: number): [number, number] {
	if (!(max > min)) {
		const pad = Math.max(Math.abs(max) * 0.01, 1)
		return [min - pad, max + pad]
	}
	const rawStep = (max - min) / 4
	const magnitude = 10 ** Math.floor(Math.log10(rawStep))
	const normalised = rawStep / magnitude
	const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude
	return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}

const AXIS_TICK = {
	fill: 'var(--color-fg-muted)',
	fontSize: 10,
	fontFamily: 'var(--font-mono)',
} as const

/** How many labels the time axis carries at most. */
const AXIS_TICK_COUNT = 5

const AXIS_FORMATTERS: Record<'time' | 'date' | 'month', Intl.DateTimeFormat> = {
	time: new Intl.DateTimeFormat('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
	}),
	date: new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
	month: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
}

function formatAxisTime(value: number, format: 'time' | 'date' | 'month'): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return AXIS_FORMATTERS[format].format(date)
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
