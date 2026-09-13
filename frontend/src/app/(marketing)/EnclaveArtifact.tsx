'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { listStrategies } from '@/lib/api'
import { CopyableHash } from '@/components/ui/CopyableHash'
import { ShieldCheckIcon } from '@/components/ui/icons'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * The one artefact on the landing page, and the only place it could honestly come
 * from: the measurement of a strategy that is actually live. Nothing here is typed
 * in by hand — if no strategy has been attested yet the line says so rather than
 * inventing a hash.
 */

/** Documented fallback: every attesta workflow runs in AWS Nitro Enclaves in us-west-2. */
const DEFAULT_REGION = 'us-west-2'

interface Artifact {
	binaryHash: string | null
	region: string
}

type LoadState = 'loading' | 'loaded' | 'unavailable'

export function EnclaveArtifact({ className }: { className?: string }) {
	const [state, setState] = useState<LoadState>('loading')
	const [artifact, setArtifact] = useState<Artifact | null>(null)

	useEffect(() => {
		let cancelled = false
		listStrategies({ status: 'live', sort: 'newest', limit: 1 })
			.then((response) => {
				if (cancelled) return
				const strategy = response.strategies[0]
				setArtifact({
					binaryHash: strategy?.verification.binaryHash ?? null,
					region: strategy?.verification.regions[0] ?? DEFAULT_REGION,
				})
				setState('loaded')
			})
			.catch((error: unknown) => {
				// A landing page must render for a visitor with no session, so a rejected
				// read is expected rather than exceptional. It costs the hash, not the line.
				console.error('attesta: could not read the latest attested build', error)
				if (cancelled) return
				setState('unavailable')
			})
		return () => {
			cancelled = true
		}
	}, [])

	const region = artifact?.region ?? DEFAULT_REGION

	return (
		<div
			className={cn(
				'inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1',
				'rounded-sm border border-hairline bg-surface-1 px-3 py-1.5',
				className,
			)}
		>
			<ShieldCheckIcon className="size-3.5 shrink-0 text-verified" />
			<span className="type-code-md whitespace-nowrap text-fg-secondary">AWS Nitro Enclave</span>
			<Separator />
			<span className="type-code-md whitespace-nowrap text-fg-secondary">{region}</span>
			<Separator />
			{state === 'loading' ? (
				<Skeleton className="h-3.5 w-44" />
			) : artifact?.binaryHash ? (
				<CopyableHash value={artifact.binaryHash} prefix="sha256:" label="binary hash" size="md" />
			) : (
				<span className="type-code-md whitespace-nowrap text-fg-muted">no attested build yet</span>
			)}
			<span
				className={cn(
					'ml-1 size-1.5 shrink-0 rounded-xs',
					state === 'unavailable' ? 'bg-fg-muted' : 'bg-verified pulse-dot',
				)}
				aria-hidden="true"
			/>
		</div>
	)
}

function Separator() {
	return (
		<span className="type-code-md shrink-0 text-fg-muted" aria-hidden="true">
			·
		</span>
	)
}
