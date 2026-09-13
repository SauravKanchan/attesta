// Wipes everything the seed is about to rebuild, so `npm run seed` always starts cold.
//
// It runs as its own process rather than as the first step of the seed: opening the
// database is a side effect of importing src/db/index.ts, and a file cannot be deleted
// from under a handle that is already holding it.

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { env } from '../lib/env.js'
import { strategyConfig } from '../strategy/config.js'

const targets = [
	env.databaseFile,
	`${env.databaseFile}-wal`,
	`${env.databaseFile}-shm`,
	strategyConfig.workspaceDir,
]

for (const target of targets) {
	if (!existsSync(target)) continue
	try {
		await rm(target, { recursive: true, force: true })
		console.info(`removed ${target}`)
	} catch (error) {
		console.error(`could not remove ${target}`, error)
		throw error
	}
}

console.info('reset complete')
