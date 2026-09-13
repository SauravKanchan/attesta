// The two checks that need the strategy actually loaded: does describe() return
// usable metadata, and does onTick() give the same answer twice.

import type { StrategyDescription, StrategyModule } from '../../../shared/strategy-contract'
import type { SanityCheck } from '../../../shared/types'
import { failed, passed } from './checks'
import { probeContext, stableSerialise } from './context'

const TICKER_PATTERN = /^[A-Z0-9]{2,10}$/
const ASSET_PATTERN = /^[A-Z0-9]{1,12}$/
const MAX_NAME = 64
const MIN_SUMMARY = 20
const MAX_SUMMARY = 400

function validateDescription(description: unknown): string[] {
	const errors: string[] = []

	if (typeof description !== 'object' || description === null) {
		return ['describe() must return an object']
	}

	const { name, ticker, assets, summary } = description as Partial<StrategyDescription>

	if (typeof name !== 'string' || name.trim().length === 0) errors.push('name must be a non-empty string')
	else if (name.length > MAX_NAME) errors.push(`name must be at most ${MAX_NAME} characters`)

	if (typeof ticker !== 'string' || !TICKER_PATTERN.test(ticker)) {
		errors.push('ticker must be 2-10 uppercase letters or digits')
	}

	// `assets` is load-bearing: the vault's spending policy is derived from it,
	// so an empty or sloppy list is a real failure, not a cosmetic one.
	if (!Array.isArray(assets) || assets.length === 0) {
		errors.push('assets must be a non-empty array of symbols')
	} else {
		const seen = new Set<string>()
		for (const asset of assets) {
			if (typeof asset !== 'string' || !ASSET_PATTERN.test(asset)) {
				errors.push(`asset ${JSON.stringify(asset)} must be 1-12 uppercase letters or digits`)
			} else if (seen.has(asset)) {
				errors.push(`asset ${asset} is listed twice`)
			} else {
				seen.add(asset)
			}
		}
		if (assets.includes('USDC')) errors.push('USDC is the denominating asset and is implicit')
	}

	if (typeof summary !== 'string' || summary.trim().length < MIN_SUMMARY) {
		errors.push(`summary must be at least ${MIN_SUMMARY} characters`)
	} else if (summary.length > MAX_SUMMARY) {
		errors.push(`summary must be at most ${MAX_SUMMARY} characters`)
	}

	return errors
}

export function checkDescribe(mod: StrategyModule): SanityCheck {
	let description: StrategyDescription
	try {
		description = mod.describe()
	} catch (error) {
		return failed('describe-valid', `describe() threw: ${errorText(error)}`)
	}

	const errors = validateDescription(description)
	if (errors.length > 0) return failed('describe-valid', errors.join('; '))

	return passed(
		'describe-valid',
		`${description.name} (${description.ticker}) holding ${description.assets.join(', ')}`,
	)
}

export function checkDeterminism(mod: StrategyModule): SanityCheck {
	const ctx = probeContext()

	let first: string
	let second: string
	try {
		first = stableSerialise(mod.onTick(ctx))
		second = stableSerialise(mod.onTick(ctx))
	} catch (error) {
		return failed('deterministic', `onTick() threw: ${errorText(error)}`)
	}

	if (first !== second) {
		return failed(
			'deterministic',
			`onTick() returned different decisions for the same context: ${first} then ${second}`,
		)
	}

	return passed('deterministic', 'onTick() returned the same decision twice')
}

export function errorText(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
