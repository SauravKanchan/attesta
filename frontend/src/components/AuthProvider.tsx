'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ApiError, getMe, getToken, login, setToken } from '@/lib/api'
import type { User } from '@/lib/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
	status: AuthStatus
	user: User | null
	signIn: (username: string) => Promise<void>
	signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const SIGN_IN_PATH = '/login'

/**
 * Reachable without a session. The root is public because a signed-out visitor is
 * shown the marketing landing page there; a signed-in one gets the marketplace at
 * the same URL.
 */
const PUBLIC_PATHS = new Set([SIGN_IN_PATH, '/'])

export function AuthProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<AuthStatus>('loading')
	const [user, setUser] = useState<User | null>(null)
	const router = useRouter()
	const pathname = usePathname()

	useEffect(() => {
		let cancelled = false
		if (!getToken()) {
			setStatus('anonymous')
			return
		}
		getMe()
			.then((me) => {
				if (cancelled) return
				setUser(me)
				setStatus('authenticated')
			})
			.catch((error: unknown) => {
				console.error('attesta: restoring the session failed', error)
				if (cancelled) return
				// A rejected token is dead weight; anything else may be a backend that
				// is simply not up yet, and the sign-in screen says so either way.
				if (error instanceof ApiError && error.status === 401) setToken(null)
				setUser(null)
				setStatus('anonymous')
			})
		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		if (status === 'loading') return
		if (status === 'anonymous' && !PUBLIC_PATHS.has(pathname)) router.replace(SIGN_IN_PATH)
		if (status === 'authenticated' && pathname === SIGN_IN_PATH) router.replace('/')
	}, [status, pathname, router])

	const signIn = useCallback(
		async (username: string) => {
			const session = await login(username)
			setToken(session.token)
			setUser(session.user)
			setStatus('authenticated')
			router.replace('/')
		},
		[router],
	)

	const signOut = useCallback(() => {
		setToken(null)
		setUser(null)
		setStatus('anonymous')
		router.replace('/')
	}, [router])

	const value = useMemo(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut])

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext)
	if (context === null) throw new Error('useAuth must be used inside an AuthProvider')
	return context
}
