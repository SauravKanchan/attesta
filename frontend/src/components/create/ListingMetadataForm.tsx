'use client'

import { cn } from '@/lib/cn'
import { Input, Textarea } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CheckIcon } from '@/components/ui/icons'
import { RISK_LABEL, STRATEGY_TYPE_LABEL } from '@/components/strategy/strategy-meta'
import type { RiskLevel, StrategyType } from '@/lib/types'
import type { SubmissionInput } from '@/lib/api'

export type ListingMetadata = Omit<SubmissionInput, 'sourceCode'>

export const DESCRIPTION_LIMIT = 500
export const TICKER_LIMIT = 8

// Labels come from the marketplace's own map, so a chip here and a tag on a card can
// never disagree about what a type is called.
const TYPE_OPTIONS = (Object.keys(STRATEGY_TYPE_LABEL) as StrategyType[]).map((value) => ({
	value,
	label: STRATEGY_TYPE_LABEL[value],
}))

const RISK_OPTIONS = (Object.keys(RISK_LABEL) as RiskLevel[]).map((value) => ({
	value,
	label: RISK_LABEL[value],
}))

export const EMPTY_METADATA: ListingMetadata = {
	name: '',
	ticker: '',
	types: [],
	riskLevel: 'medium',
	description: '',
}

export interface ListingMetadataFormProps {
	value: ListingMetadata
	onChange: (next: ListingMetadata) => void
	/** Field-level messages, shown only once the creator has tried to continue. */
	errors: Partial<Record<keyof ListingMetadata, string>>
}

export function ListingMetadataForm({ value, onChange, errors }: ListingMetadataFormProps) {
	function patch(fields: Partial<ListingMetadata>) {
		onChange({ ...value, ...fields })
	}

	function toggleType(type: StrategyType) {
		patch({
			types: value.types.includes(type)
				? value.types.filter((entry) => entry !== type)
				: [...value.types, type],
		})
	}

	return (
		<div className="grid grid-cols-1 gap-4 rounded-sm border border-hairline bg-surface-1 p-4 lg:grid-cols-2">
			<Input
				label="Strategy name"
				placeholder="Mean Crossover"
				value={value.name}
				onChange={(event) => patch({ name: event.target.value })}
				error={errors.name ?? null}
			/>

			<Input
				mono
				label="Ticker"
				placeholder="XOVR"
				maxLength={TICKER_LIMIT}
				leading={<span className="type-code-md">$</span>}
				value={value.ticker}
				onChange={(event) => patch({ ticker: event.target.value.toUpperCase() })}
				error={errors.ticker ?? null}
				hint={`Up to ${TICKER_LIMIT} characters, shown on every card and table row`}
			/>

			<div className="flex flex-col gap-1.5">
				<span className="type-label-caps text-fg-secondary">Strategy type (multi-select)</span>
				<div className="flex flex-wrap gap-1.5">
					{TYPE_OPTIONS.map((option) => {
						const selected = value.types.includes(option.value)
						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={selected}
								onClick={() => toggleType(option.value)}
								className={cn(
									'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 type-body-sm transition-colors',
									selected
										? 'border-verified/50 bg-verified/10 text-verified'
										: 'border-hairline bg-surface-2 text-fg-secondary hover:bg-interact hover:text-fg',
								)}
							>
								{selected ? <CheckIcon className="size-3" /> : <span className="text-fg-muted">+</span>}
								{option.label}
							</button>
						)
					})}
				</div>
				{errors.types ? <p className="type-body-sm text-risk-light">{errors.types}</p> : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<span className="type-label-caps text-fg-secondary">Risk level</span>
				<SegmentedControl
					size="standard"
					ariaLabel="Risk level"
					options={RISK_OPTIONS}
					value={value.riskLevel}
					onChange={(riskLevel) => patch({ riskLevel })}
					className="w-fit"
				/>
				<p className="type-body-sm text-fg-muted">
					Your own declaration. Realised drawdown is measured from the NAV series either way.
				</p>
			</div>

			<div className="lg:col-span-2">
				<Textarea
					label="Description"
					rows={3}
					maxLength={DESCRIPTION_LIMIT}
					placeholder="How the strategy decides, in plain language."
					value={value.description}
					onChange={(event) => patch({ description: event.target.value })}
					error={errors.description ?? null}
					hint={`${value.description.length} / ${DESCRIPTION_LIMIT}`}
				/>
			</div>
		</div>
	)
}

/** Field errors for the metadata block, empty when the listing is ready to submit. */
export function validateMetadata(metadata: ListingMetadata): Partial<Record<keyof ListingMetadata, string>> {
	const errors: Partial<Record<keyof ListingMetadata, string>> = {}
	if (metadata.name.trim().length < 3) errors.name = 'Give the strategy a name of at least 3 characters'
	if (!/^[A-Z0-9]{2,8}$/.test(metadata.ticker.trim())) {
		errors.ticker = '2 to 8 characters, letters and digits'
	}
	if (metadata.types.length === 0) errors.types = 'Pick at least one type'
	if (metadata.description.trim().length < 20) {
		errors.description = 'Describe the approach in at least 20 characters'
	}
	return errors
}
