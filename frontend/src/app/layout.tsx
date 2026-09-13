import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { AppShell } from '@/components/AppShell'
import { AuthProvider } from '@/components/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { SESSION_HINT_COOKIE } from '@/lib/session-hint'
import type { SessionHint } from '@/lib/session-hint'
import './globals.css'

const inter = Inter({
	subsets: ['latin'],
	variable: '--font-inter',
	display: 'swap',
})

// Carries every number, currency figure, hash, ticker and table header in the product.
const jetbrainsMono = JetBrains_Mono({
	subsets: ['latin'],
	variable: '--font-jetbrains-mono',
	display: 'swap',
})

export const metadata: Metadata = {
	title: 'attesta',
	description: 'A marketplace for verifiable automated trading strategies, attested inside a TEE.',
}

export const viewport: Viewport = {
	colorScheme: 'dark',
}

/**
 * The session token is only readable on the client, so the server takes its cue from
 * the hint cookie: without it the root would render the marketplace for a visitor who
 * is about to be shown the landing page, and flash on the way.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
	const cookieStore = await cookies()
	const sessionHint: SessionHint = cookieStore.has(SESSION_HINT_COOKIE) ? 'authenticated' : 'anonymous'

	return (
		<html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
			<body className="min-h-screen bg-canvas text-fg antialiased">
				<ToastProvider>
					<AuthProvider>
						<AppShell sessionHint={sessionHint}>{children}</AppShell>
					</AuthProvider>
				</ToastProvider>
			</body>
		</html>
	)
}
