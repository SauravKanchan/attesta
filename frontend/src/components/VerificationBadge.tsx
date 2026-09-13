'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { EM_DASH, formatDateTime, truncateHash } from '@/lib/format'
import { CloseIcon, ShieldCheckIcon } from '@/components/ui/icons'
import { Tag } from '@/components/ui/Tag'
import type { StrategyVerification } from '@/lib/types'

/**
 * The signature motif of the product: the claim that a specific measured binary,
 * and nothing else, produced the numbers on the page. Clicking it opens the proof
 * so the claim is inspectable rather than decorative.
 */

const TEE_LABEL = 'AWS Nitro Enclaves'

export interface VerificationBadgeProps {
	verification: StrategyVerification
	/** `compact` drops the hash tag for dense rows such as a marketplace card. */
	size?: 'compact' | 'standard'
	className?: string
}

export function VerificationBadge({ verification, size = 'standard', className }: VerificationBadgeProps) {
	const [open, setOpen] = useState(false)
	const attested = verification.binaryHash !== null && verification.lastAttestedAt !== null

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				title={attested ? 'Inspect the attestation proof' : 'No attested run yet'}
				className={cn(
					'inline-flex w-fit items-center gap-2 rounded-sm border px-2 transition-colors',
					size === 'compact' ? 'h-6' : 'h-7',
					attested
						? 'border-verified/40 bg-verified/8 hover:bg-verified/15'
						: 'border-warning/40 bg-warning/8 hover:bg-warning/15',
					className,
				)}
			>
				<ShieldCheckIcon
					className={cn('size-3.5 shrink-0', attested ? 'text-verified' : 'text-warning-light')}
				/>
				<span className={cn('type-label-caps', attested ? 'text-verified' : 'text-warning-light')}>
					{attested ? 'Nitro enclave verified' : 'Awaiting attestation'}
				</span>
				{size === 'standard' && verification.binaryHash ? (
					<Tag recessed mono className="h-5">
						{truncateHash(verification.binaryHash)}
					</Tag>
				) : null}
			</button>
			<ProofDrawer open={open} onClose={() => setOpen(false)} verification={verification} />
		</>
	)
}

interface ProofDrawerProps {
	open: boolean
	onClose: () => void
	verification: StrategyVerification
}

function ProofDrawer({ open, onClose, verification }: ProofDrawerProps) {
	const attested = verification.binaryHash !== null && verification.lastAttestedAt !== null

	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [open, onClose])

	if (!open) return null

	const regions = verification.regions.length > 0 ? verification.regions.join(', ') : EM_DASH

	return (
		<div className="fixed inset-0 z-50 flex justify-end">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-canvas/80"
			/>
			<aside
				role="dialog"
				aria-modal="true"
				aria-label="Attestation proof"
				className="slide-in relative flex h-full w-full max-w-md flex-col border-l border-hairline-strong bg-surface-1"
			>
				<header className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
					<div className="flex items-start gap-2">
						<ShieldCheckIcon
							className={cn(
								'mt-0.5 size-4 shrink-0',
								attested ? 'text-verified' : 'text-warning-light',
							)}
						/>
						<div>
							<h2 className="type-headline-sm text-fg">Attestation proof</h2>
							<p className="mt-0.5 type-body-sm text-fg-secondary">
								What a verifier can recompute and check for themselves.
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
					>
						<CloseIcon className="size-3.5" />
					</button>
				</header>

				<div className="flex-1 overflow-y-auto p-4">
					<dl className="flex flex-col gap-3">
						<ProofRow label="Trusted execution environment" value={TEE_LABEL} />
						<ProofRow label="Regions" value={regions} mono />
						<ProofRow label="Last attested" value={formatDateTime(verification.lastAttestedAt)} mono />
						<HashRow label="Binary hash" value={verification.binaryHash} />
						<HashRow label="Config hash" value={verification.configHash} />
						<HashRow label="Workflow id" value={verification.workflowId} />
					</dl>

					<div className="mt-6 rounded-sm border border-hairline bg-surface-2 p-3">
						<p className="type-label-caps text-fg-muted">How to check it</p>
						<ol className="mt-2 flex list-inside list-decimal flex-col gap-1.5 type-body-sm text-fg-secondary">
							<li>Rebuild the published source and hash the resulting workflow binary.</li>
							<li>Compare that hash with the binary hash above and with the on-chain registration.</li>
							<li>
								Confirm the reported figures were signed inside the enclave for that same
								measurement.
							</li>
						</ol>
						<p className="mt-3 type-body-sm text-fg-muted">
							A verified strategy means this exact code produced these results. It is not a
							judgement that the strategy is sound.
						</p>
					</div>

					{verification.sourceAvailable ? null : (
						<p className="mt-4 type-body-sm text-warning-light">
							The creator has not published source for this strategy, so the measurement cannot be
							independently recomputed yet.
						</p>
					)}
				</div>
			</aside>
		</div>
	)
}

function ProofRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
	return (
		<div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
			<dt className="type-label-caps text-fg-muted">{label}</dt>
			<dd className={cn('text-right text-fg', mono ? 'type-code-md' : 'type-body-md')}>{value}</dd>
		</div>
	)
}

function HashRow({ label, value }: { label: string; value: string | null }) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(timer)
	}, [copied])

	async function copy() {
		if (!value) return
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
		} catch (error) {
			console.error('attesta: copying the hash to the clipboard failed', error)
		}
	}

	return (
		<div className="flex flex-col gap-1.5 border-b border-hairline pb-3">
			<dt className="type-label-caps text-fg-muted">{label}</dt>
			<dd>
				{value ? (
					<button
						type="button"
						onClick={copy}
						title="Copy"
						className="recessed block w-full break-all rounded-xs px-2 py-1.5 text-left type-code-sm text-fg-secondary transition-colors hover:text-fg"
					>
						{value}
						<span className="ml-2 type-label-caps text-verified">{copied ? 'Copied' : ''}</span>
					</button>
				) : (
					<span className="type-code-sm text-fg-muted">{EM_DASH}</span>
				)}
			</dd>
		</div>
	)
}
