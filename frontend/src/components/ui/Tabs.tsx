'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
	value: T
	label: string
	/** A count or status chip rendered after the label. */
	badge?: ReactNode
}

export interface TabsProps<T extends string> {
	items: readonly TabItem<T>[]
	value: T
	onChange: (next: T) => void
	ariaLabel?: string
	className?: string
}

export function Tabs<T extends string>({ items, value, onChange, ariaLabel, className }: TabsProps<T>) {
	return (
		<div role="tablist" aria-label={ariaLabel} className={cn('flex items-center gap-6 border-b border-hairline', className)}>
			{items.map((item) => {
				const selected = item.value === value
				return (
					<button
						key={item.value}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => onChange(item.value)}
						className={cn(
							'relative flex h-9 items-center gap-2 type-body-md transition-colors',
							selected ? 'text-fg' : 'text-fg-secondary hover:text-fg',
						)}
					>
						{item.label}
						{item.badge}
						<span
							className={cn(
								'absolute inset-x-0 -bottom-px h-px',
								selected ? 'bg-verified' : 'bg-transparent',
							)}
						/>
					</button>
				)
			})}
		</div>
	)
}
