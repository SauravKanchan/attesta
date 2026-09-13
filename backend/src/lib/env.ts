import { z } from 'zod'
import { resolveFromRoot } from './paths.js'

const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	HOST: z.string().min(1).default('127.0.0.1'),
	PORT: z.coerce.number().int().min(1).max(65535).default(4000),
	DATABASE_URL: z.string().min(1).default('./data/attesta.db'),
	RPC_URL: z.string().url().default('http://127.0.0.1:8545'),
	CHAIN_ID: z.coerce.number().int().positive().default(31337),
	CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
	console.error('invalid environment', parsed.error.flatten().fieldErrors)
	throw new Error('invalid environment: see the field errors logged above')
}

const raw = parsed.data

export const env = {
	...raw,
	/** better-sqlite3 wants a filesystem path; tolerate the file: form drizzle-kit accepts. */
	databaseFile: resolveFromRoot(raw.DATABASE_URL.replace(/^file:/, '')),
	corsOrigins: raw.CORS_ORIGIN.split(',')
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0),
} as const
