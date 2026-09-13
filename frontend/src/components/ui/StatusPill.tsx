import { cn } from '@/lib/cn'
import type { StrategyStatus } from '@/lib/types'

interface StatusStyle {
	label: string
	tint: string
	dot: string
	/** A live strategy is the only thing that should draw the eye by moving. */
	pulse?: boolean
}

const STATUS: Record<StrategyStatus, StatusStyle> = {
	live: { label: 'Live', tint: 'border-verified/40 bg-verified/10 text-verified', dot: 'bg-verified', pulse: true },
	simulating: {
		label: 'Simulating',
		tint: 'border-telemetry/40 bg-telemetry/10 text-telemetry-hover',
		dot: 'bg-telemetry-hover',
		pulse: true,
	},
	checking: {
		label: 'Checking',
		tint: 'border-telemetry/40 bg-telemetry/10 text-telemetry-hover',
		dot: 'bg-telemetry-hover',
		pulse: true,
	},
	draft: { label: 'Draft', tint: 'border-hairline-strong bg-interact text-fg-secondary', dot: 'bg-fg-muted' },
	paused: { label: 'Paused', tint: 'border-warning/40 bg-warning/10 text-warning-light', dot: 'bg-warning' },
	failed: { label: 'Failed', tint: 'border-risk/40 bg-risk/10 text-risk-light', dot: 'bg-risk' },
}

export interface StatusPillProps {
	status: StrategyStatus
	className?: string
}

export function StatusPill({ status, className }: StatusPillProps) {
	const style = STATUS[status]
	return (
		<span
			className={cn(
				'inline-flex h-5 items-center gap-1.5 rounded-xs border px-1.5 type-label-caps',
				style.tint,
				className,
			)}
		>
			<span className={cn('size-1.5 rounded-xs', style.dot, style.pulse && 'pulse-dot')} />
			{style.label}
		</span>
	)
}
