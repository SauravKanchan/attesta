// The price feed the strategy reads from inside the enclave.
//
// This is the one route whose primary caller is not a browser: the generated CRE workflow
// GETs it over the enclave's own HTTP client on every tick, decides its weights against
// what comes back, and the scheduler then prices that decision against the same series.
// So it is unauthenticated — an enclave carries no session — and it does nothing but read
// the walk the oracle has already persisted.
//
// The payload shape belongs to the workflow's parser (`parseOracle` in
// chainlink/strategy-toolkit/src/cre-workflow/workflow.ts): `{ t, prices, history }`, with
// `t` in unix seconds and every price a 6dp decimal string. `history` is what a strategy
// with a lookback — a moving average, a z-score — needs in order to decide anything at
// all, so it travels with the snapshot rather than behind a second request the enclave
// would have to make.

import type { FastifyInstance } from 'fastify'
import type { PriceSnapshot } from '../../../shared/strategy-contract.js'
import { formatAmount } from '../lib/money.js'
import { getOraclePort } from '../services.js'

/** One symbol's price at one instant. `t` is unix seconds, as the strategy contract carries it. */
interface OraclePriceBody {
	symbol: string
	/** USDC per unit, 6dp decimal string. */
	price: string
	t: number
}

interface OracleSnapshotBody {
	/** Unix seconds for the newest tick. */
	t: number
	prices: OraclePriceBody[]
	/** Prior snapshots, oldest first, excluding the newest. */
	history: OraclePriceBody[][]
}

const toBody = (prices: readonly PriceSnapshot[]): OraclePriceBody[] =>
	prices.map((price) => ({ symbol: price.symbol, price: formatAmount(price.price.toString()), t: price.t }))

export async function oracleRoutes(app: FastifyInstance): Promise<void> {
	app.get('/oracle/prices', async (request): Promise<OracleSnapshotBody> => {
		// Reads the newest persisted tick; it never advances the walk. Only the scheduler
		// steps the oracle, so two strategies simulating at once see the same prices rather
		// than each pulling the series forward under the other.
		const snapshot = await getOraclePort(request.log).snapshot()
		return {
			t: snapshot.t,
			prices: toBody(snapshot.prices),
			history: snapshot.history.map(toBody),
		}
	})
}
