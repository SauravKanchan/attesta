// The seeded price walk every return in the product ultimately derives from.
//
// Two properties are load-bearing.
//
// Determinism. The same seed gives the same series on every run, on every machine, so a
// simulation is reproducible — which is the whole basis of the attested-decision claim.
// Math.random() is therefore forbidden here, and so is any transcendental: exp, log and
// cos are implementation-defined in ECMAScript, while +, -, *, / and Math.round are
// exactly specified by IEEE 754. The walk is built from those alone, and the normal draw
// comes from summing twelve uniforms rather than from Box–Muller.
//
// Regimes. A pure Gaussian walk has no autocorrelation at any lag, which means a momentum
// strategy and a mean-reversion strategy both earn exactly nothing and every listing in
// the marketplace converges on the same flat line. So the walk carries a slowly-varying
// drift that switches between trending and choppy stretches: trends give momentum an
// edge, chop pulls price back to a moving anchor and gives mean reversion one.

export const ORACLE_SEED = 0x61_74_74_65

export const SYMBOLS = ['ETH', 'BTC', 'SOL'] as const

export type OracleSymbol = (typeof SYMBOLS)[number]

export type Regime = 'trending-up' | 'trending-down' | 'choppy'

/** One step of the walk is one minute, matching the scheduler's default tick. */
export const STEP_SECONDS = 60

interface SymbolConfig {
	symbol: OracleSymbol
	/** Price at step 0, in USDC. */
	start: number
	/** Standard deviation of a one-step return before the regime multiplier. */
	vol: number
	/** Per-step drift a trending regime pushes toward. */
	trend: number
}

const CONFIGS: readonly SymbolConfig[] = [
	{ symbol: 'ETH', start: 3_200, vol: 0.0018, trend: 0.000_28 },
	{ symbol: 'BTC', start: 64_000, vol: 0.0012, trend: 0.000_18 },
	{ symbol: 'SOL', start: 145, vol: 0.0027, trend: 0.000_42 },
]

interface RegimeConfig {
	regime: Regime
	/** Multiplier on the symbol's base volatility. */
	vol: number
	/** Sign of the drift the regime targets; 0 leaves the drift to decay to nothing. */
	direction: -1 | 0 | 1
	/** Per-step pull back toward the anchor. Only chop reverts; a trend must be free to run. */
	reversion: number
	minSteps: number
	maxSteps: number
}

// Trends outnumber chop two to one by weight but are individually shorter, so the series
// spends roughly half its life in each and neither strategy family wins everywhere.
const REGIMES: readonly RegimeConfig[] = [
	{ regime: 'trending-up', vol: 0.85, direction: 1, reversion: 0, minSteps: 150, maxSteps: 520 },
	{ regime: 'trending-down', vol: 0.95, direction: -1, reversion: 0, minSteps: 120, maxSteps: 420 },
	{ regime: 'choppy', vol: 1.45, direction: 0, reversion: 0.06, minSteps: 200, maxSteps: 640 },
]

const REGIME_WEIGHTS = [0.38, 0.24, 0.38] as const

/** How fast the drift relaxes toward the regime's target. Small, so drift varies slowly. */
const DRIFT_RELAX = 0.02

/** EMA weight of the anchor chop reverts toward — roughly a ninety-minute mean. */
const ANCHOR_ALPHA = 1 / 90

/** A single step may not move price more than this, so no draw can blow the series up. */
const MAX_STEP_RETURN = 0.05

/** Prices stay inside this band around their start, so the walk cannot wander to zero. */
const MIN_PRICE_RATIO = 0.2
const MAX_PRICE_RATIO = 5

export const PRICE_SCALE = 1_000_000

/**
 * mulberry32. Integer mixing plus one division by 2^32 — every operation exactly
 * specified, so the stream is identical everywhere.
 */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
	}
}

/** FNV-1a, so each symbol gets its own stream from one seed without a table of magic numbers. */
export function seedFor(seed: number, symbol: string): number {
	let hash = (0x81_1c_9d_c5 ^ seed) >>> 0
	for (let i = 0; i < symbol.length; i += 1) {
		hash = (hash ^ symbol.charCodeAt(i)) >>> 0
		hash = Math.imul(hash, 0x01_00_01_93) >>> 0
	}
	return hash >>> 0
}

/**
 * Irwin–Hall: the sum of twelve uniforms has mean 6 and variance 1, so subtracting 6 gives
 * a standard normal truncated at ±6. Arithmetic only, unlike Box–Muller.
 */
function gaussian(random: () => number): number {
	let total = 0
	for (let i = 0; i < 12; i += 1) total += random()
	return total - 6
}

function clamp(value: number, low: number, high: number): number {
	if (value < low) return low
	if (value > high) return high
	return value
}

function pickRegime(random: () => number): RegimeConfig {
	const roll = random()
	let cumulative = 0
	for (let i = 0; i < REGIMES.length; i += 1) {
		cumulative += REGIME_WEIGHTS[i] ?? 0
		if (roll < cumulative) return REGIMES[i] as RegimeConfig
	}
	return REGIMES[REGIMES.length - 1] as RegimeConfig
}

class SymbolWalk {
	readonly symbol: OracleSymbol
	private readonly config: SymbolConfig
	private readonly random: () => number
	private price: number
	private anchor: number
	private drift = 0
	private regime: RegimeConfig
	private regimeStepsLeft: number

	constructor(config: SymbolConfig, seed: number) {
		this.config = config
		this.symbol = config.symbol
		this.random = mulberry32(seedFor(seed, config.symbol))
		this.price = config.start
		this.anchor = config.start
		this.regime = pickRegime(this.random)
		this.regimeStepsLeft = this.drawRegimeLength(this.regime)
	}

	private drawRegimeLength(regime: RegimeConfig): number {
		const span = regime.maxSteps - regime.minSteps
		return regime.minSteps + Math.floor(this.random() * (span + 1))
	}

	currentRegime(): Regime {
		return this.regime.regime
	}

	currentPrice(): number {
		return this.price
	}

	advance(): number {
		if (this.regimeStepsLeft <= 0) {
			this.regime = pickRegime(this.random)
			this.regimeStepsLeft = this.drawRegimeLength(this.regime)
		}
		this.regimeStepsLeft -= 1

		// Compounding a symmetric return series drifts down by half its variance per step,
		// so the regime's target drift carries that back out: chop is then genuinely
		// directionless instead of quietly bleeding.
		const sigma = this.config.vol * this.regime.vol
		const targetDrift = this.config.trend * this.regime.direction + 0.5 * sigma * sigma
		this.drift += DRIFT_RELAX * (targetDrift - this.drift)

		const shock = sigma * gaussian(this.random)
		const pull = this.regime.reversion * (this.anchor / this.price - 1)
		const step = clamp(this.drift + shock + pull, -MAX_STEP_RETURN, MAX_STEP_RETURN)

		this.price = clamp(
			this.price * (1 + step),
			this.config.start * MIN_PRICE_RATIO,
			this.config.start * MAX_PRICE_RATIO,
		)
		this.anchor += ANCHOR_ALPHA * (this.price - this.anchor)
		return this.price
	}
}

export interface WalkPrice {
	symbol: OracleSymbol
	/** USDC per unit, 6dp base units. */
	price: bigint
	regime: Regime
}

export interface WalkStep {
	/** Zero-based index into the walk. Step 0 is the configured starting price. */
	step: number
	prices: WalkPrice[]
}

/** 6dp base units. Math.round is exactly specified, so the rounding is reproducible too. */
export function toBaseUnits(price: number): bigint {
	return BigInt(Math.round(price * PRICE_SCALE))
}

export function fromBaseUnits(price: bigint): number {
	return Number(price) / PRICE_SCALE
}

/**
 * The walk itself. Stateful and forward-only: `advance()` yields step 0 (the starting
 * prices) first, then one step per call.
 */
export class PriceWalk {
	private readonly walks: SymbolWalk[]
	private index = -1

	constructor(seed: number = ORACLE_SEED) {
		this.walks = CONFIGS.map((config) => new SymbolWalk(config, seed))
	}

	/** Index of the last step produced, or -1 before the first call to `advance()`. */
	get step(): number {
		return this.index
	}

	advance(): WalkStep {
		const first = this.index === -1
		this.index += 1
		const prices = this.walks.map((walk) => {
			const price = first ? walk.currentPrice() : walk.advance()
			return { symbol: walk.symbol, price: toBaseUnits(price), regime: walk.currentRegime() }
		})
		return { step: this.index, prices }
	}
}

/**
 * Every step from 0 to `count - 1`. O(count), which is why callers that only need the next
 * step keep a `PriceWalk` around rather than recomputing the prefix.
 */
export function walkSteps(count: number, seed: number = ORACLE_SEED): WalkStep[] {
	const walk = new PriceWalk(seed)
	const steps: WalkStep[] = []
	for (let i = 0; i < count; i += 1) steps.push(walk.advance())
	return steps
}
