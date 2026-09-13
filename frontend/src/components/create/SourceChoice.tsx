'use client'

import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { CheckIcon, CodeIcon, WalletIcon } from '@/components/ui/icons'

export type SourceMode = 'write' | 'upload'

/** The reference design's cap, and enough for any single-file strategy. */
const MAX_BYTES = 2 * 1024 * 1024
const ACCEPTED = ['.ts', '.js']

export interface SourceChoiceProps {
	mode: SourceMode
	onModeChange: (mode: SourceMode) => void
	/** Called with the file's text once it has been read in the browser. */
	onFileLoaded: (fileName: string, source: string) => void
	uploadedFileName: string | null
}

export function SourceChoice({ mode, onModeChange, onFileLoaded, uploadedFileName }: SourceChoiceProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function accept(file: File) {
		setError(null)
		const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
		if (!ACCEPTED.includes(extension)) {
			setError(`${file.name} is not a ${ACCEPTED.join(' or ')} file`)
			return
		}
		if (file.size > MAX_BYTES) {
			setError(`${file.name} is larger than 2MB`)
			return
		}
		try {
			const text = await file.text()
			onFileLoaded(file.name, text)
			onModeChange('upload')
		} catch (caught) {
			console.error('attesta: reading the uploaded strategy file failed', caught)
			setError('The file could not be read in this browser')
		}
	}

	function onInputChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]
		// Reset so re-picking the same file fires change again.
		event.target.value = ''
		if (file) void accept(file)
	}

	function onDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault()
		setDragging(false)
		const file = event.dataTransfer.files?.[0]
		if (file) void accept(file)
	}

	return (
		<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<button
				type="button"
				onClick={() => onModeChange('write')}
				aria-pressed={mode === 'write'}
				className={cn(
					'flex flex-col gap-3 rounded-sm border p-4 text-left transition-colors',
					mode === 'write'
						? 'border-verified bg-verified/8'
						: 'border-hairline bg-surface-1 hover:border-hairline-strong',
				)}
			>
				<span className="flex items-start gap-3">
					<span
						className={cn(
							'flex size-8 shrink-0 items-center justify-center rounded-sm border',
							mode === 'write'
								? 'border-verified/40 bg-verified/10 text-verified'
								: 'border-hairline bg-surface-2 text-fg-secondary',
						)}
					>
						<CodeIcon className="size-4" />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block type-headline-sm text-fg">Write in the browser</span>
						<span className="mt-0.5 block type-body-md text-fg-secondary">
							A TypeScript editor seeded from the strategy template, with the required interface
							checked as you type.
						</span>
					</span>
					{mode === 'write' ? <CheckIcon className="size-4 shrink-0 text-verified" /> : null}
				</span>
				<span className="flex items-center gap-2 border-t border-hairline pt-3 type-label-caps text-fg-muted">
					<span className={cn('size-1.5 rounded-xs', mode === 'write' ? 'bg-verified pulse-dot' : 'bg-fg-muted')} />
					{mode === 'write' ? 'Active workspace' : 'Switch to the editor'}
				</span>
			</button>

			<div
				onDragOver={(event) => {
					event.preventDefault()
					setDragging(true)
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={cn(
					'flex flex-col gap-3 rounded-sm border border-dashed p-4 transition-colors',
					mode === 'upload' ? 'border-verified bg-verified/8' : 'border-hairline-strong bg-surface-1',
					dragging && 'border-telemetry-hover bg-telemetry/8',
				)}
			>
				<div className="flex items-start gap-3">
					<span
						className={cn(
							'flex size-8 shrink-0 items-center justify-center rounded-sm border',
							mode === 'upload'
								? 'border-verified/40 bg-verified/10 text-verified'
								: 'border-hairline bg-surface-2 text-fg-secondary',
						)}
					>
						<WalletIcon className="size-4" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="type-headline-sm text-fg">Upload a .ts file</p>
						<p className="mt-0.5 type-body-md text-fg-secondary">
							Drop your strategy here, or browse. It loads straight into the editor, so you can
							still change it before publishing.
						</p>
					</div>
					<Button size="compact" onClick={() => inputRef.current?.click()}>
						Browse files
					</Button>
					<input
						ref={inputRef}
						type="file"
						accept={ACCEPTED.join(',')}
						onChange={onInputChange}
						className="hidden"
					/>
				</div>
				<p className="border-t border-hairline pt-3 type-label-caps text-fg-muted">
					{error !== null ? (
						<span className="text-risk-light">{error}</span>
					) : uploadedFileName !== null ? (
						<span className="text-verified">Loaded {uploadedFileName}</span>
					) : (
						<span>Supports .ts and .js modules up to 2MB</span>
					)}
				</p>
			</div>
		</div>
	)
}
