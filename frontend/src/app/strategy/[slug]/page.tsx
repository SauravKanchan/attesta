import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tag } from '@/components/ui/Tag'

export default async function StrategyPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	return (
		<>
			<PageHeader title="Strategy" badge={<Tag mono>{slug}</Tag>} />
			<EmptyState
				title="Strategy detail is not wired up yet"
				description="Performance chart, attestation proof, trades, executions and the allocate panel land in the next phase."
			/>
		</>
	)
}
