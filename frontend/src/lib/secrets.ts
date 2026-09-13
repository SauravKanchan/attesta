/**
 * Client-side encryption of creator parameters.
 *
 * The guarantee the UI makes — "attesta relays ciphertext it cannot read" — has to be
 * true of the bytes on the wire, not just of the copy on the page. Everything in this
 * module runs in the creator's browser and the only thing that leaves it is the
 * envelope produced by `encryptSecrets`.
 *
 * ── The production seam ──────────────────────────────────────────────────────
 * `EncryptedSecret.scheme` is the switch. Phase 1 emits `local-dev`: AES-256-GCM under
 * a key derived here, from key material generated in this browser that is never sent
 * anywhere. That keeps the shape of the real flow — encrypt first, relay ciphertext,
 * hold no key at the platform — while running with no Chainlink dependency.
 *
 * Production emits `tdh2-p256-aesgcm` instead: the same plaintext encrypted to the
 * Chainlink Vault DON's P256 threshold public key, which a threshold of DON nodes will
 * only open inside an attested enclave. Swapping schemes replaces `encryptValue` below
 * and nothing else — the envelope, the transport and the backend's ciphertext-only
 * storage are already the production ones. See
 * docs/project-overview.md#secrets--encrypted-in-the-browser-unreadable-by-the-platform.
 *
 * The honest limitation of `local-dev`, stated in the UI as well as here: the key lives
 * in this browser, so this browser is the only thing that can decrypt. No enclave can.
 * That is a local-development property, not a security claim.
 */

import type { EncryptedSecret } from '@/lib/types'

export const LOCAL_DEV_SCHEME = 'local-dev' as const satisfies EncryptedSecret['scheme']

/** Envelope prefix, so a stored blob announces how to read itself. */
const ENVELOPE_VERSION = 'v1'
const DEVICE_KEY_STORAGE_KEY = 'attesta.secrets.device-key'
const DEVICE_KEY_BYTES = 32
const IV_BYTES = 12
const HKDF_INFO = 'attesta/local-dev/aes-256-gcm'

export interface SecretInput {
	key: string
	value: string
}

/** Thrown for every failure in this module, so a caller can report the real cause. */
export class SecretEncryptionError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'SecretEncryptionError'
	}
}

/* ── Availability ────────────────────────────────────────── */

/**
 * WebCrypto's SubtleCrypto is only exposed in a secure context. localhost counts, so
 * this is true in local development and over https, and false on a plain-http host.
 */
export function isEncryptionAvailable(): boolean {
	return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined'
}

function subtle(): SubtleCrypto {
	if (!isEncryptionAvailable()) {
		throw new SecretEncryptionError(
			'WebCrypto is unavailable in this context, so parameters cannot be encrypted in the browser',
		)
	}
	return globalThis.crypto.subtle
}

/* ── Base64 ──────────────────────────────────────────────── */

function toBase64(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

/** Backed by a plain ArrayBuffer, which is what WebCrypto's BufferSource requires. */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value)
	const bytes = new Uint8Array(new ArrayBuffer(binary.length))
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
	return bytes
}

/* ── Device key material ─────────────────────────────────── */

/**
 * 32 random bytes, generated on first use and kept in this browser's localStorage.
 * It is never posted anywhere; a creator who clears site data loses the ability to
 * decrypt their own previously submitted parameters, which is the correct behaviour
 * for a key the platform is not allowed to hold a copy of.
 */
function deviceKeyMaterial(): Uint8Array<ArrayBuffer> {
	let stored: string | null = null
	try {
		stored = window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY)
	} catch (error) {
		console.error('attesta: could not read the device key from localStorage', error)
	}

	if (stored !== null) {
		try {
			const bytes = fromBase64(stored)
			if (bytes.byteLength === DEVICE_KEY_BYTES) return bytes
			console.error('attesta: the stored device key was the wrong length, generating a new one')
		} catch (error) {
			console.error('attesta: the stored device key was unreadable, generating a new one', error)
		}
	}

	const fresh = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(DEVICE_KEY_BYTES)))
	try {
		window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, toBase64(fresh))
	} catch (error) {
		// A key that cannot be persisted still encrypts this session correctly; it just
		// will not survive a reload. Worth reporting, not worth failing the submission.
		console.error('attesta: could not persist the device key to localStorage', error)
	}
	return fresh
}

/**
 * One AES key per submission, derived with HKDF so two submissions never share a key
 * and the raw device key is never used directly.
 */
async function deriveSubmissionKey(submissionId: string): Promise<CryptoKey> {
	const crypto = subtle()
	const material = deviceKeyMaterial()
	// BufferSource wants a plain ArrayBuffer; a Uint8Array view of a larger buffer is
	// not one, so copy the exact bytes out.
	const seed = material.slice().buffer
	const base = await crypto.importKey('raw', seed, 'HKDF', false, ['deriveKey'])
	return crypto.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode(submissionId),
			info: new TextEncoder().encode(HKDF_INFO),
		},
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	)
}

/* ── Encryption ──────────────────────────────────────────── */

/**
 * `local-dev.v1.<iv>.<ciphertext>`, both base64. Self-describing so a reader never has
 * to guess which scheme produced a stored blob.
 */
function envelope(iv: Uint8Array<ArrayBuffer>, ciphertext: ArrayBuffer): string {
	return [LOCAL_DEV_SCHEME, ENVELOPE_VERSION, toBase64(iv), toBase64(new Uint8Array(ciphertext))].join('.')
}

/** The one function a production TDH2 implementation replaces. */
export async function encryptValue(submissionId: string, value: string): Promise<string> {
	const crypto = subtle()
	const key = await deriveSubmissionKey(submissionId)
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)))
	try {
		const ciphertext = await crypto.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
		return envelope(iv, ciphertext)
	} catch (error) {
		console.error('attesta: AES-GCM encryption of a strategy parameter failed', error)
		throw new SecretEncryptionError('The parameter could not be encrypted in this browser', { cause: error })
	}
}

/**
 * Round-trips an envelope produced by `encryptValue`. Nothing in the submission flow
 * calls it — the platform is never given the means to — but it is what makes the
 * scheme testable, and it is what a creator's own tooling would use.
 */
export async function decryptValue(submissionId: string, blob: string): Promise<string> {
	const parts = blob.split('.')
	const [scheme, version, ivPart, ciphertextPart] = parts
	if (parts.length !== 4 || scheme !== LOCAL_DEV_SCHEME || version !== ENVELOPE_VERSION) {
		throw new SecretEncryptionError(`Unrecognised secret envelope: ${blob.slice(0, 24)}`)
	}
	const crypto = subtle()
	const key = await deriveSubmissionKey(submissionId)
	try {
		const plaintext = await crypto.decrypt(
			{ name: 'AES-GCM', iv: fromBase64(ivPart as string) },
			key,
			fromBase64(ciphertextPart as string),
		)
		return new TextDecoder().decode(plaintext)
	} catch (error) {
		console.error('attesta: AES-GCM decryption of a strategy parameter failed', error)
		throw new SecretEncryptionError('The parameter could not be decrypted in this browser', { cause: error })
	}
}

/**
 * Encrypts every parameter and returns exactly what may be posted. Callers must send
 * the result of this function and nothing else — no plaintext value appears in it.
 */
export async function encryptSecrets(
	submissionId: string,
	secrets: readonly SecretInput[],
): Promise<EncryptedSecret[]> {
	const encrypted: EncryptedSecret[] = []
	for (const secret of secrets) {
		encrypted.push({
			key: secret.key,
			ciphertext: await encryptValue(submissionId, secret.value),
			scheme: LOCAL_DEV_SCHEME,
		})
	}
	return encrypted
}
