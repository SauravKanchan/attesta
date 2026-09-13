import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PageHeaderProps {
	title: string
	description?: ReactNode
	actions?: ReactNode
	/** A ticker, hash tag or status pill sitting beside the title. */
	badge?: ReactNode
	className?: string
}

export function PageHeader({ title, description, actions, badge, className }: PageHeaderProps) {
	return (
		<div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-3">
					<h1 className="truncate type-headline-xl text-fg">{title}</h1>
					{badge}
				</div>
				{description ? <p className="mt-1 type-body-lg text-fg-secondary">{description}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</div>
	)
}
