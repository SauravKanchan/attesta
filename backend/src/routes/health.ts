import type { FastifyInstance } from 'fastify'
import { sqlite } from '../db/index.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
	app.get('/health', async (request, reply) => {
		let database = 'ok'
		try {
			sqlite.prepare('select 1').get()
		} catch (error) {
			database = 'error'
			request.log.error({ err: error }, 'database health check failed')
			reply.status(503)
		}
		return {
			status: database === 'ok' ? 'ok' : 'degraded',
			database,
			uptimeSeconds: Math.round(process.uptime()),
			t: new Date().toISOString(),
		}
	})
}
