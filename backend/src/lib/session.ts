// Username auth: Privy stands in as a username here, so a login is "first sight of this
// name creates the account, its local wallet, and a bearer token".

import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { User } from '../../../shared/types.js'
import { db } from '../db/index.js'
import { sessions, users, type UserRow } from '../db/schema.js'
import { unauthorized } from './errors.js'

declare module 'fastify' {
	interface FastifyRequest {
		/** Resolved from the bearer token by the onRequest hook; null when absent or stale. */
		user: UserRow | null
	}
}

export function toUser(row: UserRow): User {
	return {
		id: row.id,
		username: row.username,
		walletAddress: row.walletAddress,
		createdAt: row.createdAt.toISOString(),
	}
}

/** Usernames are identity, so they are matched and stored lowercased. */
export function normaliseUsername(username: string): string {
	return username.trim().toLowerCase()
}

export function findUserByUsername(username: string): UserRow | null {
	return db.select().from(users).where(eq(users.username, username)).get() ?? null
}

export function findOrCreateUser(rawUsername: string): UserRow {
	const username = normaliseUsername(rawUsername)
	const existing = findUserByUsername(username)
	if (existing) return existing

	const privateKey = generatePrivateKey()
	const account = privateKeyToAccount(privateKey)
	const row = {
		id: randomUUID(),
		username,
		walletAddress: account.address,
		privateKey,
	}

	try {
		return db.insert(users).values(row).returning().get()
	} catch (error) {
		// Two logins for a new username can race; the unique index decides, we re-read.
		console.warn('user insert failed, re-reading', { username, error })
		const raced = findUserByUsername(username)
		if (raced) return raced
		throw error
	}
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
