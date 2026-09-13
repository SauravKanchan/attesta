import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Session, User } from '../../../shared/types.js'
import { findOrCreateUser, issueSession, requireAuth, requireUser, toUser } from '../lib/session.js'

const loginBody = z.object({
	username: z
		.string()
		.trim()
		.min(3, 'username must be at least 3 characters')
		.max(32, 'username must be at most 32 characters')
		.regex(/^[a-zA-Z0-9_.-]+$/, 'username may contain letters, digits, dot, dash and underscore'),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
	app.post('/auth/login', async (request): Promise<Session> => {
		const { username } = loginBody.parse(request.body)
		const user = findOrCreateUser(username)
		const token = issueSession(user.id)
		request.log.info({ userId: user.id, username: user.username }, 'session issued')
		return { token, user: toUser(user) }
	})

	app.get('/auth/me', { preHandler: requireAuth }, async (request): Promise<User> => {
		return toUser(requireUser(request))
	})
}
