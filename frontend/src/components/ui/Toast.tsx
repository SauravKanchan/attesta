'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { AlertIcon, CheckIcon, CloseIcon } from '@/components/ui/icons'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
	id: string
	tone: ToastTone
	title: string
	description?: string
}

export interface ToastInput {
	tone?: ToastTone
	title: string
	description?: string
	/** Milliseconds before the toast dismisses itself. */
	duration?: number
}

interface ToastContextValue {
	toast: (input: ToastInput) => void
	dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE: Record<ToastTone, { accent: string; icon: ReactNode }> = {
	success: { accent: 'border-l-verified', icon: <CheckIcon className="size-3.5 text-verified" /> },
	error: { accent: 'border-l-risk', icon: <AlertIcon className="size-3.5 text-risk-light" /> },
	info: { accent: 'border-l-telemetry', icon: <AlertIcon className="size-3.5 text-telemetry-hover" /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([])
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

	const dismiss = useCallback((id: string) => {
		setToasts((current) => current.filter((entry) => entry.id !== id))
		const timer = timers.current.get(id)
		if (timer) {
			clearTimeout(timer)
			timers.current.delete(id)
		}
	}, [])

	const toast = useCallback(
		({ tone = 'info', title, description, duration = 5000 }: ToastInput) => {
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			setToasts((current) => [...current, { id, tone, title, description }])
			timers.current.set(
				id,
				setTimeout(() => dismiss(id), duration),
			)
		},
		[dismiss],
	)

	useEffect(() => {
		const pending = timers.current
		return () => {
			for (const timer of pending.values()) clearTimeout(timer)
			pending.clear()
		}
	}, [])

	const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

	return (
		<ToastContext.Provider value={value}>
			{children}
			<div
				aria-live="polite"
				className="pointer-events-none fixed bottom-4 right-4 z-60 flex w-80 flex-col gap-2"
			>
				{toasts.map((entry) => (
					<div
						key={entry.id}
						className={cn(
							'slide-in pointer-events-auto flex items-start gap-2 rounded-sm border border-hairline',
							'border-l-2 bg-surface-2 px-3 py-2.5',
							TONE[entry.tone].accent,
						)}
					>
						<span className="mt-0.5 shrink-0">{TONE[entry.tone].icon}</span>
						<div className="min-w-0 flex-1">
							<p className="type-headline-sm text-fg">{entry.title}</p>
							{entry.description ? (
								<p className="mt-0.5 break-words type-body-sm text-fg-secondary">
									{entry.description}
								</p>
							) : null}
						</div>
						<button
							type="button"
							aria-label="Dismiss"
							onClick={() => dismiss(entry.id)}
							className="shrink-0 text-fg-muted transition-colors hover:text-fg"
						>
							<CloseIcon className="size-3" />
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	)
}

export function useToast(): ToastContextValue {
	const context = useContext(ToastContext)
	if (context === null) throw new Error('useToast must be used inside a ToastProvider')
	return context
}
