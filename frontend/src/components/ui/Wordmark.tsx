import { cn } from '@/lib/cn'
import { ShieldCheckIcon } from '@/components/ui/icons'

/**
 * The product mark. One component so the glyph, the name and the spacing between
 * them are identical in the sidebar, on the landing page and in the footer.
 */

export interface WordmarkProps {
	size?: 'sm' | 'md'
	/** Off in a collapsed sidebar, where only the glyph fits. */
	showName?: boolean
	className?: string
}

export function Wordmark({ size = 'md', showName = true, className }: WordmarkProps) {
	return (
		<span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
			<span
				className={cn(
					'flex shrink-0 items-center justify-center rounded-xs border border-verified/50 bg-verified/10 text-verified',
					size === 'sm' ? 'size-6' : 'size-7',
				)}
			>
				<ShieldCheckIcon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
			</span>
			{showName ? (
				<span
					className={cn(
						'truncate tracking-tight text-fg',
						size === 'sm' ? 'type-headline-sm' : 'type-headline-md',
					)}
				>
					attesta
				</span>
			) : null}
		</span>
	)
}
