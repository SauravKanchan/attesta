import { cn } from '@/lib/cn'
import {
	EM_DASH,
	formatUsd,
	formatUsdCompact,
	formatUsdc,
	formatUsdcPrecise,
	signTextClass,
	toNumber,
} from '@/lib/format'
import type { Numeric } from '@/lib/format'

/**
 * Every currency figure in the product renders through this, so tabular figures,
 * the sign and the colour of a gain or a loss are decided in exactly one place.
 * The value is always a wire decimal string; nothing here does arithmetic.
 */

export interface MoneyValueProps {
	value: Numeric
	/** Carries an explicit + so a gain is never mistaken for a loss. */
	signed?: boolean
	/** `$2.4M` rather than `$2,400,000.00`, for AUM columns and stat tiles. */
	compact?: boolean
	/** Keeps all six decimals — NAV per share and share counts carry meaning there. */
	precise?: boolean
	/** Drops the currency mark for a column already headed USDC. */
	symbol?: boolean
	/** Colour by sign. On by default for signed figures, off otherwise. */
	colour?: boolean
	className?: string
	title?: string
}

export function MoneyValue({
	value,
	signed = false,
	compact = false,
	precise = false,
	symbol = true,
	colour,
	className,
	title,
}: MoneyValueProps) {
	const parsed = toNumber(value)
	if (parsed === null) {
		return (
			<span className={cn('num text-fg-muted', className)} title={title}>
				{EM_DASH}
			</span>
		)
	}

	const tinted = colour ?? signed
	const magnitude = Math.abs(parsed)
	const prefix = parsed < 0 ? '-' : signed && parsed > 0 ? '+' : ''

	// Every formatter below already carries the currency mark bar the plain ones,
	// so the mark is stripped rather than conditionally assembled.
	const body = compact
		? formatUsdCompact(magnitude)
		: precise
		  ? `$${formatUsdcPrecise(magnitude)}`
		  : formatUsd(magnitude)

	return (
		<span
			className={cn('num whitespace-nowrap', tinted && signTextClass(parsed), className)}
			title={title ?? (compact ? `$${formatUsdc(parsed)}` : undefined)}
		>
			{`${prefix}${symbol ? body : body.replace('$', '')}`}
		</span>
	)
}
