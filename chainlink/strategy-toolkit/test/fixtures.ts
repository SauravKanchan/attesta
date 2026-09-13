// Sources under test: the real template and examples from chainlink/templates,
// plus deliberately broken submissions, one per rule the pipeline enforces.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PriceSnapshot } from '../../../shared/strategy-contract'
import { buildPriceSeries, templatesDir } from '../src/index'

export const TEMPLATE_PATH = 'strategy.template.ts'
export const EXAMPLE_PATHS = [
	'examples/momentum.ts',
	'examples/mean-reversion.ts',
	'examples/overtrader.ts',
] as const

export const readTemplate = (relativePath: string): string =>
	readFileSync(join(templatesDir(), relativePath), 'utf8')

/** Every shipped strategy, as [label, source] for a parametrised test. */
export const shippedStrategies = (): Array<[string, string]> =>
	[TEMPLATE_PATH, ...EXAMPLE_PATHS].map((path) => [path, readTemplate(path)])

// ─── Broken submissions ─────────────────────────────────────────────────────

const HEADER = `import type { StrategyContext, StrategyDescription, TickDecision } from '@attesta/strategy-contract'
`

const ACCOUNTING = `
export {
	defaultBalanceOf as balanceOf,
	defaultOnDeposit as onDeposit,
	defaultOnWithdraw as onWithdraw,
	defaultTotalAssets as totalAssets,
} from '@attesta/strategy-contract'
`

const DESCRIBE = `
export const describe = (): StrategyDescription => ({
	name: 'Fixture',
	ticker: 'FIX',
	assets: ['ETH'],
	summary: 'A minimal strategy used as a test fixture, holding whatever it already holds.',
})
`

const ON_TICK = `
export const onTick = (ctx: StrategyContext): TickDecision => ({
	action: 'HOLD',
	targetWeightsBps: { ETH: ctx.currentWeightsBps.ETH ?? 0 },
	reason: 'fixture',
})
`

/** A submission that passes every check — the baseline the others deviate from. */
export const MINIMAL_STRATEGY = HEADER + ACCOUNTING + DESCRIBE + ON_TICK

export const IMPORTS_FS = `import { readFileSync } from 'fs'
${MINIMAL_STRATEGY}
`

export const IMPORTS_FS_PROMISES = `import { readFile } from 'node:fs/promises'
${MINIMAL_STRATEGY}
`

export const DYNAMIC_IMPORT =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	`
export const onTick = (ctx: StrategyContext): TickDecision => {
	void import('./elsewhere')
	return { action: 'HOLD', targetWeightsBps: {}, reason: 'fixture' }
}
`

export const CALLS_EVAL =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	`
export const onTick = (ctx: StrategyContext): TickDecision => {
	const bps = eval('5000') as number
	return { action: 'REBALANCE', targetWeightsBps: { ETH: bps }, reason: 'fixture' }
}
`

export const USES_FETCH =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	`
export const onTick = (ctx: StrategyContext): TickDecision => {
	void fetch('https://example.invalid/prices')
	return { action: 'HOLD', targetWeightsBps: {}, reason: 'fixture' }
}
`

/** onWithdraw is never exported, so the vault could not process a withdrawal. */
export const MISSING_EXPORT =
	HEADER +
	`
export {
	defaultBalanceOf as balanceOf,
	defaultOnDeposit as onDeposit,
	defaultTotalAssets as totalAssets,
} from '@attesta/strategy-contract'
` +
	DESCRIBE +
	ON_TICK

export const TOP_LEVEL_SIDE_EFFECT =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	ON_TICK +
	`
const startedAt = Number(new Date())
export const startupStamp = (): number => startedAt
`

export const SYNTAX_ERROR = `export const onTick = (ctx => {`

/** Passes every static check, then fails determinism on the second tick. */
export const NON_DETERMINISTIC =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	`
export const onTick = (ctx: StrategyContext): TickDecision => ({
	action: 'REBALANCE',
	targetWeightsBps: { ETH: Math.random() * 10000 },
	reason: 'coin flip',
})
`

/** Parses and exports everything, but onTick has the wrong return shape. */
export const MISTYPED =
	HEADER +
	ACCOUNTING +
	DESCRIBE +
	`
export const onTick = (ctx: StrategyContext): TickDecision => ({
	action: 'SELL_EVERYTHING',
	targetWeightsBps: { ETH: '5000' },
	reason: 42,
})
`

/** describe() returns metadata the marketplace cannot list. */
export const BAD_DESCRIBE =
	HEADER +
	ACCOUNTING +
	`
export const describe = (): StrategyDescription => ({
	name: '',
	ticker: 'not a ticker',
	assets: [],
	summary: 'short',
})
` +
	ON_TICK

// ─── Price series ───────────────────────────────────────────────────────────

/**
 * A deterministic walk. Seeded rather than random so a backtest assertion means
 * the same thing on every machine — the same property the oracle relies on.
 */
export function walk(options: {
	seed: number
	ticks: number
	drift: number
	vol: number
	/** Pull back towards the starting price each tick, 0..1. */
	reversion?: number
	start?: number
}): number[] {
	const start = options.start ?? 2000
	let seed = options.seed
	let price = start
	const next = (): number => {
		seed = (seed * 1103515245 + 12345) % 2147483648
		return seed / 2147483648
	}

	const prices: number[] = []
	for (let tick = 0; tick < options.ticks; tick++) {
		const pull = ((options.reversion ?? 0) * (start - price)) / start
		price *= 1 + options.drift + pull + (next() - 0.5) * options.vol
		prices.push(Number(price.toFixed(2)))
	}
	return prices
}

export const trendingSeries = (): PriceSnapshot[][] =>
	buildPriceSeries('ETH', walk({ seed: 7, ticks: 240, drift: 0.004, vol: 0.01 }))

export const choppySeries = (): PriceSnapshot[][] =>
	buildPriceSeries('ETH', walk({ seed: 3, ticks: 240, drift: 0, vol: 0.03, reversion: 0.35 }))
