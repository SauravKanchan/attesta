import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { CodeIcon } from '@/components/ui/icons'

export default function CreateStrategyPage() {
	return (
		<>
			<PageHeader
				title="Create strategy"
				description="Write a TypeScript CRE workflow, encrypt its parameters in this browser, and publish once the sanity pipeline passes."
			/>
			<EmptyState
				icon={<CodeIcon className="size-4" />}
				title="The submission flow is not built yet"
				description="Editor, encrypted secrets, the nine sanity checks and publishing land in the next phase."
			/>
		</>
	)
}
