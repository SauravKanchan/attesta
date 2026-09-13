'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { ApiError } from '@/lib/api'

export interface ResourceState<T> {
	data: T | null
	error: ApiError | null
	/** True only while there is nothing to show; a refetch keeps the last data on screen. */
	loading: boolean
	refreshing: boolean
	reload: () => void
	/** Replaces the cached value, e.g. with the row an action just returned. */
	set: (next: T) => void
}

/**
 * Fetches on mount and whenever `deps` change, aborting the in-flight request first so a
 * slow earlier response can never overwrite a newer one. Failures are surfaced, never
 * swallowed: a caller renders the error rather than an empty success.
 */
export function useResource<T>(
	load: (signal: AbortSignal) => Promise<T>,
	deps: DependencyList,
	options: { enabled?: boolean } = {},
): ResourceState<T> {
	const { enabled = true } = options
	const [data, setData] = useState<T | null>(null)
	const [error, setError] = useState<ApiError | null>(null)
	const [pending, setPending] = useState(enabled)
	const [nonce, setNonce] = useState(0)

	// The loader is a fresh closure every render; only `deps` may retrigger the fetch.
	const loadRef = useRef(load)
	loadRef.current = load

	useEffect(() => {
		if (!enabled) {
			setPending(false)
			return
		}
		const controller = new AbortController()
		setPending(true)
		loadRef
			.current(controller.signal)
			.then((next) => {
				if (controller.signal.aborted) return
				setData(next)
				setError(null)
				setPending(false)
			})
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return
				console.error('attesta: a resource failed to load', cause)
				setError(
					cause instanceof ApiError
						? cause
						: new ApiError(0, 'unknown_error', cause instanceof Error ? cause.message : 'The request failed', cause),
				)
				setPending(false)
			})
		return () => controller.abort()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, nonce, ...deps])

	const reload = useCallback(() => setNonce((previous) => previous + 1), [])
	const set = useCallback((next: T) => {
		setData(next)
		setError(null)
	}, [])

	return {
		data,
		error,
		loading: pending && data === null,
		refreshing: pending && data !== null,
		reload,
		set,
	}
}
