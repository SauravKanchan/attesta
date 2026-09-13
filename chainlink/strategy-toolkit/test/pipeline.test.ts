import { describe, expect, test } from 'vitest'
import { CHECK_ORDER, runPipeline } from '../src/index'
import { IMPORTS_FS, NON_DETERMINISTIC, readTemplate, TEMPLATE_PATH } from './fixtures'

// skipCre keeps these to the fast path; the cre steps have their own test file.
describe('runPipeline', () => {
	test('reports every check in pipeline order', async () => {
		const result = await runPipeline(readTemplate(TEMPLATE_PATH), { skipCre: true })
		expect(result.checks.map((check) => check.id)).toEqual([...CHECK_ORDER])
	})

	test('the template clears everything up to the cre steps', async () => {
		const result = await runPipeline(readTemplate(TEMPLATE_PATH), { skipCre: true })
		const upToCre = result.checks.filter((check) => !check.id.startsWith('cre-'))
		expect(upToCre.filter((check) => check.status !== 'passed')).toEqual([])
		expect(result.module?.describe().ticker).toBe('XOVR')
	})

	test('a failure stops the rest', async () => {
		const result = await runPipeline(IMPORTS_FS, { skipCre: true })
		const statuses = Object.fromEntries(result.checks.map((check) => [check.id, check.status]))
		expect(statuses['forbidden-imports']).toBe('failed')
		expect(statuses.typechecks).toBe('pending')
		expect(statuses['cre-simulate']).toBe('pending')
		expect(result.module).toBeNull()
	})

	test('runs far enough to catch non-determinism', async () => {
		const result = await runPipeline(NON_DETERMINISTIC, { skipCre: true })
		const statuses = Object.fromEntries(result.checks.map((check) => [check.id, check.status]))
		expect(statuses.typechecks).toBe('passed')
		expect(statuses['describe-valid']).toBe('passed')
		expect(statuses.deterministic).toBe('failed')
		expect(statuses['cre-build']).toBe('pending')
	})
})
