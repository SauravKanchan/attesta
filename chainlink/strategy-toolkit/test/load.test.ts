import { describe, expect, test } from 'vitest'
import type { StrategyContext } from '../../../shared/strategy-contract'
import { loadStrategy, loadStrategyVerbose } from '../src/index'
import { MINIMAL_STRATEGY, MISSING_EXPORT, shippedStrategies } from './fixtures'

/** onTick in the fixtures only reads currentWeightsBps. */
const EMPTY_CONTEXT = { currentWeightsBps: {} } as unknown as StrategyContext

const wrapOnTick = (body: string): string =>
	MINIMAL_STRATEGY.replace(
		"\treason: 'fixture',",
		`\treason: ${body},`,
	)

describe('loadStrategy', () => {
	test.each(shippedStrategies())('%s loads with all six exports', (_label, source) => {
		const mod = loadStrategy(source)
		for (const name of ['describe', 'onTick', 'balanceOf', 'totalAssets', 'onDeposit', 'onWithdraw'] as const) {
			expect(typeof mod[name]).toBe('function')
		}
	})

	test('re-exported accounting defaults work inside the sandbox', () => {
		const mod = loadStrategy(MINIMAL_STRATEGY)
		expect(mod.onDeposit({ totalAssets: 0n, totalShares: 0n }, 500n)).toEqual({
			shares: 500n,
			assets: 500n,
		})
		expect(mod.balanceOf({ shares: 50n }, { totalAssets: 200n, totalShares: 100n })).toBe(100n)
	})

	test('refuses a module that is missing a required export', () => {
		expect(() => loadStrategy(MISSING_EXPORT)).toThrow(/missing required exports: onWithdraw/)
	})
})

describe('sandbox isolation', () => {
	// These are the reason the loader exists: the module body and onTick both
	// run, so whatever is reachable from inside the context is what a submission
	// gets. Not a security boundary — see the comment in src/load.ts — but the
	// host's globals genuinely are not in it.
	test.each(['process', 'fetch', 'setTimeout', 'XMLHttpRequest', 'Buffer'])(
		'%s is not reachable from a strategy',
		(name) => {
			const mod = loadStrategy(wrapOnTick(`typeof ${name} === 'undefined' ? 'absent' : 'present'`))
			expect(mod.onTick(EMPTY_CONTEXT).reason).toBe('absent')
		},
	)

	test('code generation from strings is disabled', () => {
		const mod = loadStrategy(wrapOnTick("(() => { try { return String(eval('1')) } catch (error) { return 'blocked' } })()"))
		expect(mod.onTick(EMPTY_CONTEXT).reason).toBe('blocked')
	})

	test('importing anything but the strategy contract fails inside the sandbox', () => {
		const source = `import { join } from 'node:path'\n${MINIMAL_STRATEGY}\nexport const usesJoin = (): string => join('a', 'b')\n`
		expect(() => loadStrategy(source)).toThrow(/not available inside the strategy sandbox/)
	})

	test('console output is captured rather than written to the host', () => {
		const source = MINIMAL_STRATEGY.replace(
			'export const describe',
			"console.log('loaded')\nexport const describe",
		)
		expect(loadStrategyVerbose(source).logs).toEqual(['loaded'])
	})
})
