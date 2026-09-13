/**
 * The pre-flight list the review step renders before the backend has said anything.
 *
 * The pipeline is the backend's; these are display scaffolding so the nine rows exist
 * as soon as the step opens rather than appearing one at a time out of nowhere. Once
 * `POST /submissions/:id/check` starts streaming, its checks replace these wholesale —
 * including their labels, which are the pipeline's to name.
 *
 * The record is keyed by `SanityCheck['id']`, so adding a check to the shared contract
 * fails this file to compile rather than dropping a row silently.
 */

import type { SanityCheck } from '@/lib/types'

type CheckId = SanityCheck['id']

const CHECK_LABELS: Record<CheckId, string> = {
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

/** Pipeline order, from docs/build-plan.md. A failure stops the rest. */
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
]

/** What each check is actually proving, for the row's second line. */
export const CHECK_RATIONALE: Record<CheckId, string> = {
	parses: 'The source is valid TypeScript before anything touches it.',
	'required-exports': 'The marketplace can read balances and settle withdrawals against your code.',
	'forbidden-imports': 'No filesystem, process or network module reaches the builder.',
	'no-side-effects': 'Nothing runs at import time — only the functions the runtime calls.',
	typechecks: 'The signatures match shared/strategy-contract.ts exactly.',
	'describe-valid': 'Name, ticker and declared assets are present and well formed.',
	deterministic: 'The same context twice returns the same decision, so consensus can compare it.',
	'cre-build': 'The workflow compiles, and its hash becomes the strategy identity.',
	'cre-simulate': 'A real run produces a parseable decision inside the enclave.',
}

export function pendingChecks(): SanityCheck[] {
	return CHECK_ORDER.map((id) => ({ id, label: CHECK_LABELS[id], status: 'pending', detail: null }))
}

export const allChecksPassed = (checks: readonly SanityCheck[]): boolean =>
	checks.length === CHECK_ORDER.length && checks.every((check) => check.status === 'passed')

export const firstFailedCheck = (checks: readonly SanityCheck[]): SanityCheck | null =>
	checks.find((check) => check.status === 'failed') ?? null
