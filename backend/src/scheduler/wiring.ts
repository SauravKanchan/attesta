// Wiring the ports onto the real chain and oracle modules.
//
// The tick loop and the publish step are written against interfaces so they can
// be driven against a fake; this is the one file that knows the concrete
// modules exist. The entry point calls createScheduler(defaultDeps()) and the
// submission route calls publishSubmission({ chain: chainPort(), ... }).

import type { Address } from 'viem'
import * as chain from '../chain/index.js'
import * as oracleModule from '../oracle/index.js'
import { consoleLogger, type ChainPort, type Logger } from '../strategy/ports.js'
import { schedulerConfig } from './config.js'
import type { OraclePort, OracleSnapshot } from './ports.js'
import type { TickDeps } from './tick.js'

/** The vault, registry and wallet calls the strategy subsystem needs, as one object. */
export function chainPort(): ChainPort {
	return {
		async deployVault({ name, operator }) {
			const deployed = await chain.vault.deployVault(name, operator)
			return { vaultAddress: deployed.address, txHash: deployed.txHash }
		},

		async fundReserve({ vaultAddress, amount }) {
			// The vault pulls the USDC, so the platform float has to approve it first.
			await chain.usdc.ensureAllowance(vaultAddress, amount, chain.deployerAccount)
			return { txHash: await chain.vault.fundReserve(vaultAddress, amount) }
		},

		async registerStrategy({ strategyId, vaultAddress, binaryHash, creator }) {
			const txHash = await chain.registry.register({
				strategyId,
				vault: vaultAddress,
				binaryHash,
				creator,
			})
			return { txHash }
		},

		isStrategyRegistered: (strategyId) => chain.registry.isRegistered(strategyId),

		async fundGas({ address, minWei }) {
			const txHash = await chain.wallets.ensureGas(address, { minimum: minWei })
			return txHash === null ? null : { txHash }
		},

		readVault: (vaultAddress) => chain.vault.vaultTotals(vaultAddress),

		async applyPnl({ vaultAddress, operatorKey, delta }) {
			const account = chain.wallets.accountFromKey(operatorKey)
			const result = await chain.vault.applyPnl(vaultAddress, delta, account)
			return { txHash: result.txHash }
		},

		async recordTrade({ vaultAddress, operatorKey, pair, isBuy, size, price, pnl }) {
			const account = chain.wallets.accountFromKey(operatorKey)
			const txHash = await chain.vault.recordTrade(
				vaultAddress,
				{ pair, isBuy, size, price, pnl },
				account,
			)
			return { txHash }
		},
	}
}

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

/** The address the platform float is held by, for a caller that needs to fund something. */
export const platformAddress = (): Address => chain.deployerAccount.address
