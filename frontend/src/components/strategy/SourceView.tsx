'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getStrategy, getStrategySource } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { ChevronLeftIcon, ShieldCheckIcon } from '@/components/ui/icons'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tag } from '@/components/ui/Tag'
import { EM_DASH, truncateHash } from '@/lib/format'
import { CopyRow } from '@/components/strategy/CopyRow'
import { RequestError } from '@/components/strategy/RequestError'
import { SourceCode } from '@/components/strategy/SourceCode'
import { useResource } from '@/components/strategy/useResource'

/**
 * The source behind the hash. Without this page the binary hash is a number nobody can
 * check; with it, a reader can rebuild the workflow and compare the measurement.
 */
export function SourceView({ slug }: { slug: string }) {
	const detail = useResource(() => getStrategy(slug), [slug])
	const source = useResource(() => getStrategySource(slug), [slug])
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(timer)
	}, [copied])

	async function copyAll() {
		if (source.data === null) return
		try {
			await navigator.clipboard.writeText(source.data)
			setCopied(true)
		} catch (error) {
			console.error('attesta: copying the source to the clipboard failed', error)
		}
	}

	const verification = detail.data?.verification ?? null
	const lineCount = source.data === null ? null : source.data.split('\n').length

	return (
		<div className="flex flex-col gap-4">
			<Link
				href={`/strategy/${slug}`}
				className="inline-flex w-fit items-center gap-1 type-body-sm text-fg-secondary transition-colors hover:text-fg"
			>
				<ChevronLeftIcon className="size-3" />
				{detail.data?.name ?? slug}
			</Link>

			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="type-headline-lg text-fg">Published source</h1>
					<p className="mt-1 type-body-md text-fg-secondary">
						The TypeScript the workflow binary was built from. Rebuild it and the sha256 below must
						come out the same, or the listing is not what it claims.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{verification?.binaryHash ? (
						<Tag recessed mono title={verification.binaryHash} className="h-9">
							<ShieldCheckIcon className="size-3 text-verified" />
							{truncateHash(verification.binaryHash, 10, 8)}
						</Tag>
					) : null}
					<Button onClick={copyAll} disabled={source.data === null}>
						{copied ? 'Copied' : 'Copy source'}
					</Button>
				</div>
			</header>

			{verification === null ? null : (
				<section className="grid gap-3 rounded-sm border border-hairline bg-surface-1 p-4 sm:grid-cols-2">
					<CopyRow label="Binary hash (sha256)" value={verification.binaryHash} />
					<CopyRow label="Workflow id" value={verification.workflowId} />
				</section>
			)}

			<section className="rounded-sm border border-hairline bg-surface-1">
				<div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2">
					<span className="type-label-caps text-fg-muted">
						{detail.data === null ? slug : `${detail.data.ticker}.ts`}
					</span>
					<span className="type-code-sm text-fg-muted">
						{lineCount === null ? EM_DASH : `${lineCount} lines`}
					</span>
				</div>
				{source.loading ? (
					<div className="flex flex-col gap-2 p-4">
						{Array.from({ length: 14 }, (_, index) => (
							<Skeleton key={index} className="h-4" />
						))}
					</div>
				) : source.error !== null ? (
					<RequestError
						className="m-4"
						error={source.error}
						what="the strategy source"
						notFound="No published source came back for this strategy."
						onRetry={source.reload}
					/>
				) : source.data === null || source.data.trim() === '' ? (
					<p className="px-4 py-10 text-center type-body-md text-fg-muted">
						The published source is empty.
					</p>
				) : (
					<SourceCode source={source.data} className="py-2" />
				)}
			</section>
		</div>
	)
}
