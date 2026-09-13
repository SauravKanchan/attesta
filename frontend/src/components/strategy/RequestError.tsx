'use client'

import { API_BASE_URL, ApiError } from '@/lib/api'
import { AlertIcon } from '@/components/ui/icons'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export interface RequestErrorProps {
	error: ApiError
	/** What could not be loaded, e.g. "the strategy list". */
	what: string
	/** Overrides the 404 copy where a miss means "no such record" rather than "no such route". */
	notFound?: string
	onRetry?: () => void
	className?: string
}

/**
 * Says what actually failed. A missing endpoint and an unreachable backend are
 * different problems and the page is worth nothing if it papers over either with a
 * plausible-looking number.
 */
export function RequestError({ error, what, notFound, onRetry, className }: RequestErrorProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center gap-3 rounded-sm border border-dashed border-risk/40 bg-risk/5 px-6 py-12 text-center',
				className,
			)}
		>
			<span className="flex size-9 items-center justify-center rounded-sm border border-risk/40 bg-surface-2 text-risk-light">
				<AlertIcon className="size-4" />
			</span>
			<div className="max-w-lg">
				<p className="type-headline-sm text-fg">Could not load {what}</p>
				<p className="mt-1 type-body-md text-fg-secondary">{describe(error, notFound)}</p>
				<p className="mt-2 type-code-sm text-fg-muted">
					{error.status === 0 ? API_BASE_URL : `HTTP ${error.status} · ${error.code}`}
				</p>
			</div>
			{onRetry ? (
				<Button size="compact" onClick={onRetry}>
					Retry
				</Button>
			) : null}
		</div>
	)
}

function describe(error: ApiError, notFound?: string): string {
	if (error.status === 0) return `The attesta backend is not answering at ${API_BASE_URL}.`
	if (error.status === 404) {
		return notFound ?? 'The backend does not serve this endpoint yet, so there is nothing to show.'
	}
	if (error.status === 401) return 'This session is not authorised. Sign in again.'
	return error.message
}
