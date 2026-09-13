// Wiring the tick loop's ports onto the real modules.
//
// The oracle adapter lives here because the shape it has to produce — seconds,
// newest snapshot separate from history — belongs to the tick loop rather than
// to the oracle. The chain adapter lives with the chain layer, in
// backend/src/chain/port.ts, and is re-exported so a caller still wires one
// module rather than two.

import { createChainPort } from '../chain/port.js'
import * as oracleModule from '../oracle/index.js'
import { consoleLogger, type ChainPort, type Logger } from '../strategy/ports.js'
import { schedulerConfig } from './config.js'
import type { OraclePort, OracleSnapshot } from './ports.js'
import type { TickDeps } from './tick.js'

export { platformAddress } from '../chain/port.js'

/** The concrete ChainPort, over the viem clients in backend/src/chain/. */
export const chainPort = (): ChainPort => createChainPort()

/**
 * The oracle module carries timestamps in milliseconds and the strategy contract
 * carries them in seconds, so the conversion happens here, once, using the
 * oracle's own boundary helpers. `history` excludes the newest snapshot: it is
 * the prior ticks, and the newest is `prices`.
 */
export function oraclePort(): OraclePort {
	const read = (
		snapshot: oracleModule.OracleSnapshot,
		options?: { symbols?: readonly string[]; historyLimit?: number },
	): OracleSnapshot => {
		const symbols = options?.symbols ?? snapshot.prices.map((price) => price.symbol)
		const limit = options?.historyLimit ?? schedulerConfig.historyLimit
		const series = oracleModule.seriesFor(symbols, limit + 1)
		const prior = series.filter((entry) => (entry[0]?.t ?? 0) < snapshot.t)
		return {
			t: Math.floor(snapshot.t / 1_000),
			prices: oracleModule.toPriceSnapshots(
				snapshot.prices.filter((price) => symbols.includes(price.symbol)),
			),
			history: oracleModule.toPriceSnapshotSeries(prior.slice(-limit)),
		}
	}

	return {
		async advance(options) {
			return read(oracleModule.tick(), options)
		},
		async snapshot(options) {
			return read(oracleModule.current(), options)
		},
	}
}

/** Everything a scheduler needs, wired to the real modules. */
export function defaultDeps(logger: Logger = consoleLogger): TickDeps {
	return { chain: chainPort(), oracle: oraclePort(), logger }
}

