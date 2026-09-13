// Gives an already-seeded database a track record, without re-publishing anything.
//
//   npm run seed:track-record
//   SEED_DEMO_SLUG=mom SEED_TICKS=1 npm run seed:track-record
//
// `npm run seed` runs this same phase at the end of its own run, so a cold seed already
// comes up record-ready. This entry point is for the database that is already seeded and
// has gone flat — after an anvil restart and a re-deploy, or when a recording needs a
// second strategy ticked.
//
// It binds the API port for the duration, because the phase is an HTTP client of the same
// routes the browser uses and because the enclave fetches its prices from
// `GET /api/oracle/prices`. Stop the backend before running it: two processes settling the
// same vault share one operator nonce and will collide.

import { closeDatabase, migrateToLatest } from '../db/index.js'
import { env } from '../lib/env.js'
import { buildServer } from '../server.js'
import { connectChain } from '../services.js'
import { strategyConfig } from '../strategy/config.js'
import { giveTrackRecord, trackRecordFromEnv } from './track-record.js'

const BASE = `http://${env.HOST}:${env.PORT}/api`

migrateToLatest()

const options = trackRecordFromEnv(BASE)
if (!options) {
	console.log('SEED_TRACK_RECORD=false — nothing to do')
	closeDatabase()
	process.exit(0)
}

const app = buildServer()
try {
	await app.listen({ port: env.PORT, host: env.HOST })
} catch (error) {
	console.error(
		`could not bind ${env.HOST}:${env.PORT} — stop the backend first, or run this with a different PORT`,
		error,
	)
	closeDatabase()
	process.exit(1)
}

console.log(`server on ${BASE}`)
console.log(`oracle for the enclave: ${strategyConfig.oracleUrl}`)

if (!(await connectChain(app.log))) {
	await app.close()
	closeDatabase()
	throw new Error('the chain is not usable — start anvil and run contracts/deploy-local.sh')
}

console.log(`\n── track record: ${options.slug} ──────────────────────────`)
try {
	const record = await giveTrackRecord(options)
	console.log(
		`\n${record.slug} funded with ${record.deposited} USDC and ticked ${record.outcomes.length}×; ${record.attestedTicks} of those ran in the enclave and ${record.settledTicks} settled a non-zero delta`,
	)
	console.log(`navPerShare ${record.navFrom} -> ${record.navTo}`)
	if (record.attestedTicks === 0) {
		console.warn('no tick reached the enclave, so the card will still read "awaiting attestation"')
		process.exitCode = 1
	}
	if (!record.navMoved) {
		console.warn(
			`${record.slug} never left ${record.navFrom}: the card will read a flat line and a total return of exactly zero. Raise SEED_MAX_TICKS, or fund a strategy that takes exposure more often.`,
		)
		process.exitCode = 1
	}
} catch (error) {
	console.error('the track record phase failed', error)
	process.exitCode = 1
} finally {
	await app.close()
	closeDatabase()
}
