'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ShieldCheckIcon } from '@/components/ui/icons'

// Username-only, and intentionally thin: Privy replaces this whole screen.
export default function LoginPage() {
	const { signIn } = useAuth()
	const [username, setUsername] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const trimmed = username.trim()
		if (!trimmed) {
			setError('Pick a username')
			return
		}
		setSubmitting(true)
		setError(null)
		try {
			await signIn(trimmed)
		} catch (caught: unknown) {
			console.error('attesta: sign in failed', caught)
			setError(caught instanceof Error ? caught.message : 'Sign in failed')
			setSubmitting(false)
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-6">
			<div className="w-full max-w-xs">
				<div className="mb-6 flex items-center gap-2">
					<span className="flex size-6 items-center justify-center rounded-xs border border-verified/50 bg-verified/10 type-label-caps text-verified">
						A
					</span>
					<span className="type-headline-md text-fg">attesta</span>
				</div>

				<form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface-1 p-4">
					<Input
						label="Username"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						placeholder="satoshi"
						autoComplete="username"
						autoFocus
						error={error}
						hint="First sign in creates the account and funds a local wallet."
					/>
					<Button type="submit" variant="primary" loading={submitting} block>
						Sign in
					</Button>
				</form>

				<p className="mt-4 flex items-start gap-2 type-body-sm text-fg-muted">
					<ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
					Strategies run in AWS Nitro Enclaves in us-west-2. Performance you see is attested, not
					self-reported.
				</p>
			</div>
		</main>
	)
}
