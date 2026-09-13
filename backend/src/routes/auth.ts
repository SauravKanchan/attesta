import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LoginChallenge, Session, User } from '../../../shared/types.js'
import {
	createChallenge,
	findOrCreateUserByAddress,
	issueSession,
	requireAuth,
	requireUser,
	setUsername,
	toUser,
	verifyChallenge,
} from '../lib/session.js'

const challengeBody = z.object({
	address: z.string().trim().min(1, 'address is required'),
})

const verifyBody = z.object({
	address: z.string().trim().min(1, 'address is required'),
	signature: z
		.string()
		.trim()
		.regex(/^0x[0-9a-fA-F]+$/, 'signature must be 0x-prefixed hex'),
})

const usernameBody = z.object({
	username: z
		.string()
		.trim()
		.min(3, 'username must be at least 3 characters')
		.max(32, 'username must be at most 32 characters')
		.regex(/^[a-zA-Z0-9_.-]+$/, 'username may contain letters, digits, dot, dash and underscore'),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
	// Takes an address and nothing else. There is no request on this API that accepts a
	// private key, which is what makes the Privy swap a change of signer rather than a
	// change of protocol.
	app.post('/auth/challenge', async (request): Promise<LoginChallenge> => {
		const { address } = challengeBody.parse(request.body)
		const challenge = createChallenge(address)
		request.log.info(
			{ address: challenge.address, nonce: challenge.nonce, expiresAt: challenge.expiresAt },
			'sign-in challenge issued',
		)
		return challenge
	})

	app.post('/auth/verify', async (request): Promise<Session> => {
		const { address, signature } = verifyBody.parse(request.body)
		const verified = await verifyChallenge(address, signature)
		const user = findOrCreateUserByAddress(verified.address)
		const token = issueSession(user.id)
		request.log.info(
			{ userId: user.id, address: verified.address, nonce: verified.nonce },
			'session issued',
		)
		return { token, user: toUser(user) }
	})

	app.get('/auth/me', { preHandler: requireAuth }, async (request): Promise<User> => {
		return toUser(requireUser(request))
	})

	// The account is the address; the username is only a label over it, so it is editable
	// and carries no authority.
	app.patch('/auth/me', { preHandler: requireAuth }, async (request): Promise<User> => {
		const { username } = usernameBody.parse(request.body)
		const user = setUsername(requireUser(request).id, username)
		request.log.info({ userId: user.id, username: user.username }, 'username updated')
		return toUser(user)
	})
}
