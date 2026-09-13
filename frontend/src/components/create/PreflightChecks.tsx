'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { Tag } from '@/components/ui/Tag'
import { AlertIcon, CheckIcon, ChevronDownIcon } from '@/components/ui/icons'
import { CHECK_RATIONALE } from '@/components/create/checks'
import type { SanityCheck } from '@/lib/types'

export interface PreflightChecksProps {
	checks: readonly SanityCheck[]
	/** True while the stream is open, so a `pending` row reads as queued not stalled. */
	streaming: boolean
}

export function PreflightChecks({ checks, streaming }: PreflightChecksProps) {
	const passed = checks.filter((check) => check.status === 'passed').length
	const failed = checks.some((check) => check.status === 'failed')
	// The two slow checks are the last two rows, which on a laptop sit below the fold.
	// Naming the running one in the header is what keeps a minute of `cre workflow build`
	// from reading as a stalled screen.
	const running = checks.find((check) => check.status === 'running') ?? null

	return (
		<div className="flex flex-col rounded-sm border border-hairline bg-surface-1">
			<div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
				<div>
					<h2 className="type-headline-sm text-fg">Pre-flight checks</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						Run in order against your source. A failure stops the rest, so a queued row means the
						pipeline never reached it.
					</p>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1">
					<Tag
						mono
						className="whitespace-nowrap"
						tone={failed ? 'risk' : passed === checks.length && checks.length > 0 ? 'verified' : 'neutral'}
					>
						{passed} / {checks.length} passed
					</Tag>
					{running === null ? null : (
						<span className="flex items-center gap-1.5 type-body-sm text-fg-muted">
							<span className="size-1.5 rounded-xs bg-telemetry-hover pulse-dot" aria-hidden="true" />
							{running.label}
						</span>
					)}
				</div>
			</div>
			<ul className="flex flex-col divide-y divide-hairline">
				{checks.map((check) => (
					<CheckRow key={check.id} check={check} streaming={streaming} />
				))}
			</ul>
		</div>
	)
}

function CheckRow({ check, streaming }: { check: SanityCheck; streaming: boolean }) {
	const [expanded, setExpanded] = useState(check.status === 'failed')
	const expandable = check.detail !== null && check.detail !== ''

	// A failure's detail is the reason the creator is here, so it opens by itself —
	// including when the row fails mid-stream, having mounted as pending.
	const failed = check.status === 'failed'
	useEffect(() => {
		if (failed) setExpanded(true)
	}, [failed])

	return (
		<li className="flex flex-col" data-check={check.id} data-status={check.status}>
			<div className="flex items-start gap-3 px-4 py-2.5">
				<StatusGlyph status={check.status} streaming={streaming} />
				<div className="min-w-0 flex-1">
					<p
						className={cn(
							'type-body-md',
							check.status === 'failed'
								? 'text-risk-light'
								: check.status === 'pending'
								  ? 'text-fg-muted'
								  : 'text-fg',
						)}
					>
						{check.label}
					</p>
					<p className="type-body-sm text-fg-muted">{CHECK_RATIONALE[check.id]}</p>
				</div>
				{expandable ? (
					<button
						type="button"
						onClick={() => setExpanded((previous) => !previous)}
						aria-expanded={expanded}
						className="flex shrink-0 items-center gap-1 type-label-caps text-fg-secondary transition-colors hover:text-fg"
					>
						{expanded ? 'Hide' : 'Detail'}
						<ChevronDownIcon className={cn('size-3', expanded && 'rotate-180')} />
					</button>
				) : null}
			</div>
			{expandable && expanded ? (
				<pre
					className={cn(
						'mx-4 mb-3 overflow-x-auto whitespace-pre-wrap break-words rounded-sm border px-3 py-2.5 type-code-sm',
						check.status === 'failed'
							? 'border-risk/40 bg-risk/8 text-risk-light'
							: 'recessed text-fg-secondary',
					)}
				>
					{check.detail}
				</pre>
			) : null}
		</li>
	)
}

function StatusGlyph({ status, streaming }: { status: SanityCheck['status']; streaming: boolean }) {
	if (status === 'passed') {
		return (
			<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border border-verified/40 bg-verified/10">
				<CheckIcon className="size-2.5 text-verified" />
			</span>
		)
	}
	if (status === 'failed') {
		return (
			<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border border-risk/50 bg-risk/10">
				<AlertIcon className="size-2.5 text-risk-light" />
			</span>
		)
	}
	if (status === 'running') {
		return (
			<svg className="mt-0.5 size-4 shrink-0 animate-spin text-telemetry-hover" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
				<path d="M14 8A6 6 0 0 0 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			</svg>
		)
	}
	return (
		<span
			className={cn(
				'mt-0.5 size-4 shrink-0 rounded-xs border border-hairline-strong',
				streaming && 'pulse-dot',
			)}
			aria-hidden="true"
		/>
	)
}
