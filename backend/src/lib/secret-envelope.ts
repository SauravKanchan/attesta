// The rule that decides whether a creator parameter may be stored.
//
// Every scheme posts the same self-describing envelope: the scheme tag, a version, then
// that scheme's base64 parts — `local-dev.v1.<iv>.<ciphertext>` and
// `tdh2-p256-aesgcm.v1.<Nonce>.<TDH2Ctxt>.<SymCtxt>`, the two envelopes documented in
// docs/project-overview.md. A stored blob therefore announces how to read itself.
//
// The platform holds no key, so it cannot prove a value is ciphertext. What it can do is
// insist the value is shaped like one its own browser code produces: the scheme tag it
// claims to carry, the number of parts that scheme emits, canonical base64 in each of
// them, and decoded sizes the scheme's own cryptography forces. That is the whole of the
// test, and it has to be all four — an API key, a hex blob and a hyphenated passphrase
// are opaque strings, and so is a passphrase with `local-dev.v1.` typed in front of it,
// so a rule that only looks at character classes admits readable values while appearing
// to refuse them. The trust claim in docs/project-overview.md is that attesta never holds
// a value it can read; this is where that claim is enforced.

import { Buffer } from 'node:buffer'
import type { EncryptedSecret } from '../../../shared/types.js'

/** AES-GCM's 96-bit nonce, the size both schemes' symmetric layer uses. */
const NONCE_BYTES = 12

/** AES-GCM appends a 128-bit tag, so even an empty plaintext encrypts to this much. */
const TAG_BYTES = 16

interface EnvelopePart {
	/** How the part is named in docs/project-overview.md, so a complaint is followable. */
	readonly label: string
	readonly minBytes: number
	readonly maxBytes?: number
}

/**
 * The parts each scheme emits after `<scheme>.v<n>.`, in order. Wiring a new scheme means
 * adding its parts here; the checks below are entirely table-driven.
 */
const SHAPES: Record<EncryptedSecret['scheme'], readonly EnvelopePart[]> = {
	'local-dev': [
		{ label: 'iv', minBytes: NONCE_BYTES, maxBytes: NONCE_BYTES },
		{ label: 'ciphertext', minBytes: TAG_BYTES },
	],
	'tdh2-p256-aesgcm': [
		{ label: 'nonce', minBytes: NONCE_BYTES },
		{ label: 'TDH2 ciphertext', minBytes: TAG_BYTES },
		{ label: 'symmetric ciphertext', minBytes: TAG_BYTES },
	],
}

const SCHEMES = Object.keys(SHAPES) as EncryptedSecret['scheme'][]

const VERSION = /^v\d+$/

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * The number of bytes a base64 part decodes to, or null when it is not canonical base64.
 * Re-encoding is what makes it canonical: a part with a length base64 cannot produce, or
 * with bits set past the last whole byte, is rejected rather than silently truncated.
 */
function decodedBytes(part: string): number | null {
	if (part.length === 0 || part.length % 4 !== 0 || !BASE64.test(part)) return null
	const bytes = Buffer.from(part, 'base64')
	return bytes.toString('base64') === part ? bytes.byteLength : null
}

/**
 * Why `value` is not an envelope produced under `scheme`, or null when it is. The string
 * is shown to the creator, so it names the part that is wrong rather than the rule.
 */
export function envelopeComplaint(value: string, scheme: EncryptedSecret['scheme']): string | null {
	if (/\s/.test(value)) return 'it contains whitespace'

	const [tag, version, ...parts] = value.split('.')
	if (tag !== scheme) {
		return SCHEMES.some((known) => known === tag)
			? `its envelope was produced by ${tag}, not ${scheme}`
			: `it is not a ${scheme}.v1.<base64> envelope`
	}
	if (version === undefined || !VERSION.test(version)) return 'its envelope carries no version'

	const shape = SHAPES[scheme]
	if (parts.length !== shape.length) {
		return `a ${scheme} envelope has ${shape.length} base64 parts and this has ${parts.length}`
	}

	for (const [index, part] of shape.entries()) {
		const bytes = decodedBytes(parts[index] as string)
		if (bytes === null) return `its ${part.label} is not base64`
		if (bytes < part.minBytes) {
			return `its ${part.label} is ${bytes} bytes, and ${scheme} never produces one under ${part.minBytes}`
		}
		if (part.maxBytes !== undefined && bytes > part.maxBytes) {
			return `its ${part.label} is ${bytes} bytes, and a ${scheme} ${part.label} is exactly ${part.maxBytes}`
		}
	}

	return null
}
