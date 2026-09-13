// The property under test is the platform's central trust claim: a creator parameter it
// could read must never be storable. Every case below is a value that reached
// `POST /submissions/:id/secrets` in a probe, so a rule that admits one of them again is
// a rule that has quietly made docs/project-overview.md false.

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { describe, test } from 'node:test'
import type { EncryptedSecret } from '../../shared/types.js'
import { envelopeComplaint } from '../src/lib/secret-envelope.js'

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/** Built exactly as frontend/src/lib/secrets.ts builds it, so this is the browser's wire format. */
async function browserEnvelope(value: string): Promise<string> {
	const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
	const iv = webcrypto.getRandomValues(new Uint8Array(12))
	const ciphertext = await webcrypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(value),
	)
	return ['local-dev', 'v1', b64(iv), b64(new Uint8Array(ciphertext))].join('.')
}

const tdh2Envelope = (): string =>
	[
		'tdh2-p256-aesgcm',
		'v1',
		b64(webcrypto.getRandomValues(new Uint8Array(12))),
		b64(webcrypto.getRandomValues(new Uint8Array(97))),
		b64(webcrypto.getRandomValues(new Uint8Array(48))),
	].join('.')

describe('envelopeComplaint refuses a value the platform could read', () => {
	const refused: Array<[string, string, EncryptedSecret['scheme']]> = [
		['an API key pasted as-is', 'sk-proj-abcdef0123456789abcdef', 'tdh2-p256-aesgcm'],
		['a passphrase', 'correct-horse-battery-staple', 'tdh2-p256-aesgcm'],
		['an API key under local-dev', 'sk-proj-abcdef0123456789abcdef', 'local-dev'],
		['a hex blob', 'a'.repeat(64), 'tdh2-p256-aesgcm'],
		['base64 of readable text', Buffer.from('my-openai-key-do-not-share').toString('base64'), 'local-dev'],
		['a passphrase behind an envelope prefix', 'local-dev.v1.MYSECRETPASSWORD.hunter2hunter2hunter2', 'local-dev'],
		['words behind a TDH2 prefix', 'tdh2-p256-aesgcm.v1.correcthorse.batterystaple.SECRETPASSPHRASE', 'tdh2-p256-aesgcm'],
		['a part that is not canonical base64', 'local-dev.v1.MYSECRETPASSWORD.THISISNOTBASE64!', 'local-dev'],
		['an iv of the wrong length', `local-dev.v1.${b64(new Uint8Array(16))}.${b64(new Uint8Array(32))}`, 'local-dev'],
		['a ciphertext shorter than the GCM tag', `local-dev.v1.${b64(new Uint8Array(12))}.${b64(new Uint8Array(8))}`, 'local-dev'],
		['a local-dev envelope with a TDH2 part count', `local-dev.v1.${b64(new Uint8Array(12))}.${b64(new Uint8Array(32))}.${b64(new Uint8Array(32))}`, 'local-dev'],
		['an unversioned envelope', `local-dev.${b64(new Uint8Array(12))}.${b64(new Uint8Array(32))}`, 'local-dev'],
		['whitespace inside the envelope', `local-dev.v1. ${b64(new Uint8Array(12))}.${b64(new Uint8Array(32))}`, 'local-dev'],
		['an empty value', '', 'local-dev'],
	]

	for (const [label, value, scheme] of refused) {
		test(label, () => {
			assert.notEqual(envelopeComplaint(value, scheme), null, `${label} was admitted`)
		})
	}

	test('a real envelope that claims the other scheme', async () => {
		const envelope = await browserEnvelope('sk-proj-abcdef0123456789abcdef')
		assert.notEqual(envelopeComplaint(envelope, 'tdh2-p256-aesgcm'), null)
	})
})

describe('envelopeComplaint admits what the browser produces', () => {
	const values = ['sk-proj-abcdef0123456789abcdef', '', '250', 'a'.repeat(4_096)]

	for (const value of values) {
		test(`a local-dev envelope over a ${value.length}-character value`, async () => {
			const envelope = await browserEnvelope(value)
			assert.equal(envelopeComplaint(envelope, 'local-dev'), null)
		})
	}

	test('a TDH2 envelope: nonce, TDH2 ciphertext, symmetric ciphertext', () => {
		assert.equal(envelopeComplaint(tdh2Envelope(), 'tdh2-p256-aesgcm'), null)
	})
})
