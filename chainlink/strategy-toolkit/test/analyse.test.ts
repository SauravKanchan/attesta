import { describe, expect, test } from 'vitest'
import type { SanityCheck } from '../../../shared/types'
import { analyse } from '../src/index'
import {
	CALLS_EVAL,
	DYNAMIC_IMPORT,
	IMPORTS_FS,
	IMPORTS_FS_PROMISES,
	MINIMAL_STRATEGY,
	MISSING_EXPORT,
	shippedStrategies,
	SYNTAX_ERROR,
	TOP_LEVEL_SIDE_EFFECT,
	USES_FETCH,
} from './fixtures'

const byId = (checks: SanityCheck[], id: SanityCheck['id']): SanityCheck => {
	const check = checks.find((candidate) => candidate.id === id)
	if (!check) throw new Error(`no ${id} check in the result`)
	return check
}

describe('shipped strategies', () => {
	test.each(shippedStrategies())('%s passes every static check', (_label, source) => {
		const checks = analyse(source)
		expect(checks.map((check) => check.id)).toEqual([
			'parses',
			'required-exports',
			'forbidden-imports',
			'no-side-effects',
		])
		expect(checks.filter((check) => check.status !== 'passed')).toEqual([])
	})
})

describe('rejections', () => {
	const cases: Array<[string, string, SanityCheck['id'], RegExp]> = [
		["importing 'fs'", IMPORTS_FS, 'forbidden-imports', /"fs" is forbidden/],
		[
			"importing 'node:fs/promises'",
			IMPORTS_FS_PROMISES,
			'forbidden-imports',
			/"node:fs\/promises" is forbidden/,
		],
		['dynamic import()', DYNAMIC_IMPORT, 'forbidden-imports', /dynamic import/],
		['calling eval', CALLS_EVAL, 'no-side-effects', /"eval" is not allowed/],
		['calling fetch', USES_FETCH, 'no-side-effects', /"fetch" is not allowed/],
		[
			'work at module load',
			TOP_LEVEL_SIDE_EFFECT,
			'no-side-effects',
			/construction at module load|function call at module load/,
		],
		['a missing export', MISSING_EXPORT, 'required-exports', /missing onWithdraw/],
	]

	test.each(cases)('rejects %s', (_label, source, id, detail) => {
		const checks = analyse(source)
		const check = byId(checks, id)
		expect(check.status).toBe('failed')
		expect(check.detail).toMatch(detail)
	})

	test('a syntax error fails parsing and leaves the rest pending', () => {
		const checks = analyse(SYNTAX_ERROR)
		expect(byId(checks, 'parses').status).toBe('failed')
		expect(checks.slice(1).map((check) => check.status)).toEqual([
			'pending',
			'pending',
			'pending',
		])
	})

	test('the minimal fixture the broken ones derive from is itself clean', () => {
		expect(analyse(MINIMAL_STRATEGY).filter((check) => check.status !== 'passed')).toEqual([])
	})
})
