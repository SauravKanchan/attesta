'use client'

import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import { useAuth } from '@/components/AuthProvider'
import { EnclaveStatus } from '@/components/EnclaveStatus'
import { CodeIcon, GridIcon, SearchIcon, SidebarIcon, SignOutIcon, WalletIcon } from '@/components/ui/icons'
import { truncateAddress } from '@/lib/format'

const COLLAPSE_STORAGE_KEY = 'attesta.sidebar.collapsed'

interface NavItem {
	href: string
	label: string
	icon: ReactNode
}

const NAV: NavItem[] = [
	{ href: '/', label: 'Marketplace', icon: <GridIcon className="size-4" /> },
	{ href: '/portfolio', label: 'Portfolio', icon: <WalletIcon className="size-4" /> },
	{ href: '/create', label: 'Create strategy', icon: <CodeIcon className="size-4" /> },
]

/**
 * One navigation, in the sidebar. The top bar carries only search and the enclave
 * indicator so there is never a second place to look for the same links.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const { status } = useAuth()

	// The sign-in screen is deliberately chromeless.
	if (pathname === '/login') return <>{children}</>

	if (status !== 'authenticated') {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<p className="type-label-caps text-fg-muted">Restoring session</p>
			</div>
		)
	}

	return <Shell>{children}</Shell>
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
				<Link href="/" className="flex min-w-0 items-center gap-2" aria-label="attesta">
					<span className="flex size-6 shrink-0 items-center justify-center rounded-xs border border-verified/50 bg-verified/10 type-label-caps text-verified">
						A
					</span>
					{collapsed ? null : (
						<span className="truncate type-headline-sm tracking-tight text-fg">attesta</span>
					)}
				</Link>
				{collapsed ? null : (
					<button
						type="button"
						onClick={onToggle}
						aria-label="Collapse sidebar"
						className="ml-auto flex size-6 items-center justify-center rounded-xs text-fg-muted transition-colors hover:bg-interact hover:text-fg"
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

			<nav className="flex flex-1 flex-col gap-0.5 p-2">
				{NAV.map((item) => {
					const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
					return (
						<Link
							key={item.href}
							href={item.href}
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
						{(user?.username ?? '?').slice(0, 2).toUpperCase()}
					</span>
					{collapsed ? null : (
						<div className="min-w-0 flex-1">
							<p className="truncate type-body-md text-fg">{user?.username ?? 'Signed in'}</p>
							<p className="truncate type-code-sm text-fg-muted">
								{truncateAddress(user?.walletAddress)}
							</p>
						</div>
					)}
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
			<div className="ml-auto flex items-center gap-3">
				<EnclaveStatus />
			</div>
		</header>
	)
}
