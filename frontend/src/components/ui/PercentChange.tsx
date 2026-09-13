import { cn } from '@/lib/cn'
import { EM_DASH, formatPercent, formatPercentPoints, signTextClass, toNumber, toneOf } from '@/lib/format'
import type { Numeric } from '@/lib/format'

/**
 * Every percentage in the product renders through this. The wire contract carries
 * two conventions — `apy`, `totalReturn` and `maxDrawdown` are fractions, while
 * `unrealisedPnlPct` and `allTimePnlPct` are already points — so the unit is an
 * explicit prop rather than something a caller has to remember to convert.
 */

export interface PercentChangeProps {
	value: Numeric
	/** `fraction`: 0.42 -> +42.00%. `points`: 42 -> +42.00%. */
	unit?: 'fraction' | 'points'
	signed?: boolean
	/** Colour by sign. On by default. */
	colour?: boolean
	/** A direction glyph, so the sign survives for a reader who cannot see the colour. */
	arrow?: boolean
	className?: string
	title?: string
}

export function PercentChange({
	value,
	unit = 'fraction',
	signed = true,
	colour = true,
	arrow = false,
	className,
	title,
}: PercentChangeProps) {
	const parsed = toNumber(value)
	if (parsed === null) {
		return (
			<span className={cn('num text-fg-muted', className)} title={title}>
				{EM_DASH}
			</span>
		)
	}

	const text = unit === 'points' ? formatPercentPoints(parsed, { signed }) : formatPercent(parsed, { signed })
	const tone = toneOf(parsed)

	return (
		<span
			className={cn('num inline-flex items-center gap-1 whitespace-nowrap', colour && signTextClass(parsed), className)}
			title={title}
		>
			{arrow && tone !== 'flat' ? <DirectionGlyph up={tone === 'up'} /> : null}
			{text}
		</span>
	)
}

function DirectionGlyph({ up }: { up: boolean }) {
	return (
		<svg viewBox="0 0 8 8" className="size-2 shrink-0" fill="currentColor" aria-hidden="true">
			<path d={up ? 'M4 1 7.5 7h-7L4 1Z' : 'M4 7 .5 1h7L4 7Z'} />
		</svg>
	)
}
