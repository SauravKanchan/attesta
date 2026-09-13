import { closeDatabase, migrateToLatest } from './db/index.js'
import { env } from './lib/env.js'
import { buildServer } from './server.js'
import { startServices, stopServices } from './services.js'

migrateToLatest()

const app = buildServer()

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true
	app.log.info({ signal }, 'shutting down')
	await stopServices(app.log)
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

// After listen, not before: a tick's enclave run fetches prices over HTTP from this very
// process, so the oracle route has to be accepting connections before the first tick can
// complete. A failure here must not take the API down with it — the loop is the thing that
// stops, and it says so.
try {
	await startServices(app.log)
} catch (error) {
	app.log.error({ err: error }, 'services failed to start: strategies will not tick')
}
