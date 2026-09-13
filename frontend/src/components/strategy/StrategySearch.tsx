'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import { CloseIcon, SearchIcon } from '@/components/ui/icons'
import { EM_DASH, formatPercent, signTextClass } from '@/lib/format'
import type { StrategySummary } from '@/lib/types'
import { Highlight } from '@/components/strategy/Highlight'
import { buildEntries, rankEntries } from '@/components/strategy/entries'
import type { StrategyEntry } from '@/components/strategy/entries'

const MAX_SUGGESTIONS = 7

export interface StrategySearchProps {
	value: string
	onChange: (next: string) => void
	/** The whole catalogue, so a suggestion can reach past the current filters. */
	catalogue: readonly StrategySummary[]
	className?: string
}

/**
 * Fuzzy typeahead over name, creator and ticker. The dropdown exists to show *why* a
 * row matched — the matched characters are picked out in place, non-contiguous runs
 * included — so the search never looks like it guessed.
 */
export function StrategySearch({ value, onChange, catalogue, className }: StrategySearchProps) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const containerRef = useRef<HTMLDivElement>(null)
	const listId = useId()

	const suggestions = useMemo(
		() => (value.trim() === '' ? [] : rankEntries(buildEntries(catalogue, value), MAX_SUGGESTIONS)),
		[catalogue, value],
	)

	useEffect(() => setActive(0), [value])

	useEffect(() => {
		if (!open) return
		function onPointerDown(event: MouseEvent) {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('mousedown', onPointerDown)
		return () => document.removeEventListener('mousedown', onPointerDown)
	}, [open])

	const expanded = open && suggestions.length > 0

	function go(entry: StrategyEntry) {
		setOpen(false)
		router.push(`/strategy/${entry.strategy.slug}`)
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			if (expanded) setOpen(false)
			else onChange('')
			return
		}
		if (!expanded) {
			if (event.key === 'ArrowDown' && suggestions.length > 0) setOpen(true)
			return
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setActive((previous) => (previous + 1) % suggestions.length)
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setActive((previous) => (previous - 1 + suggestions.length) % suggestions.length)
		} else if (event.key === 'Enter') {
			const entry = suggestions[active]
			if (entry) {
				event.preventDefault()
				go(entry)
			}
		}
	}

	return (
		<div ref={containerRef} className={cn('relative', className)}>
			<div className="relative flex items-center">
				<SearchIcon className="pointer-events-none absolute left-3 size-3.5 text-fg-muted" />
				<input
					type="text"
					role="combobox"
					aria-expanded={expanded}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-label="Search strategies, creators and tickers"
					autoComplete="off"
					placeholder="Search strategies, creators, tickers (e.g. 'arb', 'momentum')"
					value={value}
					onChange={(event) => {
						onChange(event.target.value)
						setOpen(true)
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={onKeyDown}
					className={cn(
						'h-9 w-full rounded-sm border border-hairline bg-surface-2 pl-9 pr-9 type-body-md text-fg',
						'placeholder:text-fg-muted transition-colors hover:border-hairline-strong',
						'focus:border-telemetry-hover focus:outline-none',
					)}
				/>
				{value !== '' ? (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => {
							onChange('')
							setOpen(false)
						}}
						className="absolute right-2 flex size-6 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
					>
						<CloseIcon className="size-3" />
					</button>
				) : null}
			</div>

			{expanded ? (
				<ul
					id={listId}
					role="listbox"
					aria-label="Matching strategies"
					className="absolute z-40 mt-1 w-full overflow-hidden rounded-sm border border-hairline bg-surface-2 py-1 shadow-modal"
				>
					{suggestions.map((entry, index) => {
						const apy = entry.strategy.metrics.apy
						return (
							<li key={entry.strategy.id}>
								<button
									type="button"
									role="option"
									aria-selected={index === active}
									onMouseEnter={() => setActive(index)}
									onClick={() => go(entry)}
									className={cn(
										'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left',
										index === active ? 'bg-interact' : 'bg-transparent',
									)}
								>
									<span className="min-w-0">
										<span className="block truncate type-body-md text-fg">
											<Highlight text={entry.strategy.name} indices={entry.match?.name} />
										</span>
										<span className="mt-0.5 flex items-center gap-2 type-code-sm text-fg-secondary">
											<Highlight text={entry.ticker} indices={entry.match?.ticker} />
											<span className="text-fg-muted">&middot;</span>
											<Highlight text={entry.handle} indices={entry.match?.creator} />
										</span>
									</span>
									<span
										className={cn(
											'shrink-0 type-code-md',
											apy === null ? 'text-fg-muted' : signTextClass(apy),
										)}
									>
										{apy === null ? EM_DASH : formatPercent(apy)}
									</span>
								</button>
							</li>
						)
					})}
				</ul>
			) : null}
		</div>
	)
}
