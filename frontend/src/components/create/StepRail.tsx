'use client'

import { cn } from '@/lib/cn'
import { CheckIcon } from '@/components/ui/icons'

export type StepIndex = 1 | 2 | 3

interface StepDefinition {
	index: StepIndex
	title: string
	subtitle: string
}

export const STEPS: readonly StepDefinition[] = [
	{ index: 1, title: 'Code', subtitle: 'Strategy interface and listing' },
	{ index: 2, title: 'Private parameters', subtitle: 'Encrypted in this browser' },
	{ index: 3, title: 'Review & publish', subtitle: 'Pre-flight checks and simulation' },
]

export interface StepRailProps {
	current: StepIndex
	/** Highest step reached, so a creator can go back without redoing the flow. */
	reached: StepIndex
	onNavigate: (step: StepIndex) => void
}

export function StepRail({ current, reached, onNavigate }: StepRailProps) {
	return (
		<ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
			{STEPS.map((step) => {
				const active = step.index === current
				const done = step.index < reached
				const reachable = step.index <= reached

				return (
					<li key={step.index}>
						<button
							type="button"
							disabled={!reachable}
							aria-current={active ? 'step' : undefined}
							onClick={() => onNavigate(step.index)}
							className={cn(
								'flex w-full items-center gap-3 rounded-sm border px-3 py-3 text-left transition-colors',
								active
									? 'border-verified bg-verified/8'
									: 'border-hairline bg-surface-1 hover:border-hairline-strong',
								!reachable && 'cursor-not-allowed opacity-50 hover:border-hairline',
							)}
						>
							<span
								className={cn(
									'flex size-6 shrink-0 items-center justify-center rounded-xs border type-code-sm',
									active
										? 'border-verified bg-verified text-canvas'
										: done
										  ? 'border-verified/40 bg-verified/10 text-verified'
										  : 'border-hairline bg-surface-2 text-fg-muted',
								)}
							>
								{done && !active ? <CheckIcon className="size-3" /> : step.index}
							</span>
							<span className="min-w-0">
								<span className={cn('block type-headline-sm', active ? 'text-fg' : 'text-fg-secondary')}>
									{step.index} {step.title}
								</span>
								<span className="block truncate type-body-sm text-fg-muted">{step.subtitle}</span>
							</span>
						</button>
						<span
							className={cn(
								'mt-1 block h-0.5 rounded-xs',
								active ? 'bg-verified' : done ? 'bg-verified/30' : 'bg-hairline',
							)}
						/>
					</li>
				)
			})}
		</ol>
	)
}
