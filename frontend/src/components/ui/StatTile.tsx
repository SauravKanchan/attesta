import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface StatTileProps {
	label: string
	value: ReactNode
	/** A signed, already-coloured delta rendered under the value. */
	delta?: ReactNode
	hint?: ReactNode
	/** `display` is the hero figure on a detail page; `lg` is the grid default. */
	scale?: 'lg' | 'display'
	valueClassName?: string
	className?: string
}

export function StatTile({ label, value, delta, hint, scale = 'lg', valueClassName, className }: StatTileProps) {
	return (
		<div className={cn('rounded-sm border border-hairline bg-surface-2 px-4 py-3', className)}>
			<p className="type-label-caps text-fg-muted">{label}</p>
			<p
				className={cn(
					'mt-2 truncate text-fg',
					scale === 'display' ? 'type-metric-display' : 'type-metric-lg',
					valueClassName,
				)}
			>
				{value}
			</p>
			{delta ? <p className="mt-1 type-code-sm">{delta}</p> : null}
			{hint ? <p className="mt-1 type-body-sm text-fg-muted">{hint}</p> : null}
		</div>
	)
}
