'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'
import { listStrategies } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { CloseIcon, GridIcon } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { PageHeader } from '@/components/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import type { RiskLevel, StrategyType } from '@/lib/types'
import { buildEntries } from '@/components/strategy/entries'
import { RequestError } from '@/components/strategy/RequestError'
import { StrategyCard, StrategyCardSkeleton } from '@/components/strategy/StrategyCard'
import { StrategySearch } from '@/components/strategy/StrategySearch'
import { useResource } from '@/components/strategy/useResource'
import {
	DEFAULT_SORT,
	RISK_FILTER_OPTIONS,
	RISK_LABEL,
	SORT_LABEL,
	SORT_OPTIONS,
	STRATEGY_TYPE_LABEL,
	STRATEGY_TYPE_OPTIONS,
} from '@/components/strategy/strategy-meta'
import type { RiskFilter, SortKey } from '@/components/strategy/strategy-meta'

/** Long enough that a fast typist makes one request, short enough to feel immediate. */
const SEARCH_DEBOUNCE_MS = 180
const CATALOGUE_LIMIT = 200
const SKELETON_CARDS = 6

export function MarketplaceBrowser() {
	// The app shell's search box hands its query over as `/?q=`, so the grid has to read
	// it rather than start empty and silently drop what the reader typed.
	const urlQuery = useSearchParams().get('q') ?? ''

	const [query, setQuery] = useState(urlQuery)
	const [debouncedQuery, setDebouncedQuery] = useState(urlQuery)
	const [types, setTypes] = useState<StrategyType[]>([])
	const [risk, setRisk] = useState<RiskFilter>('any')
	const [sort, setSort] = useState<SortKey>(DEFAULT_SORT)

	// A handover arrives whole, so it skips the debounce; typing here never changes the
	// URL, so this cannot fight the field.
	useEffect(() => {
		setQuery(urlQuery)
		setDebouncedQuery(urlQuery)
	}, [urlQuery])

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [query])

	// Unfiltered, so the typeahead can suggest a strategy the current filters exclude.
	const catalogue = useResource(() => listStrategies({ limit: CATALOGUE_LIMIT }), [])

	const typeKey = types.join(',')
	const results = useResource(
		() =>
			listStrategies({
				q: debouncedQuery.trim() === '' ? undefined : debouncedQuery.trim(),
				types: types.length > 0 ? types : undefined,
				risk: risk === 'any' ? undefined : risk,
				sort,
			}),
		[debouncedQuery, typeKey, risk, sort],
	)

	const entries = useMemo(
		() => buildEntries(results.data?.strategies ?? [], debouncedQuery),
		[results.data, debouncedQuery],
	)

	const filtered = types.length > 0 || risk !== 'any' || debouncedQuery.trim() !== ''
	const total = catalogue.data?.total ?? results.data?.total ?? null

	function clearAll() {
		setQuery('')
		setDebouncedQuery('')
		setTypes([])
		setRisk('any')
	}

	return (
		<>
			<PageHeader
				title="Marketplace"
				description="Every listed strategy, its attested track record, and what it costs to allocate."
			/>

			<div className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-1 p-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-end">
					<StrategySearch
						value={query}
						onChange={setQuery}
						catalogue={catalogue.data?.strategies ?? []}
						className="lg:flex-1"
					/>
					<Select
						label="Sort by"
						options={SORT_OPTIONS}
						value={sort}
						onChange={(event) => setSort(event.target.value as SortKey)}
						className="lg:w-44"
					/>
				</div>

				<div className="flex flex-col gap-3 border-t border-hairline pt-3 sm:flex-row sm:items-end">
					<MultiSelect
						label="Strategy type"
						options={STRATEGY_TYPE_OPTIONS}
						value={types}
						onChange={setTypes}
						placeholder="All types"
						className="sm:w-56"
					/>
					<div className="flex flex-col gap-1.5">
						<span className="type-label-caps text-fg-secondary">Risk profile</span>
						<SegmentedControl
							size="standard"
							ariaLabel="Risk profile"
							options={RISK_FILTER_OPTIONS}
							value={risk}
							onChange={setRisk}
						/>
					</div>
				</div>

				{filtered ? (
					<div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
						<span className="type-label-caps text-fg-muted">Active criteria</span>
						{debouncedQuery.trim() !== '' ? (
							<FilterChip
								label="Search"
								value={debouncedQuery.trim()}
								onRemove={() => {
									setQuery('')
									setDebouncedQuery('')
								}}
							/>
						) : null}
						{types.map((type) => (
							<FilterChip
								key={type}
								label="Type"
								value={STRATEGY_TYPE_LABEL[type]}
								onRemove={() => setTypes(types.filter((entry) => entry !== type))}
							/>
						))}
						{risk !== 'any' ? (
							<FilterChip
								label="Risk"
								value={RISK_LABEL[risk as RiskLevel]}
								onRemove={() => setRisk('any')}
							/>
						) : null}
						<button
							type="button"
							onClick={clearAll}
							className="type-body-sm text-fg-secondary underline underline-offset-2 transition-colors hover:text-fg"
						>
							Clear all filters
						</button>
					</div>
				) : null}
			</div>

			<div className="mt-4 flex items-center justify-between gap-3">
				<p className="type-body-sm text-fg-secondary" aria-live="polite">
					{results.loading ? (
						<span className="text-fg-muted">Loading strategies</span>
					) : results.error ? (
						<span className="text-fg-muted">Result count unavailable</span>
					) : (
						<>
							Showing <span className="num text-fg">{entries.length}</span>
							{total === null ? null : (
								<>
									{' of '}
									<span className="num text-fg">{total}</span>
								</>
							)}{' '}
							{total === 1 ? 'strategy' : 'strategies'}
							{results.refreshing ? <span className="ml-2 text-fg-muted">updating</span> : null}
						</>
					)}
				</p>
				<p className="type-body-sm text-fg-muted">
					Sorted by <span className="text-fg-secondary">{SORT_LABEL[sort]}</span>
				</p>
			</div>

			<div className="mt-3">
				{results.loading ? (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{Array.from({ length: SKELETON_CARDS }, (_, index) => (
							<StrategyCardSkeleton key={index} />
						))}
					</div>
				) : results.error ? (
					<RequestError error={results.error} what="the strategy list" onRetry={results.reload} />
				) : entries.length === 0 ? (
					<EmptyState
						icon={<GridIcon className="size-4" />}
						title={filtered ? 'No strategies match these criteria' : 'No strategies listed yet'}
						description={
							filtered
								? 'No listed strategy satisfies every active filter at once. Widen the criteria or clear them.'
								: 'A strategy appears here once its creator publishes it and its first simulation is attested.'
						}
						action={
							filtered ? (
								<Button size="compact" onClick={clearAll}>
									Clear all filters
								</Button>
							) : null
						}
					/>
				) : (
					<div
						className={cn(
							'grid gap-4 md:grid-cols-2 xl:grid-cols-3',
							results.refreshing && 'opacity-60 transition-opacity',
						)}
					>
						{entries.map((entry) => (
							<StrategyCard key={entry.strategy.id} entry={entry} />
						))}
					</div>
				)}
			</div>
		</>
	)
}

interface FilterChipProps {
	label: string
	value: string
	onRemove: () => void
}

function FilterChip({ label, value, onRemove }: FilterChipProps) {
	return (
		<span className="inline-flex h-6 items-center gap-1.5 rounded-xs border border-hairline bg-interact pl-2 pr-1 type-body-sm text-fg-secondary">
			<span className="type-label-caps text-fg-muted">{label}</span>
			<span className="text-fg">{value}</span>
			<button
				type="button"
				aria-label={`Remove ${label} filter ${value}`}
				onClick={onRemove}
				className="flex size-4 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
			>
				<CloseIcon className="size-2.5" />
			</button>
		</span>
	)
}
