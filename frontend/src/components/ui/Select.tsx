'use client'

import { forwardRef, useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { ChevronDownIcon } from '@/components/ui/icons'

export interface SelectOption<T extends string = string> {
	value: T
	label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
	label?: string
	hint?: string
	options: readonly SelectOption[]
	placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
	{ label, hint, options, placeholder, className, id, ...rest },
	ref,
) {
	const generatedId = useId()
	const selectId = id ?? generatedId
	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<label htmlFor={selectId} className="type-label-caps text-fg-secondary">
					{label}
				</label>
			) : null}
			<div className="relative flex items-center">
				<select
					ref={ref}
					id={selectId}
					className={cn(
						'h-9 w-full appearance-none rounded-sm border border-hairline bg-surface-2 pl-3 pr-8',
						'type-body-md text-fg transition-colors hover:border-hairline-strong',
						'focus:border-telemetry-hover focus:outline-none disabled:opacity-50',
						className,
					)}
					{...rest}
				>
					{placeholder ? <option value="">{placeholder}</option> : null}
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<ChevronDownIcon className="pointer-events-none absolute right-3 size-3.5 text-fg-muted" />
			</div>
			{hint ? <p className="type-body-sm text-fg-muted">{hint}</p> : null}
		</div>
	)
})
