import Link from 'next/link'
import { EmptyState } from '@/components/ui/EmptyState'

export default function NotFound() {
	return (
		<EmptyState
			title="Not found"
			description="That page does not exist."
			action={
				<Link
					href="/"
					className="inline-flex h-7 items-center rounded-sm border border-hairline-strong bg-surface-2 px-3 type-body-sm text-fg transition-colors hover:bg-interact"
				>
					Back to the marketplace
				</Link>
			}
		/>
	)
}
