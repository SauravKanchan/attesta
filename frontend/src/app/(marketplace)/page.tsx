import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { GridIcon } from '@/components/ui/icons'

export default function MarketplacePage() {
	return (
		<>
			<PageHeader
				title="Marketplace"
				description="Every listed strategy, its attested track record, and what it costs to allocate."
			/>
			<EmptyState
				icon={<GridIcon className="size-4" />}
				title="No strategies listed yet"
				description="Strategy cards, search, filters and sorting land in the next phase."
			/>
		</>
	)
}
