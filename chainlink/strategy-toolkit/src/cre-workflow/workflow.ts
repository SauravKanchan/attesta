// Generated CRE confidential workflow. One of these is produced per strategy by
// buildWorkflow(); the creator's source is copied in beside it as strategy.ts.
//
// Shape follows chainlink/strategy-runner/workflow.ts: a cron trigger whose
// handler is registered with cre.handlerInTee, so the Workflow DON hands
// execution to an AWS Nitro enclave instead of running the callback on a node.
// Inside the enclave it reads the creator's parameters from the Vault DON,
// fetches prices over the enclave's own HTTP client, calls the strategy's
// onTick, and crosses back to the DON to sign the decision.
//
// This file is not edited by creators and is not part of the toolkit's own
// TypeScript project — it is compiled by `cre workflow build` in the generated
// directory, against the CRE SDK.

import { cre, hexToBase64, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { describe, onTick } from './strategy'
import type { PriceSnapshot, StrategyContext, TickDecision } from './strategy-contract'

export const configSchema = z.object({
	schedule: z.string(),
	oracleUrl: z.string(),
	secretNamespace: z.string(),
	/** Strategy secret id -> the id actually provisioned in the Vault. */
	secretAliases: z.record(z.string(), z.string()),
	/** USDC under management, 6dp, as a decimal-free integer string. */
	totalAssets: z.string(),
	currentWeightsBps: z.record(z.string(), z.number()),
})
type Config = z.infer<typeof configSchema>

/** Marker the toolkit greps for in simulator output to recover the decision. */
const DECISION_PREFIX = 'attesta-decision:'

const NUMERIC = /^-?[0-9]*\.?[0-9]+$/

/** Decimal price to the 6dp bigint the strategy contract carries. */
function toPrice6(value: unknown): bigint | null {
	if (typeof value === 'bigint') return value
	const raw =
		typeof value === 'number'
			? value.toFixed(6)
			: typeof value === 'string'
				? value.trim()
				: null
	if (raw === null || raw.length === 0 || !NUMERIC.test(raw)) return null

	const negative = raw.charAt(0) === '-'
	const unsigned = negative ? raw.slice(1) : raw
	const dot = unsigned.indexOf('.')
	const whole = dot === -1 ? unsigned : unsigned.slice(0, dot)
	const fraction = dot === -1 ? '' : unsigned.slice(dot + 1)
	const scaled =
		BigInt(whole === '' ? '0' : whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6))
	return negative ? -scaled : scaled
}

/**
 * The oracle payload shape is owned by the backend, so this reads defensively:
 * a list of {symbol, price} entries, a {SYM: price} map, or either of those
 * wrapped in a {t, prices} envelope. Anything it cannot find a declared asset
 * in is an error, not a silent zero.
 */
function snapshotOf(raw: unknown, assets: string[], fallbackT: number): PriceSnapshot[] {
	if (raw === null || raw === undefined) return []

	if (Array.isArray(raw)) {
		const out: PriceSnapshot[] = []
		for (const entry of raw) {
			if (entry === null || typeof entry !== 'object') continue
			const record = entry as Record<string, unknown>
			const symbol = typeof record.symbol === 'string' ? record.symbol : null
			if (symbol === null || assets.indexOf(symbol) === -1) continue
			const price = toPrice6(record.price)
			if (price === null) continue
			out.push({ symbol, price, t: typeof record.t === 'number' ? record.t : fallbackT })
		}
		return out
	}

	if (typeof raw !== 'object') return []
	const record = raw as Record<string, unknown>

	if (record.prices !== undefined) {
		const t = typeof record.t === 'number' ? record.t : fallbackT
		return snapshotOf(record.prices, assets, t)
	}

	const out: PriceSnapshot[] = []
	for (const symbol of assets) {
		const value = record[symbol]
		const nested =
			value !== null && typeof value === 'object'
				? (value as Record<string, unknown>).price
				: value
		const price = toPrice6(nested)
		if (price === null) continue
		out.push({ symbol, price, t: fallbackT })
	}
	return out
}

interface OracleReading {
	t: number
	prices: PriceSnapshot[]
	history: PriceSnapshot[][]
}

function parseOracle(body: string, assets: string[]): OracleReading {
	const payload = JSON.parse(body) as Record<string, unknown>

	// Unix seconds. A non-numeric timestamp is dropped rather than parsed with
	// Date, which would put a clock inside a handler that has to be reproducible.
	const rawT = payload.t
	const t =
		typeof rawT === 'number'
			? Math.floor(rawT)
			: typeof rawT === 'string' && NUMERIC.test(rawT.trim())
				? Math.floor(Number(rawT))
				: 0

	const prices = snapshotOf(payload.prices !== undefined ? payload.prices : payload, assets, t)
	if (prices.length === 0) {
		throw new Error('oracle returned no price for any of: ' + assets.join(', '))
	}

	const history: PriceSnapshot[][] = []
	if (Array.isArray(payload.history)) {
		for (const entry of payload.history) {
			const snapshot = snapshotOf(entry, assets, t)
			if (snapshot.length > 0) history.push(snapshot)
		}
	}

	return { t, prices, history }
}

function readSecret(runtime: TeeRuntime<Config>, id: string): string {
	const config = runtime.config
	const vaultId = config.secretAliases[id] !== undefined ? config.secretAliases[id] : id
	try {
		return runtime.getSecret({ id: vaultId, namespace: config.secretNamespace }).result().value
	} catch (error) {
		// The id and the failure, never the value.
		runtime.log('secret ' + vaultId + ' could not be released into the enclave: ' + String(error))
		throw error
	}
}

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config
	const assets = describe().assets

	// The TeeRuntime overload runs the request from inside the enclave, so the
	// oracle response the decision is made on stays confidential from node
	// operators. ConfidentialHTTPClient has no TeeRuntime overload; do not swap.
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, { url: config.oracleUrl, method: 'GET' })
		.result()

	if (!ok(response)) {
		throw new Error('oracle request failed with status: ' + response.statusCode)
	}

	const reading = parseOracle(text(response), assets)

	const ctx: StrategyContext = {
		now: reading.t,
		totalAssets: BigInt(config.totalAssets),
		prices: reading.prices,
		history: reading.history,
		currentWeightsBps: config.currentWeightsBps,
		getSecret: (id: string): string => readSecret(runtime, id),
		log: (message: string): void => {
			runtime.log(message)
		},
	}

	const decision: TickDecision = onTick(ctx)

	// ⚠️ Simulation only. Enclave logs must be removed before a production
	// deploy — see chainlink/SETUP.md. The scheduler lifts the decision out of
	// this line because `cre workflow simulate` JSON-escapes the return value.
	runtime.log(DECISION_PREFIX + JSON.stringify(decision))

	// Cross back for consensus. Only the action and the reason go over: not the
	// secrets, not the oracle payload.
	const donRuntime = runtime.usingTheDons()
	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('string action, string reason'),
		[decision.action, decision.reason],
	)
	donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	return DECISION_PREFIX + JSON.stringify(decision)
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	// AWS Nitro in us-west-2 is the only registered TEE type and region today.
	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
