'use client'

import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
	value: T
	label: string
}

export interface SegmentedControlProps<T extends string> {
	options: readonly SegmentedOption<T>[]
	value: T
	onChange: (next: T) => void
	/** Ranges and other figure-adjacent switches read better in mono. */
	mono?: boolean
	size?: 'compact' | 'standard'
	ariaLabel?: string
	className?: string
}

export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
	mono = false,
	size = 'compact',
	ariaLabel,
	className,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className={cn(
				'inline-flex items-center gap-0.5 rounded-sm border border-hairline bg-surface-2 p-0.5',
				className,
			)}
		>
			{options.map((option) => {
				const selected = option.value === value
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => onChange(option.value)}
						className={cn(
							'rounded-xs px-2.5 transition-colors',
							size === 'compact' ? 'h-6' : 'h-8 px-3',
							mono ? 'type-code-sm' : 'type-body-sm',
							selected
								? 'bg-interact text-fg'
								: 'text-fg-secondary hover:bg-interact/60 hover:text-fg',
						)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
