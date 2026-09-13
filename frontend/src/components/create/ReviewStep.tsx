'use client'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { CopyableHash } from '@/components/ui/CopyableHash'
import { AlertIcon, ShieldCheckIcon } from '@/components/ui/icons'
import { ListingPreview } from '@/components/create/ListingPreview'
import { PreflightChecks } from '@/components/create/PreflightChecks'
import { SimulationConsole } from '@/components/create/SimulationConsole'
import { firstFailedCheck } from '@/components/create/checks'
import type { ListingMetadata } from '@/components/create/ListingMetadataForm'
import type { SanityCheck, SubmissionDraft, User } from '@/lib/types'

export interface ReviewStepProps {
	metadata: ListingMetadata
	draft: SubmissionDraft | null
	creator: User | null
	checks: readonly SanityCheck[]
	simulationLog: readonly string[]
	streaming: boolean
	runError: string | null
	onRunChecks: () => void
}

export function ReviewStep({
	metadata,
	draft,
	creator,
	checks,
	simulationLog,
	streaming,
	runError,
	onRunChecks,
}: ReviewStepProps) {
	const failure = firstFailedCheck(checks)
	const started = checks.some((check) => check.status !== 'pending')

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hairline bg-surface-1 px-4 py-3">
				<div className="min-w-0">
					<h2 className="type-headline-sm text-fg">Review and publish</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						The nine checks in docs/build-plan.md run against your source in order. The strategy can
						only list once the simulation succeeds.
					</p>
				</div>
				<Button variant="primary" onClick={onRunChecks} loading={streaming}>
					{started ? 'Run checks again' : 'Run pre-flight checks'}
				</Button>
			</div>

			{runError === null ? null : (
				<div className="flex items-start gap-3 rounded-sm border border-risk/50 bg-risk/8 p-4">
					<AlertIcon className="mt-0.5 size-4 shrink-0 text-risk-light" />
					<div>
						<p className="type-headline-sm text-fg">The pipeline could not be run</p>
						<p className="mt-0.5 type-body-sm text-fg-secondary">{runError}</p>
					</div>
				</div>
			)}

			<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="flex flex-col gap-4">
					<PreflightChecks checks={checks} streaming={streaming} />
					<SimulationConsole lines={simulationLog} streaming={streaming} />
				</div>

				<div className="flex flex-col gap-4">
					<IdentityPanel draft={draft} />
					<ListingPreview metadata={metadata} draft={draft} creator={creator} />
				</div>
			</div>

			{failure === null ? null : (
				<p className="type-body-sm text-risk-light">
					Publishing is blocked at <span className="type-code-md">{failure.id}</span>. Go back to the
					code step, fix it, and run the checks again.
				</p>
			)}
		</div>
	)
}

function IdentityPanel({ draft }: { draft: SubmissionDraft | null }) {
	const measured = draft?.binaryHash != null

	return (
		<div className="flex flex-col rounded-sm border border-hairline bg-surface-1">
			<div className="flex items-start gap-2 border-b border-hairline px-4 py-3">
				<ShieldCheckIcon
					className={cn('mt-0.5 size-4 shrink-0', measured ? 'text-verified' : 'text-fg-muted')}
				/>
				<div>
					<h2 className="type-headline-sm text-fg">Strategy identity</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						Produced by the build, not chosen. Change one character of the source and the binary
						hashes differently, which publishes a different strategy rather than editing this one.
					</p>
				</div>
			</div>
			<dl className="flex flex-col gap-3 p-4">
				<div>
					<dt className="type-label-caps text-fg-muted">Binary hash</dt>
					<dd className="mt-1">
						<CopyableHash full recessed value={draft?.binaryHash} label="binary hash" className="w-full" />
					</dd>
				</div>
				<div>
					<dt className="type-label-caps text-fg-muted">Config hash</dt>
					<dd className="mt-1">
						<CopyableHash full recessed value={draft?.configHash} label="config hash" className="w-full" />
					</dd>
				</div>
				<div>
					<dt className="type-label-caps text-fg-muted">Runtime</dt>
					<dd className="mt-1 type-code-md text-fg-secondary">AWS Nitro Enclaves &middot; us-west-2</dd>
				</div>
			</dl>
			{measured ? null : (
				<p className="border-t border-hairline px-4 py-2.5 type-body-sm text-fg-muted">
					Both hashes appear once <span className="type-code-sm">cre workflow build</span> succeeds.
				</p>
			)}
		</div>
	)
}
