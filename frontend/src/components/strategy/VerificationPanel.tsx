import Link from 'next/link'
import { cn } from '@/lib/cn'
import { AlertIcon, CheckIcon, ExternalIcon, ShieldCheckIcon } from '@/components/ui/icons'
import { EM_DASH, formatDateTime } from '@/lib/format'
import type { StrategyVerification } from '@/lib/types'
import { CopyRow } from '@/components/strategy/CopyRow'

/** The only TEE this product runs on. Nothing else may be claimed here. */
const TEE_LABEL = 'AWS Nitro Enclaves'

export interface VerificationPanelProps {
	slug: string
	verification: StrategyVerification
	className?: string
}

interface ProofLink {
	label: string
	met: boolean
	metDetail: string
	unmetDetail: string
}

export function VerificationPanel({ slug, verification, className }: VerificationPanelProps) {
	const regions = verification.regions.length > 0 ? verification.regions.join(', ') : EM_DASH

	const chain: ProofLink[] = [
		{
			label: 'Source published',
			met: verification.sourceAvailable,
			metDetail: 'The exact TypeScript this strategy was built from is readable below.',
			unmetDetail: 'The creator has not published source, so the build cannot be reproduced.',
		},
		{
			label: 'Binary hash recorded',
			met: verification.binaryHash !== null,
			metDetail: 'The compiled workflow was measured and registered on-chain.',
			unmetDetail: 'No workflow binary has been measured for this strategy yet.',
		},
		{
			label: `Runs in ${TEE_LABEL}`,
			met: verification.regions.length > 0,
			metDetail: `Executed by the Chainlink CRE confidential runtime in ${regions}.`,
			unmetDetail: 'No enclave region has been reported for this workflow yet.',
		},
		{
			label: 'Decisions signed inside the enclave',
			met: verification.lastAttestedAt !== null,
			metDetail: `Last attested run ${formatDateTime(verification.lastAttestedAt)}.`,
			unmetDetail: 'No attested run has been recorded, so the figures are not yet signed.',
		},
	]

	const complete = chain.every((link) => link.met)

	return (
		<section className={cn('rounded-sm border border-hairline bg-surface-1', className)}>
			<div className="flex items-start gap-2 border-b border-hairline px-4 py-3">
				<ShieldCheckIcon className={cn('mt-0.5 size-4 shrink-0', complete ? 'text-verified' : 'text-warning-light')} />
				<div>
					<h2 className="type-headline-sm text-fg">Verification</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						What a verifier can recompute for themselves. Every figure on this page comes from runs of
						the measured binary below.
					</p>
				</div>
			</div>

			<ol className="flex flex-col divide-y divide-hairline">
				{chain.map((link) => (
					<li key={link.label} className="flex items-start gap-3 px-4 py-3">
						<span
							className={cn(
								'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border',
								link.met
									? 'border-verified/50 bg-verified/15 text-verified'
									: 'border-warning/50 bg-warning/10 text-warning-light',
							)}
						>
							{link.met ? <CheckIcon className="size-2.5" /> : <AlertIcon className="size-2.5" />}
						</span>
						<div className="min-w-0">
							<p className={cn('type-body-md', link.met ? 'text-fg' : 'text-warning-light')}>
								{link.label}
							</p>
							<p className="mt-0.5 type-body-sm text-fg-secondary">
								{link.met ? link.metDetail : link.unmetDetail}
							</p>
						</div>
					</li>
				))}
			</ol>

			<div className="flex flex-col gap-3 border-t border-hairline p-4">
				<CopyRow label="Workflow id" value={verification.workflowId} />
				<CopyRow label="Binary hash (sha256)" value={verification.binaryHash} />
				<CopyRow label="Config hash" value={verification.configHash} />
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
				<p className="type-body-sm text-fg-muted">
					A verified strategy means this code produced these results. It is not a judgement that the
					strategy is sound.
				</p>
				{verification.sourceAvailable ? (
					<Link
						href={`/strategy/${slug}/source`}
						className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-hairline-strong bg-surface-2 px-3 type-body-sm text-fg transition-colors hover:bg-interact"
					>
						View source
						<ExternalIcon className="size-3" />
					</Link>
				) : (
					<span className="type-body-sm text-warning-light">Source not published</span>
				)}
			</div>
		</section>
	)
}
