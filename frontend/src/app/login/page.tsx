'use client'

import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { LockIcon } from '@/components/ui/icons'

/**
 * One way in. Privy's embedded wallet signs the challenge the server issues, so the
 * exchange is an address and a signature over a nonce — no key ever crosses the wire, and
 * no key is ever asked for.
 */
export default function LoginPage() {
	const { signInWithPrivyWallet, privyAvailable, privySigningIn, privyError } = useAuth()

	return (
		<main className="flex min-h-screen items-center justify-center px-6 py-10">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex items-center gap-2">
					<span className="flex size-6 items-center justify-center rounded-xs border border-verified/50 bg-verified/10 type-label-caps text-verified">
						A
					</span>
					<span className="type-headline-md text-fg">attesta</span>
				</div>

				<section className="rounded-sm border border-hairline bg-surface-1 p-4">
					<h1 className="type-label-caps text-fg-secondary">no key, no seed phrase</h1>
					<p className="mt-1 type-body-sm text-fg-muted">
						Sign in with email, Google or a passkey and Privy creates an embedded wallet that
						signs the challenge — or connect a wallet you already hold and sign with that.
						attesta funds whichever address you arrive with on the local chain, so it can
						transact straight away.
					</p>
					{privyAvailable ? (
						<Button
							type="button"
							variant="primary"
							block
							loading={privySigningIn}
							onClick={signInWithPrivyWallet}
							className="mt-3"
						>
							Sign in with Privy
						</Button>
					) : (
						<p className="mt-3 type-body-sm text-risk-light">
							This build has no <span className="type-code-sm">NEXT_PUBLIC_PRIVY_APP_ID</span>, so
							there is no way to sign in. Set it in{' '}
							<span className="type-code-sm">frontend/.env</span> and restart the dev server.
						</p>
					)}
					{privyError === null ? null : (
						<p className="mt-2 type-body-sm text-risk-light">{privyError}</p>
					)}
				</section>

				<p className="mt-4 flex items-start gap-2 type-body-sm text-fg-muted">
					<LockIcon className="mt-0.5 size-3.5 shrink-0" />
					The wallet stays in this browser. attesta signs a nonce with it to prove you control
					the address, and signs your deposits and withdrawals locally — the server never
					receives a key, and has no endpoint that would accept one.
				</p>
			</div>
		</main>
	)
}
