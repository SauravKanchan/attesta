import { cn } from '@/lib/cn'

/**
 * A row-height trend glyph. Deliberately unsmoothed: the reader is looking at a NAV
 * series, and interpolation would invent shape the series does not have.
 */

export interface SparklineProps {
	values: readonly number[]
	width?: number
	height?: number
	className?: string
	/** Overrides the direction the colour is taken from, e.g. to match a parent metric. */
	tone?: 'up' | 'down'
}

export function Sparkline({ values, width = 96, height = 28, className, tone }: SparklineProps) {
	const points = values.filter((value) => Number.isFinite(value))
	if (points.length < 2) {
		return (
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				className={cn('text-fg-muted', className)}
				aria-hidden="true"
			>
				<line
					x1="0"
					y1={height / 2}
					x2={width}
					y2={height / 2}
					stroke="currentColor"
					strokeWidth="1"
					strokeDasharray="2 3"
				/>
			</svg>
		)
	}

	const first = points[0] as number
	const last = points[points.length - 1] as number
	const direction = tone ?? (last >= first ? 'up' : 'down')

	const min = Math.min(...points)
	const max = Math.max(...points)
	const span = max - min || 1
	// Half a pixel of inset keeps the 1px stroke from being clipped at the extremes.
	const top = 0.5
	const bottom = height - 0.5
	const usable = bottom - top

	const coordinates = points.map((value, index) => {
		const x = (index / (points.length - 1)) * width
		const y = bottom - ((value - min) / span) * usable
		return `${x.toFixed(2)},${y.toFixed(2)}`
	})

	const line = coordinates.join(' ')
	const area = `0,${height} ${line} ${width},${height}`

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			className={cn(direction === 'up' ? 'text-verified' : 'text-risk', className)}
			aria-hidden="true"
		>
			<polygon points={area} fill="currentColor" fillOpacity="0.12" />
			<polyline
				points={line}
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	)
}
