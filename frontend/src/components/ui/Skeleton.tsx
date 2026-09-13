import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
	className?: string
}

export function Skeleton({ className, ...rest }: SkeletonProps) {
	return <div aria-hidden="true" className={cn('sheen h-4 rounded-xs', className)} {...rest} />
}

export interface SkeletonTextProps {
	lines?: number
	className?: string
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
	return (
		<div className={cn('flex flex-col gap-2', className)}>
			{Array.from({ length: lines }, (_, index) => (
				<Skeleton key={index} className={index === lines - 1 ? 'w-2/3' : 'w-full'} />
			))}
		</div>
	)
}
