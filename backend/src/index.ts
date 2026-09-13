import { closeDatabase, migrateToLatest } from './db/index.js'
import { env } from './lib/env.js'
import { buildServer } from './server.js'

migrateToLatest()

const app = buildServer()

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true
	app.log.info({ signal }, 'shutting down')
	try {
		await app.close()
	} catch (error) {
		app.log.error({ err: error }, 'error while closing the server')
	}
	closeDatabase()
	process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		void shutdown(signal)
	})
}

process.on('unhandledRejection', (reason) => {
	app.log.error({ err: reason }, 'unhandled rejection')
})

process.on('uncaughtException', (error) => {
	app.log.fatal({ err: error }, 'uncaught exception')
	void shutdown('uncaughtException')
})

try {
	await app.listen({ port: env.PORT, host: env.HOST })
} catch (error) {
	app.log.fatal({ err: error }, 'failed to start')
	closeDatabase()
	process.exit(1)
}
