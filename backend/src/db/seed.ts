// Seeds only what a fresh database cannot derive: the chain coordinates the later deploy
// step writes into. Strategies, positions and NAV history are never seeded — they exist
// because a submission was published and the scheduler ran, or they do not exist.

import { env } from '../lib/env.js'
import { closeDatabase, db, migrateToLatest } from './index.js'
import { deployments } from './schema.js'

migrateToLatest()

const rows = [
	{ key: 'chainId', value: String(env.CHAIN_ID) },
	{ key: 'rpcUrl', value: env.RPC_URL },
]

try {
	for (const row of rows) {
		db.insert(deployments)
			.values(row)
			.onConflictDoUpdate({
				target: deployments.key,
				set: { value: row.value, updatedAt: new Date() },
			})
			.run()
	}
	console.info(`seeded deployments: ${rows.map((r) => `${r.key}=${r.value}`).join(' ')}`)
} catch (error) {
	console.error('seed failed', error)
	closeDatabase()
	process.exitCode = 1
	throw error
}

closeDatabase()
