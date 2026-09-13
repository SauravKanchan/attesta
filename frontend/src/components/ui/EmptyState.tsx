import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { InboxIcon } from '@/components/ui/icons'

export interface EmptyStateProps {
	title: string
	description?: ReactNode
	icon?: ReactNode
	action?: ReactNode
	className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-hairline',
				'bg-surface-1 px-6 py-16 text-center',
				className,
			)}
		>
			<span className="flex size-9 items-center justify-center rounded-sm border border-hairline bg-surface-2 text-fg-muted">
				{icon ?? <InboxIcon className="size-4" />}
			</span>
			<div className="max-w-md">
				<p className="type-headline-sm text-fg">{title}</p>
				{description ? <p className="mt-1 type-body-md text-fg-secondary">{description}</p> : null}
			</div>
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	)
}
