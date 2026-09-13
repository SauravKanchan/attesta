import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { WalletIcon } from '@/components/ui/icons'

export default function PortfolioPage() {
	return (
		<>
			<PageHeader title="Portfolio" description="Your allocations, their value over time, and your USDC balance." />
			<EmptyState
				icon={<WalletIcon className="size-4" />}
				title="Nothing allocated yet"
				description="Positions, the value series and withdrawals land in the next phase."
			/>
		</>
	)
}
