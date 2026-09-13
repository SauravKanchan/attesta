'use client'

import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Landing } from '@/app/(marketing)/Landing'
import { cn } from '@/lib/cn'
import { useAuth } from '@/components/AuthProvider'
import { EnclaveStatus } from '@/components/EnclaveStatus'
import { CodeIcon, GridIcon, SearchIcon, SidebarIcon, SignOutIcon, WalletIcon } from '@/components/ui/icons'
import { Wordmark } from '@/components/ui/Wordmark'
import { writeSessionHint } from '@/lib/session-hint'
import type { SessionHint } from '@/lib/session-hint'
import type { User } from '@/lib/types'
import { CopyableHash } from '@/components/ui/CopyableHash'

const COLLAPSE_STORAGE_KEY = 'attesta.sidebar.collapsed'

/**
 * Two characters that tell one account from another. A wallet-derived username starts
 * `0x`, which every account shares, so the prefix is dropped before taking them.
 */
/** A username the user never set is just their address, and two hex digits read as a
 *  number rather than a monogram. Those get a glyph instead. */
function isAddressDerived(username: string | undefined): boolean {
	return /^@?0x/i.test((username ?? '').trim())
}

function initials(username: string | undefined): string {
	const name = (username ?? '').trim().replace(/^@/, '')
	if (name === '' || isAddressDerived(name)) return ''
	return name.slice(0, 2).toUpperCase()
}

function WalletGlyph({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
			<path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3" />
			<circle cx="11.5" cy="9.5" r="1" fill="currentColor" />
		</svg>
	)
}

interface NavItem {
	href: string
	label: string
	icon: ReactNode
}

/** The only navigation in the product. The top bar carries no links at all. */
const NAV: NavItem[] = [
	{ href: '/', label: 'Marketplace', icon: <GridIcon className="size-4" /> },
	{ href: '/portfolio', label: 'Portfolio', icon: <WalletIcon className="size-4" /> },
	{ href: '/create', label: 'Create strategy', icon: <CodeIcon className="size-4" /> },
]

export interface AppShellProps {
	children: ReactNode
	/**
	 * What the server believed about the session when it rendered. The token itself
	 * is only readable on the client, so without this the first paint of `/` would
	 * have to guess between the landing page and the marketplace.
	 */
	sessionHint?: SessionHint
}

export function AppShell({ children, sessionHint = 'anonymous' }: AppShellProps) {
	const pathname = usePathname()
	const { status } = useAuth()

	// Keep the server's next guess in step with what the client actually found.
	useEffect(() => {
		if (status === 'loading') return
		writeSessionHint(status === 'authenticated')
	}, [status])

	// The sign-in screen is deliberately chromeless.
	if (pathname === '/login') return <>{children}</>

	const resolved = status === 'loading' ? sessionHint : status

	if (resolved === 'anonymous') {
		// The root is public; everything else is behind the session and AuthProvider
		// is already redirecting, so there is nothing to draw but a held frame.
		return pathname === '/' ? <Landing /> : <HeldFrame label="Redirecting" />
	}

	return <Shell>{children}</Shell>
}

function HeldFrame({ label }: { label: string }) {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<p className="type-label-caps text-fg-muted">{label}</p>
		</div>
	)
}

function Shell({ children }: { children: ReactNode }) {
	const [collapsed, setCollapsed] = useState(false)

	useEffect(() => {
		try {
			setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true')
		} catch (error) {
			console.error('attesta: could not read the sidebar state from localStorage', error)
		}
	}, [])

	function toggleCollapsed() {
		setCollapsed((previous) => {
			const next = !previous
			try {
				window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
			} catch (error) {
				console.error('attesta: could not persist the sidebar state to localStorage', error)
			}
			return next
		})
	}

	return (
		<div className="flex min-h-screen">
			<Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar />
				<main className="min-w-0 flex-1 px-6 py-6">{children}</main>
			</div>
		</div>
	)
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
	const pathname = usePathname()
	const { user, signOut } = useAuth()

	return (
		<aside
			className={cn(
				'sticky top-0 flex h-screen shrink-0 flex-col border-r border-hairline bg-surface-1 transition-[width] duration-150',
				collapsed ? 'w-14' : 'w-65',
			)}
		>
			<div className="flex h-12 items-center gap-2 border-b border-hairline px-3">
				<Link href="/" className="flex min-w-0 items-center" aria-label="attesta">
					<Wordmark size="sm" showName={!collapsed} />
				</Link>
				{collapsed ? null : (
					<button
						type="button"
						onClick={onToggle}
						aria-label="Collapse sidebar"
						className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
					>
						<SidebarIcon className="size-3.5" />
					</button>
				)}
			</div>

			{collapsed ? (
				<button
					type="button"
					onClick={onToggle}
					aria-label="Expand sidebar"
					className="mx-auto mt-2 flex size-8 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
				>
					<SidebarIcon className="size-3.5" />
				</button>
			) : null}

			<nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 p-2">
				{NAV.map((item) => {
					const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
					return (
						<Link
							key={item.href}
							href={item.href}
							aria-current={active ? 'page' : undefined}
							title={collapsed ? item.label : undefined}
							className={cn(
								'flex h-9 items-center gap-2.5 rounded-sm px-2.5 type-body-md transition-colors',
								collapsed && 'justify-center px-0',
								active
									? 'bg-interact text-fg'
									: 'text-fg-secondary hover:bg-interact/60 hover:text-fg',
							)}
						>
							<span className={cn('shrink-0', active ? 'text-verified' : 'text-fg-muted')}>
								{item.icon}
							</span>
							{collapsed ? null : <span className="truncate">{item.label}</span>}
						</Link>
					)
				})}
			</nav>

			<div className="border-t border-hairline p-2">
				<div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
					<span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-surface-2 type-code-sm text-fg-secondary">
						{initials(user?.username) || <WalletGlyph className="size-3.5" />}
					</span>
					{collapsed ? null : <SidebarIdentity user={user} />}
					{collapsed ? null : (
						<button
							type="button"
							onClick={signOut}
							aria-label="Sign out"
							title="Sign out"
							className="flex size-7 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
						>
							<SignOutIcon className="size-3.5" />
						</button>
					)}
				</div>
				{collapsed ? (
					<button
						type="button"
						onClick={signOut}
						aria-label="Sign out"
						title="Sign out"
						className="mx-auto mt-2 flex size-7 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
					>
						<SignOutIcon className="size-3.5" />
					</button>
				) : null}
			</div>
		</aside>
	)
}

/**
 * An account with no chosen username is labelled by its own address, so drawing the
 * username over the address printed the same string on both lines. The address line is
 * only worth its row when it says something the line above it does not.
 */
function SidebarIdentity({ user }: { user: User | null }) {
	const named = user?.username !== undefined && !isAddressDerived(user.username)
	return (
		<div className="min-w-0 flex-1">
			{named ? (
				<>
					<p className="truncate type-code-sm text-fg" title={user?.walletAddress ?? undefined}>
						{user.username}
					</p>
					<CopyableHash value={user?.walletAddress} lead={6} tail={4} label="wallet address" />
				</>
			) : (
				// The address is the identity here, so it is the thing worth copying — you
				// need it to fund the wallet or look it up on chain.
				<CopyableHash value={user?.walletAddress} lead={6} tail={4} label="wallet address" />
			)}
		</div>
	)
}

function TopBar() {
	const router = useRouter()
	const [query, setQuery] = useState('')

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const trimmed = query.trim()
		router.push(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/')
	}

	return (
		<header className="sticky top-0 z-20 flex h-12 items-center gap-4 border-b border-hairline bg-canvas/95 px-6 backdrop-blur">
			<form onSubmit={onSubmit} className="relative flex min-w-0 max-w-md flex-1 items-center">
				<SearchIcon className="pointer-events-none absolute left-3 size-3.5 text-fg-muted" />
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search strategies, tickers, creators"
					aria-label="Search strategies"
					className="h-8 w-full rounded-sm border border-hairline bg-surface-1 pl-9 pr-3 type-body-md text-fg placeholder:text-fg-muted transition-colors hover:border-hairline-strong focus:border-telemetry-hover focus:outline-none"
				/>
			</form>
			<div className="ml-auto flex shrink-0 items-center gap-3">
				<EnclaveStatus />
			</div>
		</header>
	)
}
