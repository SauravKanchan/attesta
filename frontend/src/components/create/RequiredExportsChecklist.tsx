'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { Tag } from '@/components/ui/Tag'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import { REQUIRED_EXPORT_NAMES, requiredExportStates } from '@/lib/strategy-source'

export interface RequiredExportsChecklistProps {
	source: string
	className?: string
}

/**
 * Ticks over as the creator types. It reads the source in the browser rather than
 * asking the backend, so there is no request per keystroke; `required-exports` in the
 * sanity pipeline is still the check that decides whether a submission may publish.
 */
export function RequiredExportsChecklist({ source, className }: RequiredExportsChecklistProps) {
	const states = useMemo(() => requiredExportStates(source), [source])
	const present = states.filter((state) => state.present).length
	const complete = present === REQUIRED_EXPORT_NAMES.length

	return (
		<div className={cn('flex flex-col rounded-sm border border-hairline bg-surface-1', className)}>
			<div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2.5">
				<h3 className="type-label-caps text-fg-secondary">Required exports</h3>
				<Tag tone={complete ? 'verified' : 'warning'} mono className="whitespace-nowrap">
					{present} / {states.length} valid
				</Tag>
			</div>

			<ul className="flex flex-col gap-1.5 p-3">
				{states.map((state) => (
					<li
						key={state.name}
						className={cn(
							'flex items-center justify-between gap-3 rounded-sm border px-2.5 py-2',
							state.present
								? 'border-hairline bg-surface-2'
								: state.unresolved
								  ? 'border-warning/40 bg-warning/8'
								  : 'border-risk/50 bg-risk/8',
						)}
					>
						<span className="min-w-0">
							<span className="block type-code-md text-fg">{state.signature}</span>
							<span className="block type-body-sm text-fg-muted">{state.purpose}</span>
						</span>
						{state.present ? (
							<CheckIcon className="size-3.5 shrink-0 text-verified" />
						) : (
							<span className="flex shrink-0 items-center gap-1.5">
								<span
									className={cn(
										'type-label-caps',
										state.unresolved ? 'text-warning-light' : 'text-risk-light',
									)}
								>
									{state.unresolved ? 'Re-export, unresolved' : 'Not exported yet'}
								</span>
								<AlertIcon
									className={cn(
										'size-3.5',
										state.unresolved ? 'text-warning-light' : 'text-risk-light',
									)}
								/>
							</span>
						)}
					</li>
				))}
			</ul>

			<p className="border-t border-hairline px-3 py-2.5 type-body-sm text-fg-secondary">
				Every strategy implements the same interface, which is what lets the marketplace read an
				investor&apos;s balance and process a withdrawal against your code rather than around it. The
				template re-exports the four accounting functions already; leave them alone unless you need
				custom share maths.
			</p>
		</div>
	)
}
