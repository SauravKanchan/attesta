'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
	PrivyProvider,
	getEmbeddedConnectedWallet,
	useCreateWallet,
	usePrivy,
	useWallets,
} from '@privy-io/react-auth'
import type { ConnectedWallet } from '@privy-io/react-auth'
import {
	ApiError,
	getMe,
	getToken,
	requestFaucet,
	requestLoginChallenge,
	setToken,
	verifyLoginSignature,
} from '@/lib/api'
import { bootstrapChain } from '@/lib/chain'
import {
	clear as clearWallet,
	getSigner,
	signInWithPrivateKey,
	signInWithPrivy,
	storedSignerKind,
} from '@/lib/wallet'
import type { Signer } from '@/lib/wallet'
import type { User } from '@/lib/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
	status: AuthStatus
	user: User | null
	/**
	 * Takes a private key because one of the two signers is a pasted key. The key is
	 * installed in `lib/wallet` and never sent anywhere: what crosses the wire is the
	 * address, and a signature over the nonce the server issues for it. The Privy path
	 * below produces the same signature from an embedded wallet.
	 */
	signIn: (privateKey: string) => Promise<void>
	/**
	 * Opens Privy's login modal and, once an embedded wallet exists, runs the same
	 * challenge/verify exchange with it. Resolves as soon as the modal is open — the rest
	 * happens as Privy's state settles, and `privySigningIn` reports it.
	 */
	signInWithPrivyWallet: () => void
	/** False when this build has no `NEXT_PUBLIC_PRIVY_APP_ID`, so the button is hidden. */
	privyAvailable: boolean
	/** True from the click until the session lands or fails. */
	privySigningIn: boolean
	privyError: string | null
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

/* ── Privy, mounted above everything ─────────────────────── */

/**
 * Privy's own state, flattened to what the auth flow needs. The default is what a build
 * with no app ID sees: `useContext` never throws, so nothing below has to know whether the
 * provider is mounted.
 */
interface PrivySession {
	available: boolean
	ready: boolean
	authenticated: boolean
	wallet: ConnectedWallet | null
	login: () => void
	logout: () => Promise<void>
	/**
	 * Asks Privy outright for an embedded wallet. `createOnLogin: 'users-without-wallets'`
	 * only *prompts* for one, and skips even the prompt for an account that already has a
	 * wallet linked — so a sign-in can complete with `useWallets()` permanently empty and
	 * nothing left to wait for.
	 */
	createWallet: () => Promise<unknown>
}

const UNAVAILABLE: PrivySession = {
	available: false,
	ready: false,
	authenticated: false,
	wallet: null,
	login: () => {
		console.error('attesta: a Privy sign-in was requested but no app ID is configured')
	},
	logout: () => Promise.resolve(),
	createWallet: () => Promise.resolve(),
}

const PrivySessionContext = createContext<PrivySession>(UNAVAILABLE)

/**
 * Only rendered inside `PrivyProvider`, so its hooks are always in scope. Hooks cannot be
 * called conditionally, which is why the unconfigured case is a separate branch above
 * rather than a flag inside this component.
 */
function PrivySessionBridge({ children }: { children: ReactNode }) {
	const { ready, authenticated, login, logout } = usePrivy()
	const { wallets, ready: walletsReady } = useWallets()
	const { createWallet } = useCreateWallet()

	const wallet = useMemo(() => getEmbeddedConnectedWallet(wallets) ?? wallets[0] ?? null, [wallets])

	const value = useMemo<PrivySession>(
		() => ({
			available: true,
			ready: ready && walletsReady,
			authenticated,
			wallet,
			login: () => login(),
			logout,
			createWallet: () => createWallet(),
		}),
		[ready, walletsReady, authenticated, wallet, login, logout, createWallet],
	)

	return <PrivySessionContext.Provider value={value}>{children}</PrivySessionContext.Provider>
}

/**
 * Mounts Privy above `AuthProvider`, which is where `useWallets` has to be in scope.
 *
 * The chain comes from env rather than from `GET /api/chain/config`: Privy wants
 * `supportedChains` and `defaultChain` synchronously at mount, and the embedded wallet
 * refuses to switch to a chain outside that list. Contract addresses still come only from
 * the fetched config — an anvil redeploy moves them, and env would go stale.
 */
export function PrivyWalletProvider({ children }: { children: ReactNode }) {
	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
	const chain = useMemo(() => bootstrapChain(), [])

	if (appId === undefined || appId === '') {
		console.warn('attesta: NEXT_PUBLIC_PRIVY_APP_ID is unset; only the pasted-key sign-in is offered')
		return <>{children}</>
	}

	return (
		<PrivyProvider
			appId={appId}
			config={{
				loginMethods: ['email', 'google'],
				embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
				supportedChains: [chain],
				defaultChain: chain,
				appearance: { theme: 'dark' },
			}}
		>
			<PrivySessionBridge>{children}</PrivySessionBridge>
		</PrivyProvider>
	)
}

/* ── The session ─────────────────────────────────────────── */

/** 'awaiting' spans the login modal and the wallet provisioning that follows it. */
type PrivyPhase = 'idle' | 'awaiting' | 'signing'

/** Long enough for a code-by-email round trip, short enough that a dead flow gives up. */
const PRIVY_TIMEOUT_MS = 180_000

export function AuthProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<AuthStatus>('loading')
	const [user, setUser] = useState<User | null>(null)
	const [privyPhase, setPrivyPhase] = useState<PrivyPhase>('idle')
	const [privyError, setPrivyError] = useState<string | null>(null)
	const router = useRouter()
	const pathname = usePathname()
	const privy = useContext(PrivySessionContext)
	/** True when the user clicked the button, false when a reload is restoring a session. */
	const interactive = useRef(false)
	/** Guards against asking Privy for a second wallet while the first is being made. */
	const requestedWallet = useRef(false)

	useEffect(() => {
		let cancelled = false
		if (!getToken()) {
			setStatus('anonymous')
			return
		}

		// A session whose key this browser no longer holds can read but cannot sign, and
		// every money action would fail at the last step. Treat it as signed out.
		const signer = getSigner()
		if (signer === null) {
			if (storedSignerKind() === 'privy') {
				// The embedded wallet is not in hand until Privy has booted, so hold the
				// 'loading' status and let the effect below finish the restore.
				interactive.current = false
				setPrivyPhase('awaiting')
				return
			}
			console.warn('attesta: a session token survived without its wallet key; signing out')
			setToken(null)
			setStatus('anonymous')
			return
		}

		getMe()
			.then((me) => {
				if (cancelled) return
				if (me.walletAddress.toLowerCase() !== signer.address.toLowerCase()) {
					console.warn('attesta: the stored wallet signs for a different address than the session', {
						session: me.walletAddress,
						wallet: signer.address,
					})
					setToken(null)
					clearWallet()
					setUser(null)
					setStatus('anonymous')
					return
				}
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

	/** The half of sign-in that is identical for both signers. */
	const proveAddress = useCallback(async (signer: Signer) => {
		const challenge = await requestLoginChallenge(signer.address)
		// The server's message is multi-line and domain-bound; signing anything
		// reconstructed here recovers to a different address.
		const signature = await signer.signMessage(challenge.message)
		// Echo back the address as the server checksummed it, not as it was sent.
		return verifyLoginSignature(challenge.address, signature)
	}, [])

	const signIn = useCallback(
		async (privateKey: string) => {
			const signer = signInWithPrivateKey(privateKey)
			try {
				const session = await proveAddress(signer)
				setToken(session.token)
				setUser(session.user)
				setStatus('authenticated')
				router.replace('/')
			} catch (error) {
				console.error('attesta: proving control of the address failed', error)
				clearWallet()
				throw error
			}
		},
		[router, proveAddress],
	)

	const signInWithPrivyWallet = useCallback(() => {
		if (!privy.available) {
			setPrivyError('This build has no Privy app ID configured.')
			return
		}
		interactive.current = true
		setPrivyError(null)
		setPrivyPhase('awaiting')
		if (!privy.authenticated) privy.login()
	}, [privy])

	/**
	 * Finishes a Privy sign-in once an embedded wallet exists — on the click path and on
	 * the reload path alike, because both end in the same place: a wallet that can sign.
	 */
	useEffect(() => {
		if (privyPhase !== 'awaiting') return
		if (!privy.available || !privy.ready) return

		if (!privy.authenticated) {
			// On the click path the modal is open and the user has not finished yet. On
			// the reload path Privy holds no session, so neither do we.
			if (!interactive.current) {
				setToken(null)
				clearWallet()
				setPrivyPhase('idle')
				setUser(null)
				setStatus('anonymous')
			}
			return
		}

		// Authenticated but no wallet yet. Privy may be mid-provisioning, or it may never
		// provision at all: 'users-without-wallets' skips creation entirely for an account
		// that already has a wallet linked, which leaves this waiting forever. Ask once,
		// and let the next render pick up the wallet it returns.
		const wallet = privy.wallet
		if (wallet === null) {
			if (!requestedWallet.current) {
				requestedWallet.current = true
				void privy.createWallet().catch((error: unknown) => {
					// Already having one is the benign case — the wallets list will catch up.
					console.error('attesta: could not create the Privy embedded wallet', error)
				})
			}
			return
		}

		let cancelled = false
		const wasInteractive = interactive.current
		setPrivyPhase('signing')

		void (async () => {
			try {
				const signer = signInWithPrivy(wallet)
				const session = await proveAddress(signer)
				if (cancelled) return
				setToken(session.token)
				setUser(session.user)
				setStatus('authenticated')
				setPrivyPhase('idle')
				requestedWallet.current = false

				if (wasInteractive) {
					// A fresh embedded wallet holds no ETH, so its first approve would fail
					// on gas and read like a contract bug. The faucet tops up gas and mints
					// USDC in one call; a failure here is not fatal, the portfolio page
					// offers the same button.
					try {
						await requestFaucet()
					} catch (error) {
						console.error('attesta: could not fund the new embedded wallet', error)
					}
					router.replace('/')
				}
			} catch (error) {
				console.error('attesta: proving control of the Privy wallet failed', error)
				if (cancelled) return
				clearWallet()
				setToken(null)
				setUser(null)
				setStatus('anonymous')
				setPrivyPhase('idle')
				requestedWallet.current = false
				setPrivyError(error instanceof Error ? error.message : 'Privy sign-in failed')
			}
		})()

		return () => {
			cancelled = true
		}
	}, [privyPhase, privy, proveAddress, router])

	/** A modal the user closed leaves 'awaiting' hanging; this is the way out of it. */
	useEffect(() => {
		if (privyPhase !== 'awaiting') return
		const timer = window.setTimeout(() => {
			console.error('attesta: the Privy sign-in never produced a wallet', {
				ready: privy.ready,
				authenticated: privy.authenticated,
			})
			setPrivyPhase('idle')
			setPrivyError('Privy did not finish signing in. Try again, or use a private key.')
			setStatus((current) => (current === 'loading' ? 'anonymous' : current))
		}, PRIVY_TIMEOUT_MS)
		return () => window.clearTimeout(timer)
	}, [privyPhase, privy.ready, privy.authenticated])

	const signOut = useCallback(() => {
		const kind = storedSignerKind()
		clearWallet()
		setToken(null)
		setUser(null)
		setStatus('anonymous')
		setPrivyPhase('idle')
		setPrivyError(null)
		interactive.current = false
		if (kind === 'privy' && privy.available) {
			privy.logout().catch((error: unknown) => {
				console.error('attesta: signing out of Privy failed', error)
			})
		}
		router.replace('/')
	}, [router, privy])

	const value = useMemo(
		() => ({
			status,
			user,
			signIn,
			signInWithPrivyWallet,
			privyAvailable: privy.available,
			privySigningIn: privyPhase !== 'idle',
			privyError,
			signOut,
		}),
		[status, user, signIn, signInWithPrivyWallet, privy.available, privyPhase, privyError, signOut],
	)

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext)
	if (context === null) throw new Error('useAuth must be used inside an AuthProvider')
	return context
}
