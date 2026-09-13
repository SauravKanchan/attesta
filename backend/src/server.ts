import cors from '@fastify/cors'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { ApiError } from '../../shared/types.js'
import { env } from './lib/env.js'
import { HttpError, codeForStatus } from './lib/errors.js'
import { registerAuth } from './lib/session.js'
import { authRoutes } from './routes/auth.js'
import { healthRoutes } from './routes/health.js'

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: { level: env.LOG_LEVEL },
		trustProxy: false,
	})

	app.register(cors, {
		origin: env.corsOrigins,
		methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
		credentials: true,
	})

	registerAuth(app)

	app.setErrorHandler((error: FastifyError, request, reply) => {
		const httpError = error instanceof HttpError ? error : null
		if (httpError) {
			request.log.warn({ err: httpError, code: httpError.code }, 'request rejected')
			reply.status(httpError.statusCode).send(httpError.toApiError())
			return
		}

		const zodError = error instanceof ZodError ? error : null
		if (zodError) {
			const body: ApiError = {
				error: 'validation_error',
				message: 'request failed validation',
				details: zodError.flatten(),
			}
			request.log.warn({ err: zodError }, 'request failed validation')
			reply.status(400).send(body)
			return
		}

		const statusCode = error.statusCode ?? 500
		if (statusCode < 500) {
			const body: ApiError = { error: codeForStatus(statusCode), message: error.message }
			if (error.code) body.details = { code: error.code }
			request.log.warn({ err: error }, 'request rejected')
			reply.status(statusCode).send(body)
			return
		}

		// Nothing above claimed it, so it is a defect: log the whole thing, tell the client nothing.
		request.log.error({ err: error }, 'unhandled error')
		reply.status(500).send({ error: 'internal_error', message: 'internal server error' })
	})

	app.setNotFoundHandler((request, reply) => {
		const body: ApiError = {
			error: 'not_found',
			message: `no route for ${request.method} ${request.url}`,
		}
		reply.status(404).send(body)
	})

	app.register(healthRoutes, { prefix: '/api' })
	app.register(authRoutes, { prefix: '/api' })

	return app
}
