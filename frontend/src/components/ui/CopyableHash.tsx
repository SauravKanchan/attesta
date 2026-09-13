'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { CopyIcon } from '@/components/ui/icons'
import { EM_DASH, truncateHash } from '@/lib/format'

/**
 * A hash a reader can actually take away. Truncated by default so it fits a row,
 * copyable in full, and never silently truncated to something ambiguous — the
 * whole value stays on the title attribute.
 */

export interface CopyableHashProps {
	value: string | null | undefined
	/** Renders the whole value, wrapped, for a proof panel rather than a row. */
	full?: boolean
	lead?: number
	tail?: number
	/** A mono prefix rendered before the value, e.g. `sha256:`. */
	prefix?: string
	size?: 'sm' | 'md'
	/** Sinks it below its surface — the treatment for read-only artefacts. */
	recessed?: boolean
	/** Names the value for assistive tech, e.g. "binary hash". */
	label?: string
	className?: string
}

export function CopyableHash({
	value,
	full = false,
	lead = 10,
	tail = 8,
	prefix,
	size = 'sm',
	recessed = false,
	label = 'hash',
	className,
}: CopyableHashProps) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(timer)
	}, [copied])

	if (!value) {
		return (
			<span className={cn(size === 'sm' ? 'type-code-sm' : 'type-code-md', 'text-fg-muted', className)}>
				{EM_DASH}
			</span>
		)
	}

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
		<button
			type="button"
			onClick={copy}
			title={value}
			aria-label={copied ? `Copied the ${label}` : `Copy the ${label}`}
			className={cn(
				'group inline-flex max-w-full items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-left transition-colors',
				size === 'sm' ? 'type-code-sm' : 'type-code-md',
				recessed ? 'recessed' : 'border border-transparent hover:bg-interact',
				copied ? 'text-verified' : 'text-fg-secondary hover:text-fg',
				className,
			)}
		>
			{prefix ? <span className="shrink-0 text-fg-muted">{prefix}</span> : null}
			<span className={cn('min-w-0', full ? 'break-all' : 'truncate')}>
				{full ? value : truncateHash(value, lead, tail)}
			</span>
			<span className="shrink-0 text-fg-muted transition-colors group-hover:text-fg-secondary">
				{copied ? <span className="type-label-caps text-verified">Copied</span> : <CopyIcon className="size-3" />}
			</span>
		</button>
	)
}
