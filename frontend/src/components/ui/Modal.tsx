'use client'

import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CloseIcon } from '@/components/ui/icons'

export interface ModalProps {
	open: boolean
	onClose: () => void
	title: string
	description?: ReactNode
	children?: ReactNode
	footer?: ReactNode
	/** `wide` suits code and log output; the default suits a form. */
	size?: 'default' | 'wide'
}

export function Modal({ open, onClose, title, description, children, footer, size = 'default' }: ModalProps) {
	const titleId = useId()

	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.body.style.overflow = previousOverflow
		}
	}, [open, onClose])

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-canvas/80"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className={cn(
					'relative flex max-h-[85vh] w-full flex-col rounded-sm border border-hairline-strong',
					'bg-surface-2 shadow-modal',
					size === 'wide' ? 'max-w-3xl' : 'max-w-md',
				)}
			>
				<div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
					<div className="min-w-0">
						<h2 id={titleId} className="type-headline-sm text-fg">
							{title}
						</h2>
						{description ? <p className="mt-0.5 type-body-sm text-fg-secondary">{description}</p> : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
					>
						<CloseIcon className="size-3.5" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
				{footer ? (
					<div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	)
}
