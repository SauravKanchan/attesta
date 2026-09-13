import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
	/** Tier 1 sits on the canvas; tier 2 nests inside a tier 1 panel. */
	tier?: 1 | 2
	/** Drops the internal padding so tables can run edge to edge. */
	flush?: boolean
}

export function Card({ tier = 1, flush = false, className, children, ...rest }: CardProps) {
	return (
		<div
			className={cn(
				'rounded-sm border border-hairline',
				tier === 1 ? 'bg-surface-1' : 'bg-surface-2',
				!flush && 'p-4',
				className,
			)}
			{...rest}
		>
			{children}
		</div>
	)
}

export interface CardHeaderProps {
	title: ReactNode
	description?: ReactNode
	actions?: ReactNode
	className?: string
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
	return (
		<div className={cn('flex items-start justify-between gap-4 border-b border-hairline px-4 py-3', className)}>
			<div className="min-w-0">
				<h2 className="type-headline-sm text-fg">{title}</h2>
				{description ? <p className="mt-0.5 type-body-sm text-fg-secondary">{description}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</div>
	)
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn('p-4', className)} {...rest}>
			{children}
		</div>
	)
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn('flex items-center justify-end gap-2 border-t border-hairline px-4 py-3', className)} {...rest}>
			{children}
		</div>
	)
}
