'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Tag } from '@/components/ui/Tag'
import { AlertIcon, CloseIcon, ShieldCheckIcon } from '@/components/ui/icons'
import { LOCAL_DEV_SCHEME, encryptValue, isEncryptionAvailable } from '@/lib/secrets'

export interface SecretRow {
	id: string
	key: string
	value: string
	/** Ciphertext for `encryptedFrom`; the only form of the value that is ever posted. */
	ciphertext: string | null
	/** The plaintext that produced `ciphertext`, so a stale row re-encrypts exactly once. */
	encryptedFrom: string | null
	error: string | null
}

export function newSecretRow(): SecretRow {
	return {
		id: `secret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		key: '',
		value: '',
		ciphertext: null,
		encryptedFrom: null,
		error: null,
	}
}

/** Keys reach the backend in the clear — they are identifiers, not values. */
const KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/

export function validateSecrets(rows: readonly SecretRow[]): string | null {
	const named = rows.filter((row) => row.key.trim() !== '' || row.value !== '')
	for (const row of named) {
		if (!KEY_PATTERN.test(row.key.trim())) {
			return `"${row.key || '(unnamed)'}" is not a valid key — use UPPER_SNAKE_CASE`
		}
		if (row.value === '') return `${row.key} has no value`
		if (row.ciphertext === null) return `${row.key} has not finished encrypting`
	}
	const keys = named.map((row) => row.key.trim())
	if (new Set(keys).size !== keys.length) return 'Two parameters share a key'
	return null
}

/** Only rows the creator actually filled in are submitted. */
export function submittableSecrets(rows: readonly SecretRow[]): SecretRow[] {
	return rows.filter((row) => row.key.trim() !== '' && row.ciphertext !== null)
}

const ENCRYPT_DEBOUNCE_MS = 250

export interface SecretsStepProps {
	submissionId: string
	rows: SecretRow[]
	onChange: (rows: SecretRow[]) => void
}

export function SecretsStep({ submissionId, rows, onChange }: SecretsStepProps) {
	const available = isEncryptionAvailable()

	// Encrypt on a short delay after typing stops. The plaintext never leaves this
	// component; what the step hands back to the flow is the envelope.
	useEffect(() => {
		if (!available) return
		const stale = rows.filter((row) => row.value !== '' && row.encryptedFrom !== row.value)
		if (stale.length === 0) return

		let cancelled = false
		const timer = setTimeout(() => {
			void (async () => {
				const updates = new Map<string, Pick<SecretRow, 'ciphertext' | 'encryptedFrom' | 'error'>>()
				for (const row of stale) {
					try {
						const ciphertext = await encryptValue(submissionId, row.value)
						updates.set(row.id, { ciphertext, encryptedFrom: row.value, error: null })
					} catch (caught) {
						console.error('attesta: encrypting a strategy parameter failed', caught)
						updates.set(row.id, {
							ciphertext: null,
							encryptedFrom: row.value,
							error: caught instanceof Error ? caught.message : 'Encryption failed',
						})
					}
				}
				if (cancelled) return
				onChange(rows.map((row) => (updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row)))
			})()
		}, ENCRYPT_DEBOUNCE_MS)

		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [rows, submissionId, onChange, available])

	function patch(id: string, fields: Partial<SecretRow>) {
		onChange(rows.map((row) => (row.id === id ? { ...row, ...fields } : row)))
	}

	function remove(id: string) {
		const next = rows.filter((row) => row.id !== id)
		onChange(next.length === 0 ? [newSecretRow()] : next)
	}

	const exampleKey = rows.find((row) => row.key.trim() !== '')?.key.trim() ?? 'TARGET_WEIGHT_BPS'

	return (
		<div className="flex flex-col gap-4">
			<EncryptionNotice available={available} />

			<div className="flex flex-col rounded-sm border border-hairline bg-surface-1">
				<div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
					<div>
						<h2 className="type-headline-sm text-fg">Private parameters</h2>
						<p className="mt-0.5 type-body-sm text-fg-secondary">
							Thresholds, sizes and venue credentials your published source must not contain.
						</p>
					</div>
					<Button size="compact" onClick={() => onChange([...rows, newSecretRow()])}>
						Add parameter
					</Button>
				</div>

				<div className="flex flex-col divide-y divide-hairline">
					{rows.map((row) => (
						<SecretRowFields
							key={row.id}
							row={row}
							onPatch={(fields) => patch(row.id, fields)}
							onRemove={() => remove(row.id)}
							removable={rows.length > 1 || row.key !== '' || row.value !== ''}
						/>
					))}
				</div>

				<p className="border-t border-hairline px-4 py-3 type-body-sm text-fg-muted">
					Leave this empty if your strategy has no private parameters — plenty do not.
				</p>
			</div>

			<div className="rounded-sm border border-hairline bg-surface-1 p-4">
				<h3 className="type-label-caps text-fg-secondary">Reading one back in the strategy</h3>
				<pre className="recessed mt-2 overflow-x-auto rounded-sm px-3 py-2.5 type-code-md text-fg-secondary">
					<code>{`const raw = ctx.getSecret('${exampleKey}')\nconst targetBps = raw.trim() === '' ? DEFAULT_TARGET_BPS : Number(raw)`}</code>
				</pre>
				<p className="mt-2 type-body-sm text-fg-muted">
					An unset parameter comes back as an empty string, so give every one a public default —
					otherwise a missing value silently flattens the position.
				</p>
			</div>
		</div>
	)
}

function EncryptionNotice({ available }: { available: boolean }) {
	if (!available) {
		return (
			<div className="flex items-start gap-3 rounded-sm border border-risk/50 bg-risk/8 p-4">
				<AlertIcon className="mt-0.5 size-4 shrink-0 text-risk-light" />
				<div>
					<p className="type-headline-sm text-fg">This browser cannot encrypt</p>
					<p className="mt-1 type-body-md text-fg-secondary">
						WebCrypto is only exposed in a secure context. Open the app over https or on localhost;
						attesta will not accept a parameter it would have to carry in plaintext.
					</p>
				</div>
			</div>
		)
	}

	return (
		<div className="rounded-sm border border-verified/40 bg-verified/8 p-4">
			<div className="flex items-start gap-3">
				<ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-verified" />
				<div className="min-w-0">
					<p className="type-headline-sm text-fg">Encrypted here, in your browser</p>
					<p className="mt-1 type-body-md text-fg-secondary">
						Each value is encrypted before it leaves this page. attesta receives the key name and the
						ciphertext, and holds no key that opens it — you can see the exact bytes that will be
						posted under each row.
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<Tag tone="verified" mono>
							{LOCAL_DEV_SCHEME}
						</Tag>
						<Tag recessed mono>
							AES-256-GCM
						</Tag>
						<Tag recessed mono>
							key derived in this browser
						</Tag>
					</div>
					<p className="mt-3 type-body-sm text-fg-muted">
						Local development scheme, stated plainly: the key is generated in this browser and never
						sent anywhere, so this browser is the only thing that can decrypt — no enclave can. In
						production the same field carries TDH2 ciphertext encrypted to the Chainlink Vault DON&apos;s
						threshold key, which a threshold of nodes will only open inside an attested enclave. The
						relay, the storage and this page are already the production ones; the scheme tag is the
						seam.
					</p>
				</div>
			</div>
		</div>
	)
}

interface SecretRowFieldsProps {
	row: SecretRow
	onPatch: (fields: Partial<SecretRow>) => void
	onRemove: () => void
	removable: boolean
}

function SecretRowFields({ row, onPatch, onRemove, removable }: SecretRowFieldsProps) {
	const [revealed, setRevealed] = useState(false)
	const pending = row.value !== '' && row.encryptedFrom !== row.value

	return (
		<div className="flex flex-col gap-2 px-4 py-3">
			<div className="flex items-end gap-3">
				<Input
					mono
					className="uppercase"
					label="Key"
					placeholder="TARGET_WEIGHT_BPS"
					value={row.key}
					onChange={(event) => onPatch({ key: event.target.value.toUpperCase() })}
				/>
				<div className="flex-1">
					<Input
						mono
						label="Value"
						type={revealed ? 'text' : 'password'}
						placeholder="Never leaves this page in the clear"
						autoComplete="off"
						value={row.value}
						onChange={(event) => onPatch({ value: event.target.value })}
						error={row.error}
					/>
				</div>
				<Button size="compact" onClick={() => setRevealed((previous) => !previous)}>
					{revealed ? 'Hide' : 'Reveal'}
				</Button>
				<Button
					size="compact"
					variant="ghost"
					aria-label="Remove parameter"
					disabled={!removable}
					onClick={onRemove}
					icon={<CloseIcon className="size-3" />}
				/>
			</div>

			<div className="flex items-baseline gap-2">
				<span className="shrink-0 type-label-caps text-fg-muted">On the wire</span>
				<code
					className={cn(
						'min-w-0 flex-1 truncate type-code-sm',
						row.ciphertext === null ? 'text-fg-muted' : 'text-verified',
					)}
					title={row.ciphertext ?? undefined}
				>
					{row.value === ''
						? 'nothing to send'
						: pending
						  ? 'encrypting…'
						  : (row.ciphertext ?? 'encryption failed')}
				</code>
			</div>
		</div>
	)
}
