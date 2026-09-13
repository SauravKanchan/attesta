import { cn } from '@/lib/cn'
import { toSegments } from '@/components/strategy/fuzzy'

export interface HighlightProps {
	text: string
	/** Target indices returned by the fuzzy matcher. */
	indices?: readonly number[]
	className?: string
}

/** Renders a fuzzy match with the consumed characters picked out of the run. */
export function Highlight({ text, indices, className }: HighlightProps) {
	const segments = toSegments(text, indices)
	return (
		<span className={className}>
			{segments.map((segment, index) =>
				segment.matched ? (
					<mark
						key={index}
						className={cn('bg-verified/15 font-semibold text-verified')}
					>
						{segment.text}
					</mark>
				) : (
					<span key={index}>{segment.text}</span>
				),
			)}
		</span>
	)
}
