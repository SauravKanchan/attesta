'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { EM_DASH } from '@/lib/format'

export interface CopyRowProps {
	label: string
	value: string | null
	className?: string
}

/** A hash is only a claim if the reader can lift it out and compare it themselves. */
export function CopyRow({ label, value, className }: CopyRowProps) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(timer)
	}, [copied])

	async function copy() {
		if (value === null) return
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
		} catch (error) {
			console.error('attesta: copying to the clipboard failed', error)
		}
	}

	return (
		<div className={cn('flex flex-col gap-1', className)}>
			<div className="flex items-center justify-between gap-2">
				<span className="type-label-caps text-fg-muted">{label}</span>
				{copied ? <span className="type-label-caps text-verified">Copied</span> : null}
			</div>
			{value === null ? (
				<span className="type-code-sm text-fg-muted">{EM_DASH} not recorded yet</span>
			) : (
				<button
					type="button"
					onClick={copy}
					title="Copy"
					className="recessed w-full break-all rounded-xs px-2 py-1.5 text-left type-code-sm text-fg-secondary transition-colors hover:text-fg"
				>
					{value}
				</button>
			)}
		</div>
	)
}
