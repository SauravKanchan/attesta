import { StrategyDetailView } from '@/components/strategy/StrategyDetailView'

export default async function StrategyPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	return <StrategyDetailView slug={slug} />
}
