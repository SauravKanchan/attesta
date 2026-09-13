'use client'

import { useMemo } from 'react'
import { StrategyCard } from '@/components/strategy/StrategyCard'
import { buildEntries } from '@/components/strategy/entries'
import type { ListingMetadata } from '@/components/create/ListingMetadataForm'
import type { StrategySummary, SubmissionDraft, User } from '@/lib/types'

/**
 * The marketplace's own card, fed a summary assembled from the draft — not a mock of
 * it. What the creator sees here is what an investor will see, including the parts that
 * are empty: an unpublished strategy has no NAV snapshots, so APY, drawdown and the
 * sparkline have nothing to show and render as such rather than as zeroes.
 */

/** The region the confidential workflow declares. AWS Nitro Enclaves, and nothing else. */
const REGIONS = ['us-west-2']

/** An empty vault is priced at par: `INITIAL_SHARE_PRICE` in StrategyVault.sol. */
const PAR_NAV_PER_SHARE = '1.000000'

export interface ListingPreviewProps {
	metadata: ListingMetadata
	draft: SubmissionDraft | null
	creator: User | null
}

export function ListingPreview({ metadata, draft, creator }: ListingPreviewProps) {
	const entry = useMemo(() => {
		const summary: StrategySummary = {
			id: draft?.id ?? 'preview',
			slug: 'preview',
			name: metadata.name.trim() === '' ? 'Untitled strategy' : metadata.name.trim(),
			ticker: metadata.ticker.trim() === '' ? '????' : metadata.ticker.trim(),
			types: metadata.types,
			riskLevel: metadata.riskLevel,
			status: draft?.status ?? 'draft',
			creator: { id: creator?.id ?? 'you', username: creator?.username ?? 'you' },
			vaultAddress: null,
			metrics: {
				apy: null,
				totalReturn: null,
				maxDrawdown: null,
				sharpe: null,
				aum: '0',
				investorCount: 0,
				navPerShare: PAR_NAV_PER_SHARE,
				navSnapshotCount: 0,
				updatedAt: null,
			},
			verification: {
				binaryHash: draft?.binaryHash ?? null,
				configHash: draft?.configHash ?? null,
				workflowId: null,
				tee: 'nitro',
				regions: REGIONS,
				// Nothing has been attested until the strategy runs a live tick.
				lastAttestedAt: null,
				sourceAvailable: true,
			},
			sparkline: [],
			createdAt: draft?.createdAt ?? new Date(0).toISOString(),
		}
		return buildEntries([summary], '')[0] ?? null
	}, [metadata, draft, creator])

	return (
		<div className="flex flex-col rounded-sm border border-hairline bg-surface-1">
			<div className="border-b border-hairline px-4 py-3">
				<h2 className="type-headline-sm text-fg">Listing preview</h2>
				<p className="mt-0.5 type-body-sm text-fg-secondary">
					How this appears in the marketplace. Performance is blank because there is none yet — the
					first figures arrive with the first NAV snapshot the scheduler writes.
				</p>
			</div>
			<div className="p-4">
				{entry === null ? null : (
					// Inert: the card links to a strategy that does not exist until publish.
					<div className="pointer-events-none max-w-md select-none" aria-label="Listing preview">
						<StrategyCard entry={entry} />
					</div>
				)}
			</div>
		</div>
	)
}
