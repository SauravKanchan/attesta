import { closeDatabase, migrateToLatest, sqlite } from './index.js'

migrateToLatest()
const tables = sqlite
	.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
	.all() as Array<{ name: string }>

console.info(`migrations applied — ${tables.length} tables: ${tables.map((t) => t.name).join(', ')}`)
closeDatabase()
