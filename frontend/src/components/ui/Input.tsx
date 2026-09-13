'use client'

import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const FIELD = [
	'w-full rounded-sm border border-hairline bg-surface-2 text-fg type-body-md',
	'placeholder:text-fg-muted transition-colors',
	'hover:border-hairline-strong focus:border-telemetry-hover focus:outline-none',
	'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label?: string
	hint?: string
	error?: string | null
	/** Sits inside the field on the left, e.g. a search glyph or a currency mark. */
	leading?: ReactNode
	trailing?: ReactNode
	/** Numeric fields switch to JetBrains Mono with tabular figures. */
	mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{ label, hint, error, leading, trailing, mono, className, id, ...rest },
	ref,
) {
	const generatedId = useId()
	const inputId = id ?? generatedId
	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<label htmlFor={inputId} className="type-label-caps text-fg-secondary">
					{label}
				</label>
			) : null}
			<div className="relative flex items-center">
				{leading ? (
					<span className="pointer-events-none absolute left-3 flex text-fg-muted">{leading}</span>
				) : null}
				<input
					ref={ref}
					id={inputId}
					aria-invalid={error ? true : undefined}
					className={cn(
						FIELD,
						'h-9',
						leading ? 'pl-9' : 'pl-3',
						trailing ? 'pr-9' : 'pr-3',
						mono && 'num',
						error && 'border-risk focus:border-risk-light',
						className,
					)}
					{...rest}
				/>
				{trailing ? (
					<span className="pointer-events-none absolute right-3 flex text-fg-muted">{trailing}</span>
				) : null}
			</div>
			{error ? (
				<p className="type-body-sm text-risk-light">{error}</p>
			) : hint ? (
				<p className="type-body-sm text-fg-muted">{hint}</p>
			) : null}
		</div>
	)
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	label?: string
	hint?: string
	error?: string | null
	mono?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
	{ label, hint, error, mono, className, id, ...rest },
	ref,
) {
	const generatedId = useId()
	const textareaId = id ?? generatedId
	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<label htmlFor={textareaId} className="type-label-caps text-fg-secondary">
					{label}
				</label>
			) : null}
			<textarea
				ref={ref}
				id={textareaId}
				aria-invalid={error ? true : undefined}
				className={cn(
					FIELD,
					'resize-y px-3 py-2',
					mono && 'type-code-md',
					error && 'border-risk focus:border-risk-light',
					className,
				)}
				{...rest}
			/>
			{error ? (
				<p className="type-body-sm text-risk-light">{error}</p>
			) : hint ? (
				<p className="type-body-sm text-fg-muted">{hint}</p>
			) : null}
		</div>
	)
})
