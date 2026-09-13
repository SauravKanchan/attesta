'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { getHealth } from '@/lib/api'

/**
 * The region is fixed: every attesta workflow runs in AWS Nitro Enclaves in us-west-2.
 * The dot reports whether the backend that schedules those runs is answering.
 */
const REGION = 'us-west-2'

type Reachability = 'checking' | 'online' | 'offline'

export function EnclaveStatus({ className }: { className?: string }) {
	const [reachability, setReachability] = useState<Reachability>('checking')

	useEffect(() => {
		let cancelled = false
		getHealth()
			.then(() => {
				if (!cancelled) setReachability('online')
			})
			.catch((error: unknown) => {
				console.error('attesta: the health probe failed', error)
				if (!cancelled) setReachability('offline')
			})
		return () => {
			cancelled = true
		}
	}, [])

	const tone =
		reachability === 'online'
			? 'border-verified/40 bg-verified/10 text-verified'
			: reachability === 'offline'
			  ? 'border-risk/40 bg-risk/10 text-risk-light'
			  : 'border-hairline bg-interact text-fg-secondary'

	const dot =
		reachability === 'online' ? 'bg-verified pulse-dot' : reachability === 'offline' ? 'bg-risk' : 'bg-fg-muted'

	return (
		<span
			title={
				reachability === 'offline'
					? 'The attesta backend is not answering'
					: 'AWS Nitro Enclaves, us-west-2'
			}
			className={cn('inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 type-label-caps', tone, className)}
		>
			<span className={cn('size-1.5 rounded-xs', dot)} />
			Enclave {REGION}
		</span>
	)
}
