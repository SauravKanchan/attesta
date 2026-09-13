// Working out which creator secrets a strategy actually reads.
//
// The Vault must declare an id before the enclave can ask for it, and the
// generated workflow treats an undeclared id as a fatal error rather than as
// the empty string the strategy contract promises. So before a workflow is
// generated the strategy is run in-process once per allocation branch and asked
// what it reaches for; those ids are what gets declared.
//
// This never sees a secret value. Values come from the caller, and locally the
// platform holds none — only ciphertext it cannot open.

import type { PriceSnapshot, StrategyModule } from '../../../shared/strategy-contract.js'
import { BPS, makeContext, probeContext } from '../../../chainlink/strategy-toolkit/src/index.js'
import { consoleLogger, type Logger } from './ports.js'

export interface SecretProbeOptions {
	/** Live prices, when the caller has them. Otherwise the toolkit's probe path is used. */
	prices?: PriceSnapshot[]
	history?: PriceSnapshot[][]
	now?: number
	totalAssets?: bigint
	logger?: Logger
}

export interface ProbeSeries {
	prices: PriceSnapshot[]
	history: PriceSnapshot[][]
}

/**
 * The toolkit's determinism probe path, widened to every declared asset: a
 * series that rises, stalls and falls, so a strategy gated behind a trend still
 * reaches the branch where it reads its parameters.
 */
export function probeSeries(assets: readonly string[]): ProbeSeries {
	const symbols = assets.length > 0 ? assets : ['ETH']
	const perSymbol = symbols.map((symbol) => probeContext(symbol))
	const depth = Math.min(...perSymbol.map((ctx) => ctx.history.length))

	const history: PriceSnapshot[][] = []
	for (let index = 0; index < depth; index++) {
		const snapshot: PriceSnapshot[] = []
		for (const ctx of perSymbol) snapshot.push(...(ctx.history[index] ?? []))
		history.push(snapshot)
	}

	return { prices: perSymbol.flatMap((ctx) => ctx.prices), history }
}

/**
 * Secret ids the strategy asks for, probed across the flat and the fully
 * allocated branch — a strategy that only reads its parameters once it holds
 * something would otherwise look secret-free until its first entry.
 */
export function discoverSecretIds(module: StrategyModule, options: SecretProbeOptions = {}): string[] {
	const logger = options.logger ?? consoleLogger
	const assets = module.describe().assets
	const series =
		options.prices && options.prices.length > 0
			? { prices: options.prices, history: options.history ?? [] }
			: probeSeries(assets)

	const requested = new Set<string>()
	const now = options.now ?? series.prices[0]?.t ?? Math.floor(Date.now() / 1000)
	const share = Math.floor(BPS / Math.max(1, assets.length))

	const branches: Array<Record<string, number>> = [
		{},
		Object.fromEntries(assets.map((symbol) => [symbol, share])),
	]

	for (const currentWeightsBps of branches) {
		const ctx = makeContext({
			now,
			totalAssets: options.totalAssets ?? 1_000_000_000n,
			prices: series.prices,
			history: series.history,
			currentWeightsBps,
			onMissingSecret: (id) => requested.add(id),
		})
		try {
			module.onTick(ctx)
		} catch (error) {
			// A throwing probe still reveals what it asked for before it threw, and
			// the pipeline's own checks decide whether the strategy is acceptable —
			// this is not the place to reject it.
			logger.warn({ err: error }, 'secret probe: onTick threw; keeping the ids it asked for first')
		}
	}

	return [...requested].sort()
}
