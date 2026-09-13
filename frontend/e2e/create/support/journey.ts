import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { EXAMPLES_DIR, TIMING_LOG } from '../create.config'

/** One of the example strategies, read off disk so the test and the docs cannot drift. */
export function example(name: string): string {
	return fs.readFileSync(path.join(EXAMPLES_DIR, `${name}.ts`), 'utf8')
}

/**
 * Splits an example at its export boundaries, so the source can be pasted in pieces and
 * the required-exports checklist watched filling in the way a creator sees it.
 *
 * The boundaries are the three things the checklist counts: the accounting re-export
 * block, `describe`, and `onTick`.
 */
export function splitAtExports(source: string): string[] {
	const marks = ['\nexport {', '\nexport const describe', '\nexport const onTick']
	const offsets = marks.map((mark) => {
		const at = source.indexOf(mark)
		if (at === -1) throw new Error(`the example has no ${mark.trim()} to split at`)
		return at + 1
	})
	const bounds = [0, ...offsets, source.length]
	return bounds.slice(0, -1).map((from, index) => source.slice(from, bounds[index + 1]))
}

export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed'

export interface CheckState {
	id: string
	status: CheckStatus
}

/** The pre-flight rows as the DOM currently has them, in pipeline order. */
export async function readChecks(page: Page): Promise<CheckState[]> {
	return page.$$eval('li[data-check]', (rows) =>
		rows.map((row) => ({
			id: row.getAttribute('data-check') ?? '',
			status: (row.getAttribute('data-status') ?? 'pending') as CheckStatus,
		})),
	)
}

export interface CheckTiming {
	id: string
	/** Seconds from the start of the run to this check's first `running`. */
	startedAt: number | null
	/** Seconds from the start of the run to this check's terminal status. */
	settledAt: number | null
	status: CheckStatus
}

export interface RunTimings {
	totalSeconds: number
	checks: CheckTiming[]
	/** Statuses seen at least once, so a check that never rendered `running` is visible. */
	observedStatuses: Record<string, CheckStatus[]>
}

/**
 * Watches the pre-flight list until every row settles, recording when each check started
 * and finished. Dead air on camera is the thing to measure here, so the timings are the
 * point of the journey rather than a diagnostic.
 *
 * `onSample` fires after every poll, which is how a journey grabs a screenshot at the
 * exact moment a check is mid-flight rather than guessing at a sleep.
 */
export async function watchChecks(
	page: Page,
	options: {
		timeoutMs: number
		pollMs?: number
		onSample?: (checks: CheckState[], elapsedSeconds: number) => Promise<void> | void
	},
): Promise<RunTimings> {
	const pollMs = options.pollMs ?? 300
	const started = Date.now()
	const timings = new Map<string, CheckTiming>()
	const observed = new Map<string, Set<CheckStatus>>()

	for (;;) {
		const elapsed = (Date.now() - started) / 1000
		const checks = await readChecks(page)

		for (const check of checks) {
			const seen = observed.get(check.id) ?? new Set<CheckStatus>()
			seen.add(check.status)
			observed.set(check.id, seen)

			const entry = timings.get(check.id) ?? { id: check.id, startedAt: null, settledAt: null, status: check.status }
			entry.status = check.status
			if (check.status === 'running' && entry.startedAt === null) entry.startedAt = elapsed
			if ((check.status === 'passed' || check.status === 'failed') && entry.settledAt === null) {
				// A check can settle between two polls without ever being sampled as
				// running; recording the settle time keeps the row honest either way.
				entry.settledAt = elapsed
			}
			timings.set(check.id, entry)
		}

		await options.onSample?.(checks, elapsed)

		const settled =
			checks.length > 0 &&
			checks.every((check) => check.status === 'passed' || check.status === 'failed')
		const stopped = checks.some((check) => check.status === 'failed')
		if (settled || (stopped && checks.every((check) => check.status !== 'running'))) {
			return {
				totalSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
				checks: [...timings.values()].map((entry) => ({
					...entry,
					startedAt: entry.startedAt === null ? null : Number(entry.startedAt.toFixed(1)),
					settledAt: entry.settledAt === null ? null : Number(entry.settledAt.toFixed(1)),
				})),
				observedStatuses: Object.fromEntries(
					[...observed.entries()].map(([id, statuses]) => [id, [...statuses]]),
				),
			}
		}

		if (Date.now() - started > options.timeoutMs) {
			throw new Error(
				`the pre-flight run did not settle in ${options.timeoutMs}ms: ${JSON.stringify(checks)}`,
			)
		}
		await page.waitForTimeout(pollMs)
	}
}

/** Appends a timing record, so the report quotes measurements rather than impressions. */
export function recordTimings(label: string, payload: unknown): void {
	fs.mkdirSync(path.dirname(TIMING_LOG), { recursive: true })
	let existing: Record<string, unknown> = {}
	try {
		if (fs.existsSync(TIMING_LOG)) existing = JSON.parse(fs.readFileSync(TIMING_LOG, 'utf8'))
	} catch (error) {
		console.error('e2e: the timing log could not be read, starting a new one', error)
	}
	existing[label] = payload
	fs.writeFileSync(TIMING_LOG, `${JSON.stringify(existing, null, 2)}\n`)
}
