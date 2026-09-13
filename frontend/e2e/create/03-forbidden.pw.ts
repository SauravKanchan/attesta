import { API_URL } from './create.config'
import { expect, test } from './support/fixtures'
import { exportsCounter, setSource, waitForEditor } from './support/editor'
import { example, readChecks, recordTimings, watchChecks } from './support/journey'

/**
 * Journey G — a strategy that reads the filesystem is refused, readably, and cannot
 * publish.
 *
 * The import is added to a strategy that is otherwise valid, so the pipeline reaches
 * `forbidden-imports` and stops exactly there: two checks pass, the third fails with the
 * offending specifier named, and the six behind it stay queued. A denylist that failed at
 * `parses` instead would prove nothing about the denylist.
 */

const LISTING = {
	name: 'Filesystem Peeker',
	ticker: 'FSPK',
	description:
		'Identical to the momentum example except that it imports node:fs, which the sanity pipeline must refuse before the workflow is ever built.',
}

/** Inserted above the accounting re-export block, which keeps every export intact. */
function withFilesystemImport(source: string): string {
	const anchor = '\nexport {'
	const at = source.indexOf(anchor)
	expect(at, 'the example has no export block to insert above').toBeGreaterThan(-1)
	return `${source.slice(0, at)}\nimport { readFileSync } from 'node:fs'\n${source.slice(at)}`
}

test('G. a strategy that imports fs fails forbidden-imports and cannot publish', async ({
	page,
	consoleGuard,
	apiFailures,
	shot,
}) => {
	await page.goto('/create')
	await waitForEditor(page)

	await setSource(page, withFilesystemImport(example('momentum')))
	// The interface is intact — this submission is refused for what it imports.
	await expect(exportsCounter(page)).toHaveText('6 / 6 valid')

	await page.getByLabel('Strategy name').fill(LISTING.name)
	await page.getByLabel('Ticker').fill(LISTING.ticker)
	await page.getByRole('button', { name: 'Momentum', exact: true }).click()
	await page.getByLabel('Description').fill(LISTING.description)

	const created = page.waitForResponse(
		(response) => response.url().endsWith('/submissions') && response.request().method() === 'POST',
	)
	await page.getByRole('button', { name: 'Continue' }).click()
	expect((await created).status()).toBe(201)
	const submissionId: string = (await (await created).json()).id

	// No private parameters: the step has to be passable empty, and plenty of strategies are.
	await expect(page.getByRole('heading', { name: 'Private parameters' })).toBeVisible()
	await page.getByRole('button', { name: 'Encrypt and continue' }).click()

	await expect(page.getByRole('heading', { name: 'Review and publish' })).toBeVisible()
	await page.getByRole('button', { name: 'Run pre-flight checks' }).click()

	const timings = await watchChecks(page, { timeoutMs: 180_000 })
	recordTimings('forbidden-imports', timings)
	console.log(`forbidden-import run: ${JSON.stringify(timings, null, 2)}`)

	const byId = new Map((await readChecks(page)).map((check) => [check.id, check.status]))
	expect(byId.get('parses')).toBe('passed')
	expect(byId.get('required-exports')).toBe('passed')
	expect(byId.get('forbidden-imports')).toBe('failed')
	// A failure stops the rest rather than reporting six more failures the creator did not cause.
	for (const id of ['no-side-effects', 'typechecks', 'describe-valid', 'deterministic', 'cre-build', 'cre-simulate']) {
		expect(byId.get(id), `${id} should still be queued`).toBe('pending')
	}

	// Readable means it names the module and where it is, not just "rejected", and the
	// detail opens by itself so the creator does not have to go looking for the reason.
	const failedRow = page.locator('li[data-check="forbidden-imports"]')
	await expect(failedRow).toContainText('No forbidden module imports')
	const detail = (await failedRow.locator('pre').innerText()).trim()
	expect(detail).toContain('node:fs')
	expect(detail).toContain('forbidden')
	expect(detail).toMatch(/line \d+:\d+/)
	console.log(`forbidden-imports detail: ${detail}`)

	// Publishing is refused by the button, by the hint, and by the server.
	const publish = page.getByRole('button', { name: 'Publish strategy' })
	await expect(publish).toBeDisabled()
	await expect(page.getByText('Publishing unlocks when all nine checks pass')).toBeVisible()
	await expect(page.getByText(/Publishing is blocked at/)).toContainText('forbidden-imports')
	await shot('create-12-forbidden-import-failed')

	const token = await page.evaluate(() => window.localStorage.getItem('attesta.session.token'))
	const forced = await page.request.post(`${API_URL}/api/submissions/${submissionId}/publish`, {
		headers: { authorization: `Bearer ${token}` },
	})
	expect(forced.status()).toBe(409)
	expect(await forced.text()).toContain('forbidden-imports')

	// The deliberate 409 above is the only rejection this journey is allowed to produce.
	expect(apiFailures).toEqual([])
	expect(consoleGuard.messages).toEqual([])
})
