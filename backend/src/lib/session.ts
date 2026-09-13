// Signature auth. The user proves control of an address by signing a nonce this server
// issued; the private key never leaves the browser and the server never signs for a user.
//
// Privy slots in at exactly one seam — where the browser's signer comes from. The
// challenge/verify exchange, the session token and everything downstream are unchanged by
// that swap, which is the whole reason the key lives on the other side of the wire.

import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from 'viem'
import type { LoginChallenge, User } from '../../../shared/types.js'
import { db } from '../db/index.js'
import {
	authChallenges,
	sessions,
	users,
	type AuthChallengeRow,
	type UserRow,
} from '../db/schema.js'
import { env } from './env.js'
import { badRequest, conflict, notFound, unauthorized } from './errors.js'

declare module 'fastify' {
	interface FastifyRequest {
		/** Resolved from the bearer token by the onRequest hook; null when absent or stale. */
		user: UserRow | null
	}
}

/** Long enough to read the message and click sign, short enough that a leak is worthless. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Consumed nonces linger this long past expiry so a replay is refused, not merely unknown. */
const CHALLENGE_RETENTION_MS = 60 * 60 * 1000

export function toUser(row: UserRow): User {
	return {
		id: row.id,
		username: row.username,
		walletAddress: row.walletAddress,
		createdAt: row.createdAt.toISOString(),
	}
}

/** Accepts any casing and returns the checksummed form, which is what gets stored. */
export function normaliseAddress(input: string): Address {
	const value = input.trim()
	if (!isAddress(value, { strict: false })) {
		throw badRequest(`not an ethereum address: ${JSON.stringify(input)}`)
	}
	return getAddress(value)
}

/** The display name a fresh account gets: enough of the address to recognise it. */
export function shortAddress(address: Address): string {
	return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * The origin the browser is served from, named in the message so a user can see which
 * site is asking. Derived from the configured CORS origin rather than a second setting
 * that could drift away from it.
 */
function signInDomain(): string {
	const origin = env.corsOrigins[0]
	if (!origin) return `${env.HOST}:${env.PORT}`
	try {
		return new URL(origin).host
	} catch (error) {
		console.warn('CORS_ORIGIN is not a URL; using it verbatim as the sign-in domain', {
			origin,
			error,
		})
		return origin
	}
}

/**
 * What the user actually reads before signing. Every claim the server later relies on —
 * which site, which address, which nonce, how long it is good for — is visible in the
 * text, so a message captured from one context cannot be replayed into another.
 */
function challengeMessage(address: Address, nonce: string, issuedAt: Date, expiresAt: Date): string {
	return [
		`${signInDomain()} wants you to sign in with your Ethereum account:`,
		address,
		'',
		'Signing this message proves you control this address. It is not a transaction, it',
		'moves no funds and costs no gas. attesta never receives your private key.',
		'',
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt.toISOString()}`,
		`Expires At: ${expiresAt.toISOString()}`,
	].join('\n')
}

/** Best effort: a full challenge table is a nuisance, not a failure, so log and carry on. */
function purgeStaleChallenges(): void {
	try {
		const cutoff = new Date(Date.now() - CHALLENGE_RETENTION_MS)
		db.delete(authChallenges).where(lt(authChallenges.expiresAt, cutoff)).run()
	} catch (error) {
		console.warn('could not purge stale sign-in challenges', error)
	}
}

export function createChallenge(rawAddress: string): LoginChallenge {
	const address = normaliseAddress(rawAddress)
	purgeStaleChallenges()

	const nonce = randomBytes(16).toString('hex')
	const issuedAt = new Date()
	const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)
	const message = challengeMessage(address, nonce, issuedAt, expiresAt)

	db.insert(authChallenges).values({ nonce, address, message, expiresAt, createdAt: issuedAt }).run()

	return { address, nonce, message, expiresAt: expiresAt.toISOString() }
}

/** Unconsumed and unexpired, newest first. */
function outstandingChallenges(address: Address): AuthChallengeRow[] {
	return db
		.select()
		.from(authChallenges)
		.where(
			and(
				eq(authChallenges.address, address),
				isNull(authChallenges.consumedAt),
				gt(authChallenges.expiresAt, new Date()),
			),
		)
		.orderBy(desc(authChallenges.createdAt))
		.all()
}

/**
 * Closes a nonce. The `consumed_at is null` predicate is the race guard: two verifies of
 * the same signature both find the challenge, only one update matches a row, and the
 * loser is told the challenge is spent.
 */
function consumeChallenge(nonce: string): boolean {
	const row = db
		.update(authChallenges)
		.set({ consumedAt: new Date() })
		.where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.consumedAt)))
		.returning()
		.get()
	return row !== undefined
}

export interface VerifiedChallenge {
	address: Address
	nonce: string
}

/**
 * Recovers the signer and matches it against an outstanding challenge for the address.
 * A signature over a consumed or expired nonce matches nothing, so replaying a captured
 * exchange cannot mint a second session.
 *
 * Every outstanding challenge is tried rather than only the newest: a browser that asked
 * twice would otherwise be told its perfectly valid signature was wrong.
 */
export async function verifyChallenge(
	rawAddress: string,
	signature: string,
): Promise<VerifiedChallenge> {
	const address = normaliseAddress(rawAddress)
	const outstanding = outstandingChallenges(address)
	if (outstanding.length === 0) {
		throw unauthorized('no outstanding sign-in challenge for this address — request a new one')
	}

	for (const challenge of outstanding) {
		let recovered: Address
		try {
			recovered = await recoverMessageAddress({
				message: challenge.message,
				signature: signature as Hex,
			})
		} catch (error) {
			console.warn('could not recover a signer from a sign-in signature', {
				address,
				nonce: challenge.nonce,
				error,
			})
			continue
		}

		if (recovered.toLowerCase() !== address.toLowerCase()) {
			console.warn('sign-in signature recovered a different address', {
				claimed: address,
				recovered,
				nonce: challenge.nonce,
			})
			continue
		}

		if (!consumeChallenge(challenge.nonce)) {
			console.warn('sign-in challenge was already consumed', { address, nonce: challenge.nonce })
			continue
		}

		return { address, nonce: challenge.nonce }
	}

	throw unauthorized('signature does not match any outstanding challenge for this address')
}

export function findUserByAddress(address: Address): UserRow | null {
	return db.select().from(users).where(eq(users.walletAddress, address)).get() ?? null
}

export function findOrCreateUserByAddress(address: Address): UserRow {
	const existing = findUserByAddress(address)
	if (existing) return existing

	const row = { id: randomUUID(), username: shortAddress(address), walletAddress: address }
	try {
		return db.insert(users).values(row).returning().get()
	} catch (error) {
		// Two verifies for a new address can race; the unique index decides, we re-read.
		console.warn('user insert failed, re-reading', { address, error })
		const raced = findUserByAddress(address)
		if (raced) return raced
		throw error
	}
}

function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('code' in error)) return false
	return String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT')
}

export function setUsername(userId: string, rawUsername: string): UserRow {
	const username = rawUsername.trim()
	let row: UserRow | undefined
	try {
		row = db.update(users).set({ username }).where(eq(users.id, userId)).returning().get()
	} catch (error) {
		if (isUniqueViolation(error)) {
			console.warn('username is already taken', { userId, username, error })
			throw conflict(`username "${username}" is already taken`)
		}
		console.error('could not update the username', { userId, username, error })
		throw error
	}
	if (!row) throw notFound('user not found')
	return row
}

export function issueSession(userId: string): string {
	const token = randomBytes(32).toString('base64url')
	db.insert(sessions).values({ token, userId }).run()
	return token
}

export function resolveSession(token: string): UserRow | null {
	const row = db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.token, token))
		.get()
	return row?.user ?? null
}

function bearerToken(request: FastifyRequest): string | null {
	const header = request.headers.authorization
	if (!header) return null
	const [scheme, token] = header.split(' ')
	if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
	return token.trim() || null
}

/** Resolves the caller on every request. Routes decide whether one is required. */
export function registerAuth(app: FastifyInstance): void {
	app.decorateRequest('user', null)
	app.addHook('onRequest', async (request) => {
		const token = bearerToken(request)
		if (!token) return
		const user = resolveSession(token)
		if (!user) {
			request.log.debug({ tokenPrefix: token.slice(0, 6) }, 'bearer token did not resolve')
			return
		}
		request.user = user
	})
}

export function requireUser(request: FastifyRequest): UserRow {
	if (!request.user) throw unauthorized()
	return request.user
}

/** preHandler for routes that must have a caller. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
	requireUser(request)
}
