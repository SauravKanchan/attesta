import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type TagTone = 'neutral' | 'verified' | 'telemetry' | 'risk' | 'warning'

const TONE: Record<TagTone, string> = {
	neutral: 'border-hairline bg-interact text-fg-secondary',
	verified: 'border-verified/40 bg-verified/10 text-verified',
	telemetry: 'border-telemetry/40 bg-telemetry/10 text-telemetry-hover',
	risk: 'border-risk/40 bg-risk/10 text-risk-light',
	warning: 'border-warning/40 bg-warning/10 text-warning-light',
}

export interface TagProps {
	children: ReactNode
	tone?: TagTone
	/** Tickers, symbols and hashes; anything a reader might compare character by character. */
	mono?: boolean
	/** Sinks the chip below its surface, for read-only artefacts such as a binary hash. */
	recessed?: boolean
	className?: string
	title?: string
}

export function Tag({ children, tone = 'neutral', mono = false, recessed = false, className, title }: TagProps) {
	return (
		<span
			title={title}
			className={cn(
				'inline-flex h-5 items-center gap-1 rounded-xs border px-1.5',
				mono ? 'type-code-sm' : 'type-body-sm',
				recessed ? 'recessed text-fg-secondary' : TONE[tone],
				className,
			)}
		>
			{children}
		</span>
	)
}
