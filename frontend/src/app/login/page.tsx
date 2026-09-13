'use client'

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { LockIcon } from '@/components/ui/icons'
import { deriveAddress } from '@/lib/wallet'
import { truncateAddress } from '@/lib/format'
import { ANVIL_ACCOUNTS } from '@/app/login/anvil-accounts'

/**
 * Deliberately thin: this screen is a stand-in for Privy's embedded wallet and goes away
 * with it. What it has to get right is the seam, not the styling — the key entered here
 * stays in the browser, and the only thing sent to the server is a signature.
 */
export default function LoginPage() {
	const { signIn } = useAuth()
	const [privateKey, setPrivateKey] = useState('')
	const [revealed, setRevealed] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	const address = useMemo(() => deriveAddress(privateKey), [privateKey])
	const quickPick = useMemo(
		() =>
			ANVIL_ACCOUNTS.map((account) => ({
				...account,
				address: deriveAddress(account.privateKey),
			})),
		[],
	)

	const entered = privateKey.trim() !== ''
	const malformed = entered && address === null

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (address === null) {
			setError(entered ? 'That is not a private key.' : 'Paste a private key, or pick a test account.')
			return
		}
		setSubmitting(true)
		setError(null)
		try {
			await signIn(privateKey)
		} catch (caught: unknown) {
			console.error('attesta: sign in failed', caught)
			setError(caught instanceof Error ? caught.message : 'Sign in failed')
			setSubmitting(false)
		}
	}

	async function paste() {
		try {
			const text = await navigator.clipboard.readText()
			setPrivateKey(text.trim())
			setError(null)
		} catch (caught: unknown) {
			console.error('attesta: could not read the clipboard', caught)
			setError('This browser would not hand over the clipboard — paste the key by hand.')
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center px-6 py-10">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex items-center gap-2">
					<span className="flex size-6 items-center justify-center rounded-xs border border-verified/50 bg-verified/10 type-label-caps text-verified">
						A
					</span>
					<span className="type-headline-md text-fg">attesta</span>
				</div>

				<form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface-1 p-4">
					<Input
						label="Private key"
						type={revealed ? 'text' : 'password'}
						mono
						value={privateKey}
						onChange={(event) => {
							setPrivateKey(event.target.value)
							setError(null)
						}}
						placeholder="0x…"
						autoComplete="off"
						spellCheck={false}
						autoFocus
						error={error ?? (malformed ? 'That is not a private key.' : null)}
					/>

					<div className="flex items-center gap-1.5">
						<Button size="compact" onClick={() => void paste()} type="button">
							Paste
						</Button>
						<Button size="compact" type="button" onClick={() => setRevealed((shown) => !shown)}>
							{revealed ? 'Hide' : 'Show'}
						</Button>
						<span className="ml-auto truncate type-code-sm text-fg-muted" title={address ?? undefined}>
							{address === null ? 'no address yet' : truncateAddress(address)}
						</span>
					</div>

					<Button type="submit" variant="primary" loading={submitting} disabled={address === null} block>
						Sign in
					</Button>
				</form>

				<section className="mt-4 rounded-sm border border-hairline bg-surface-1 p-4">
					<h2 className="type-label-caps text-fg-secondary">anvil test accounts</h2>
					<p className="mt-1 type-body-sm text-fg-muted">
						Pre-funded on the local chain. Pick one instead of hunting for a key.
					</p>
					<ul className="mt-3 flex flex-col gap-1">
						{quickPick.map((account) => (
							<li key={account.index}>
								<button
									type="button"
									onClick={() => {
										setPrivateKey(account.privateKey)
										setError(null)
									}}
									className="flex w-full items-center gap-3 rounded-xs px-2 py-1.5 text-left transition-colors hover:bg-interact"
								>
									<span className="type-label-caps text-fg-muted">#{account.index}</span>
									<span className="truncate type-code-sm text-fg-secondary">
										{account.address === null ? 'unusable key' : account.address}
									</span>
								</button>
							</li>
						))}
					</ul>
				</section>

				<p className="mt-4 flex items-start gap-2 type-body-sm text-fg-muted">
					<LockIcon className="mt-0.5 size-3.5 shrink-0" />
					The key stays in this browser. attesta signs a nonce with it to prove you control the
					address, and signs your deposits and withdrawals locally — the server never receives it.
					Pasting a key is a dev-only sign-in and is being replaced by Privy.
				</p>
			</div>
		</main>
	)
}
