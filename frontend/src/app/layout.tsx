import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { AppShell } from '@/components/AppShell'
import { AuthProvider } from '@/components/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
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

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
			<body className="min-h-screen bg-canvas text-fg antialiased">
				<ToastProvider>
					<AuthProvider>
						<AppShell>{children}</AppShell>
					</AuthProvider>
				</ToastProvider>
			</body>
		</html>
	)
}
