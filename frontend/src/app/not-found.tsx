import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/Button'

export default function NotFound() {
	return (
		<EmptyState
			title="Not found"
			description="That page does not exist."
			action={
				<LinkButton href="/" size="compact">
					Back to the marketplace
				</LinkButton>
			}
		/>
	)
}
