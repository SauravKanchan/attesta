import { describe, expect, test } from 'vitest'
import { typecheck } from '../src/index'
import { MINIMAL_STRATEGY, MISSING_EXPORT, MISTYPED, shippedStrategies } from './fixtures'

describe('typecheck', () => {
	test.each(shippedStrategies())('%s typechecks against the contract', async (_label, source) => {
		const check = await typecheck(source)
		expect(check).toMatchObject({ id: 'typechecks', status: 'passed' })
	})

	test('the minimal fixture typechecks', async () => {
		expect((await typecheck(MINIMAL_STRATEGY)).status).toBe('passed')
	})

	test('a wrong onTick return type is a real tsc failure', async () => {
		const check = await typecheck(MISTYPED)
		expect(check.status).toBe('failed')
		expect(check.detail).toMatch(/strategy\.ts\(/)
	})

	// The conformance assertion is what turns "the file compiles" into "the
	// module is a StrategyModule", so a missing export has to surface here too
	// and not only in the static export check.
	test('a missing export fails the contract conformance assertion', async () => {
		const check = await typecheck(MISSING_EXPORT)
		expect(check.status).toBe('failed')
		expect(check.detail).toMatch(/StrategyModule/)
	})
})
