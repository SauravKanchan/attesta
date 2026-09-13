import { defineConfig } from 'drizzle-kit'
import { env } from './src/lib/env.js'

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url: env.databaseFile },
	strict: true,
	verbose: true,
})
