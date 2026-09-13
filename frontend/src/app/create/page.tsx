import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PageHeader } from '@/components/PageHeader'
import { CreateStrategyFlow } from '@/components/create/CreateStrategyFlow'

/**
 * The editor is seeded from the same template file the strategy toolkit and the docs
 * point creators at, read here rather than copied into the bundle so the two can never
 * drift. Rendered per request so an edit to the template shows up on a reload.
 */
export const dynamic = 'force-dynamic'

const TEMPLATE_PATH = path.join(process.cwd(), '..', 'chainlink', 'templates', 'strategy.template.ts')

async function loadTemplate(): Promise<string | null> {
	try {
		return await readFile(TEMPLATE_PATH, 'utf8')
	} catch (error) {
		console.error(`attesta: could not read the strategy template at ${TEMPLATE_PATH}`, error)
		return null
	}
}

export default async function CreateStrategyPage() {
	const template = await loadTemplate()

	return (
		<>
			<PageHeader
				title="Create strategy"
				description="Write a TypeScript CRE workflow, encrypt its parameters in this browser, and publish once the pre-flight checks pass."
			/>
			<CreateStrategyFlow template={template} />
		</>
	)
}
