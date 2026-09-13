import { SourceView } from '@/components/strategy/SourceView'

export default async function StrategySourcePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	return <SourceView slug={slug} />
}
