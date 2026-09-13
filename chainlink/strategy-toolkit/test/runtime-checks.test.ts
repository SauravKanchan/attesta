import { describe, expect, test } from 'vitest'
import { checkDescribe, checkDeterminism, loadStrategy } from '../src/index'
import { BAD_DESCRIBE, NON_DETERMINISTIC, shippedStrategies } from './fixtures'

describe('describe-valid', () => {
	test.each(shippedStrategies())('%s describes itself validly', (_label, source) => {
		expect(checkDescribe(loadStrategy(source))).toMatchObject({
			id: 'describe-valid',
			status: 'passed',
		})
	})

	test('rejects unusable metadata and says what is wrong', () => {
		const check = checkDescribe(loadStrategy(BAD_DESCRIBE))
		expect(check.status).toBe('failed')
		expect(check.detail).toMatch(/name must be a non-empty string/)
		expect(check.detail).toMatch(/ticker must be/)
		expect(check.detail).toMatch(/assets must be a non-empty array/)
		expect(check.detail).toMatch(/summary must be at least/)
	})
})

describe('deterministic', () => {
	test.each(shippedStrategies())('%s decides the same way twice', (_label, source) => {
		expect(checkDeterminism(loadStrategy(source))).toMatchObject({
			id: 'deterministic',
			status: 'passed',
		})
	})

	test('Math.random() in onTick fails the check', () => {
		const check = checkDeterminism(loadStrategy(NON_DETERMINISTIC))
		expect(check.status).toBe('failed')
		expect(check.detail).toMatch(/different decisions for the same context/)
	})
})
