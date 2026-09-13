'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import type { CursorPosition } from '@/components/create/CodeMirrorEditor'

/**
 * CodeMirror is deferred: it is the heaviest dependency in the app and only the create
 * flow needs it, so the marketplace and portfolio never pay for it. `ssr: false` because
 * the editor is a DOM widget with no server rendering to speak of.
 */
const CodeMirrorEditor = dynamic(() => import('@/components/create/CodeMirrorEditor'), {
	ssr: false,
	loading: () => (
		<div className="flex h-full flex-col gap-2 p-4">
			<Skeleton className="h-3 w-1/2" />
			<Skeleton className="h-3 w-2/3" />
			<Skeleton className="h-3 w-1/3" />
			<Skeleton className="h-3 w-3/5" />
			<p className="mt-2 type-label-caps text-fg-muted">Loading editor</p>
		</div>
	),
})

export interface CodeEditorProps {
	value: string
	onChange: (next: string) => void
	fileName?: string
	onReset?: () => void
	resetDisabled?: boolean
	className?: string
}

export function CodeEditor({
	value,
	onChange,
	fileName = 'strategy.ts',
	onReset,
	resetDisabled = false,
	className,
}: CodeEditorProps) {
	const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })
	const lineCount = value.length === 0 ? 0 : value.split('\n').length

	return (
		<div className={cn('flex min-h-0 flex-col overflow-hidden rounded-sm border border-hairline bg-surface-1', className)}>
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface-2 px-3 py-2">
				<span className="flex items-center gap-2">
					<span className="type-label-caps text-telemetry-hover">TS</span>
					<span className="type-code-md text-fg">{fileName}</span>
				</span>
				{onReset ? (
					<Button size="compact" onClick={onReset} disabled={resetDisabled}>
						Reset to template
					</Button>
				) : null}
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				<CodeMirrorEditor value={value} onChange={onChange} onCursorChange={setCursor} />
			</div>

			<div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-surface-2 px-3 py-1.5">
				<span className="flex items-center gap-3 type-label-caps text-fg-muted">
					<span className="text-verified">TypeScript</span>
					<span>UTF-8</span>
					<span>{lineCount} lines</span>
				</span>
				<span className="type-label-caps text-fg-muted">
					Ln {cursor.line}, Col {cursor.column}
				</span>
			</div>
		</div>
	)
}
