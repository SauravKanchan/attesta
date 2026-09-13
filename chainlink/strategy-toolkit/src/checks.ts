// SanityCheck construction. The ids and their order are the pipeline in
// docs/build-plan.md, "Sanity pipeline" — a failure stops the rest, so the
// checks after a failure stay `pending` rather than being reported as passed.

import type { SanityCheck } from '../../../shared/types'

export type CheckId = SanityCheck['id']

export const CHECK_ORDER: readonly CheckId[] = [
	'parses',
	'required-exports',
	'forbidden-imports',
	'no-side-effects',
	'typechecks',
	'describe-valid',
	'deterministic',
	'cre-build',
	'cre-simulate',
] as const

export const CHECK_LABELS: Record<CheckId, string> = {
	parses: 'TypeScript parses',
	'required-exports': 'Exports the full strategy interface',
	'forbidden-imports': 'No forbidden module imports',
	'no-side-effects': 'No side effects at module load',
	typechecks: 'Typechecks against the strategy contract',
	'describe-valid': 'describe() returns valid metadata',
	deterministic: 'onTick() is deterministic',
	'cre-build': 'Compiles to a CRE workflow binary',
	'cre-simulate': 'Simulates inside the enclave',
}

export function makeCheck(
	id: CheckId,
	status: SanityCheck['status'],
	detail: string | null = null,
): SanityCheck {
	return { id, label: CHECK_LABELS[id], status, detail }
}

export const passed = (id: CheckId, detail: string | null = null): SanityCheck =>
	makeCheck(id, 'passed', detail)

export const failed = (id: CheckId, detail: string): SanityCheck => makeCheck(id, 'failed', detail)

export const pending = (id: CheckId, detail: string | null = null): SanityCheck =>
	makeCheck(id, 'pending', detail)

/** True when every check in the list reached `passed`. */
export const allPassed = (checks: readonly SanityCheck[]): boolean =>
	checks.length > 0 && checks.every((check) => check.status === 'passed')

/** First failure in the list, for a one-line summary. */
export const firstFailure = (checks: readonly SanityCheck[]): SanityCheck | null =>
	checks.find((check) => check.status === 'failed') ?? null
