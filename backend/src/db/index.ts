import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { env } from '../lib/env.js'
import { MIGRATIONS_DIR } from '../lib/paths.js'
import * as schema from './schema.js'

mkdirSync(path.dirname(env.databaseFile), { recursive: true })

export const sqlite = new Database(env.databaseFile)

// WAL lets the scheduler write ticks while the API reads; the busy timeout absorbs the
// brief writer lock instead of throwing SQLITE_BUSY at a request.
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })

export type Db = typeof db

/** Brings the database up to date with drizzle/. Called on boot and by db:migrate. */
export function migrateToLatest(): void {
	try {
		migrate(db, { migrationsFolder: MIGRATIONS_DIR })
	} catch (error) {
		console.error('database migration failed', { migrationsFolder: MIGRATIONS_DIR, error })
		throw error
	}
}

export function closeDatabase(): void {
	try {
		sqlite.close()
	} catch (error) {
		console.error('failed to close the database cleanly', error)
	}
}

export { schema }
