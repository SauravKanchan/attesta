import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The compiled tree nests one level deeper than the source tree (dist/backend/src/...),
// so anchor on the nearest package.json rather than a fixed number of parent hops.
function findBackendRoot(start: string): string {
	let dir = start
	for (;;) {
		if (existsSync(path.join(dir, 'package.json'))) return dir
		const parent = path.dirname(dir)
		if (parent === dir) throw new Error(`could not locate the backend root from ${start}`)
		dir = parent
	}
}

export const BACKEND_ROOT = findBackendRoot(path.dirname(fileURLToPath(import.meta.url)))

/** Where drizzle-kit writes generated SQL. Read at boot to bring the database up to date. */
export const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'drizzle')

export function resolveFromRoot(target: string): string {
	return path.isAbsolute(target) ? target : path.resolve(BACKEND_ROOT, target)
}
