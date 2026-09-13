'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons'
import type { SelectOption } from '@/components/ui/Select'

export interface MultiSelectProps<T extends string = string> {
	label?: string
	options: readonly SelectOption<T>[]
	value: readonly T[]
	onChange: (next: T[]) => void
	placeholder?: string
	className?: string
}

export function MultiSelect<T extends string = string>({
	label,
	options,
	value,
	onChange,
	placeholder = 'Any',
	className,
}: MultiSelectProps<T>) {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const listId = useId()

	useEffect(() => {
		if (!open) return
		function onPointerDown(event: MouseEvent) {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') setOpen(false)
		}
		document.addEventListener('mousedown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('mousedown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [open])

	function toggle(option: T) {
		onChange(value.includes(option) ? value.filter((entry) => entry !== option) : [...value, option])
	}

	const summary =
		value.length === 0
			? placeholder
			: value.length === 1
			  ? (options.find((option) => option.value === value[0])?.label ?? placeholder)
			  : `${value.length} selected`

	return (
		<div className={cn('flex flex-col gap-1.5', className)} ref={containerRef}>
			{label ? <span className="type-label-caps text-fg-secondary">{label}</span> : null}
			<div className="relative">
				<button
					type="button"
					aria-expanded={open}
					aria-controls={listId}
					onClick={() => setOpen((previous) => !previous)}
					className={cn(
						'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-hairline',
						'bg-surface-2 px-3 type-body-md transition-colors hover:border-hairline-strong',
						'focus:border-telemetry-hover focus:outline-none',
						value.length === 0 ? 'text-fg-muted' : 'text-fg',
					)}
				>
					<span className="truncate">{summary}</span>
					<ChevronDownIcon className={cn('size-3.5 shrink-0 text-fg-muted', open && 'rotate-180')} />
				</button>
				{open ? (
					<div
						id={listId}
						role="listbox"
						aria-multiselectable="true"
						className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-sm border border-hairline bg-surface-2 py-1"
					>
						{options.map((option) => {
							const selected = value.includes(option.value)
							return (
								<button
									key={option.value}
									type="button"
									role="option"
									aria-selected={selected}
									onClick={() => toggle(option.value)}
									className="flex h-8 w-full items-center gap-2 px-3 text-left type-body-md text-fg-secondary hover:bg-interact hover:text-fg"
								>
									<span
										className={cn(
											'flex size-3.5 shrink-0 items-center justify-center rounded-xs border',
											selected
												? 'border-verified bg-verified text-canvas'
												: 'border-hairline-strong',
										)}
									>
										{selected ? <CheckIcon className="size-2.5" /> : null}
									</span>
									<span className="truncate">{option.label}</span>
								</button>
							)
						})}
					</div>
				) : null}
			</div>
		</div>
	)
}
