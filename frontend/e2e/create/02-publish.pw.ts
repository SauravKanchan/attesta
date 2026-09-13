import type { Page } from '@playwright/test'
import { API_URL } from './create.config'
import { assertNoFalseClaims, expect, test, visibleText } from './support/fixtures'
import {
	deleteLineContaining,
	exportRow,
	exportsCounter,
	clearSource,
	setSource,
	appendSource,
	waitForEditor,
} from './support/editor'
import { example, recordTimings, readChecks, splitAtExports, watchChecks } from './support/journey'

/**
 * Journeys B to F — the creator flow end to end, in one test because it is one
 * submission: the draft lives in the flow's own state, so splitting the journey across
 * page loads would be testing a different product than the one a creator uses.
 *
 * The load-bearing assertion is journey D. Everything else here checks that the screen
 * behaves; D checks that the central claim is true, by reading what actually left the
 * browser for `POST /submissions/:id/secrets` and searching it for the plaintext that
 * was typed. A hit there is not a UI defect, it is the product being false.
 */

/** Distinctive enough that finding it anywhere on the wire is unambiguous. */
const CANARY = 'PLAINTEXT-CANARY-attesta-2f9c41'
const TARGET_BPS = '7531'

const LISTING = {
	name: 'ETH Momentum Crossover',
	ticker: 'XMOM',
	description:
		'Goes fully long ETH when the 5-tick mean crosses above the 20-tick mean and flat when it crosses back below. Published from the browser as a CRE workflow.',
}

test('B–F. write, encrypt, check and publish a strategy', async ({
	page,
	consoleGuard,
	apiFailures,
	network,
	shot,
}) => {
	const momentum = example('momentum')

	/* ── B. the editor and the required-exports checklist ───────────── */

	await page.goto('/create')
	await waitForEditor(page)

	// The template arrives complete, so start from empty to watch the checklist fill in.
	await clearSource(page)
	await expect(exportsCounter(page)).toHaveText('0 / 6 valid')

	const [header, accounting, describe, onTick] = splitAtExports(momentum)

	await appendSource(page, header as string)
	await expect(exportsCounter(page)).toHaveText('0 / 6 valid')

	// The four accounting functions are re-exported from the shared contract in one block.
	await appendSource(page, accounting as string)
	await expect(exportsCounter(page)).toHaveText('4 / 6 valid')
	await expect(exportRow(page, 'onTick()')).toContainText('Not exported yet')

	await appendSource(page, describe as string)
	await expect(exportsCounter(page)).toHaveText('5 / 6 valid')

	await appendSource(page, onTick as string)
	await expect(exportsCounter(page)).toHaveText('6 / 6 valid')
	await expect(exportRow(page, 'onWithdraw()')).not.toContainText('Not exported yet')

	await page.getByText('Required exports').scrollIntoViewIfNeeded()
	await shot('create-02-exports-complete')

	/* ── B. deleting an export blocks the step ──────────────────────── */

	await deleteLineContaining(page, 'defaultOnWithdraw as onWithdraw,')
	await expect(exportsCounter(page)).toHaveText('5 / 6 valid')
	await expect(exportRow(page, 'onWithdraw()')).toContainText('Not exported yet')

	// The footer says what is missing before the creator even reaches for Continue.
	await expect(page.getByText('1 required export missing')).toBeVisible()
	await shot('create-03-missing-onwithdraw')

	await page.getByRole('button', { name: 'Continue' }).click()
	// Both blockers, not just the first one found: the listing is empty too at this point,
	// and a message that mentioned only the listing would contradict the red checklist.
	await expect(page.getByText(/Still missing onWithdraw\(\)/)).toBeVisible()
	await expect(page.getByText(/listing details are incomplete/)).toBeVisible()
	// Blocked means blocked: no draft was created and the step did not advance.
	expect(network.matching('/submissions', 'POST')).toEqual([])
	await expect(page.getByRole('heading', { name: 'Private parameters' })).toHaveCount(0)
	await shot('create-04-continue-blocked')

	// Put it back the way an editor undo would.
	await setSource(page, momentum)
	await expect(exportsCounter(page)).toHaveText('6 / 6 valid')

	/* ── C. the listing metadata ────────────────────────────────────── */

	await page.getByLabel('Strategy name').fill(LISTING.name)
	await page.getByLabel('Ticker').fill(LISTING.ticker)
	await page.getByRole('button', { name: 'Momentum', exact: true }).click()
	await page.getByRole('button', { name: 'Trend following', exact: true }).click()
	await page.getByRole('radio', { name: 'High' }).click()
	await page.getByLabel('Description').fill(LISTING.description)

	await page.getByLabel('Strategy name').scrollIntoViewIfNeeded()
	await shot('create-05-listing-metadata')

	// With the listing complete, the export gate has to hold on its own.
	await deleteLineContaining(page, 'defaultOnWithdraw as onWithdraw,')
	await expect(exportsCounter(page)).toHaveText('5 / 6 valid')
	await page.getByRole('button', { name: 'Continue' }).click()
	await expect(page.getByText(/Still missing onWithdraw\(\)/)).toBeVisible()
	await expect(page.getByText(/listing details are incomplete/)).toHaveCount(0)
	expect(network.matching('/submissions', 'POST')).toEqual([])
	await setSource(page, momentum)
	await expect(exportsCounter(page)).toHaveText('6 / 6 valid')

	const created = page.waitForResponse(
		(response) => response.url().endsWith('/submissions') && response.request().method() === 'POST',
	)
	await page.getByRole('button', { name: 'Continue' }).click()
	expect((await created).status()).toBe(201)

	const draft = await (await created).json()
	const submissionId: string = draft.id
	expect(submissionId).toMatch(/^[0-9a-f-]{36}$/)

	/* ── D. private parameters, and what actually leaves the browser ── */

	await expect(page.getByRole('heading', { name: 'Private parameters' })).toBeVisible()

	await page.getByLabel('Key').nth(0).fill('MOMENTUM_TARGET_BPS')
	await page.getByLabel('Value').nth(0).fill(TARGET_BPS)

	await page.getByRole('button', { name: 'Add parameter' }).click()
	await page.getByLabel('Key').nth(1).fill('VENUE_API_KEY')
	await page.getByLabel('Value').nth(1).fill(CANARY)

	// Each row shows the exact bytes it will post, so the claim is visible before it is sent.
	const wire = page.locator('code[title^="local-dev.v1."]')
	await expect(wire).toHaveCount(2)
	for (const text of await wire.allTextContents()) {
		expect(text).toMatch(/^local-dev\.v1\./)
	}
	await shot('create-06-parameters-encrypted')

	const posted = page.waitForResponse(
		(response) =>
			response.url().includes(`/submissions/${submissionId}/secrets`) &&
			response.request().method() === 'POST',
	)
	await page.getByRole('button', { name: 'Encrypt and continue' }).click()
	expect((await posted).status()).toBe(200)

	// ── THE CRITICAL CHECK ──────────────────────────────────────────
	// The request body is read off the wire, not off the page.
	const secretsRequest = network.last(`/submissions/${submissionId}/secrets`, 'POST')
	expect(secretsRequest, 'no POST to /secrets was recorded').not.toBeNull()
	const rawBody = secretsRequest?.body ?? ''

	expect(rawBody, 'the plaintext parameter appeared in the request body').not.toContain(CANARY)
	expect(rawBody, 'the plaintext parameter appeared in the request body').not.toContain(TARGET_BPS)

	const envelope = /^local-dev\.v1\.[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/
	const body = JSON.parse(rawBody)
	expect(body).toHaveLength(2)
	expect(body.map((entry: { key: string }) => entry.key).sort()).toEqual([
		'MOMENTUM_TARGET_BPS',
		'VENUE_API_KEY',
	])
	for (const entry of body) {
		expect(Object.keys(entry).sort()).toEqual(['ciphertext', 'key', 'scheme'])
		expect(entry.scheme).toBe('local-dev')
		expect(entry.ciphertext).toMatch(envelope)
		expect(entry.ciphertext).not.toContain(CANARY)
	}

	// Nothing else the browser sent may carry it either — not the draft, not a patch.
	const leaked = network.requests.filter(
		(entry) => entry.body !== null && (entry.body.includes(CANARY) || entry.body.includes(TARGET_BPS)),
	)
	expect(leaked.map((entry) => `${entry.method} ${entry.url}`), 'plaintext left the browser').toEqual([])

	// And the platform cannot hand it back: what it stored is the envelope.
	const stored = await page.request.get(`${API_URL}/api/submissions/${submissionId}`, {
		headers: { authorization: `Bearer ${await sessionToken(page)}` },
	})
	expect(stored.status()).toBe(200)
	const storedText = await stored.text()
	expect(storedText).not.toContain(CANARY)
	expect(storedText).not.toContain(TARGET_BPS)

	/* ── E. the nine pre-flight checks ──────────────────────────────── */

	await expect(page.getByRole('heading', { name: 'Review and publish' })).toBeVisible()
	const rows = await readChecks(page)
	expect(rows).toHaveLength(9)
	expect(rows.every((row) => row.status === 'pending')).toBe(true)
	await shot('create-07-checks-pending')

	await page.getByRole('button', { name: 'Run pre-flight checks' }).click()

	// The two `cre` steps are the whole of the wait, and they are the last two rows, so
	// the frames worth keeping are the ones taken while each of them is spinning — with
	// the row scrolled into shot, because on a laptop it sits below the fold.
	const midRunShots = new Set<string>()
	const timings = await watchChecks(page, {
		timeoutMs: 780_000,
		onSample: async (checks) => {
			const running = checks.find((check) => check.status === 'running')
			if (running === undefined || midRunShots.has(running.id)) return
			const name = running.id === 'cre-build' ? 'create-08-checks-building' : running.id === 'cre-simulate' ? 'create-08a-checks-simulating' : null
			if (name === null) return
			midRunShots.add(running.id)
			await page.locator(`li[data-check="${running.id}"]`).scrollIntoViewIfNeeded()
			await shot(name)
		},
	})
	recordTimings('preflight', timings)
	console.log(`pre-flight timings: ${JSON.stringify(timings, null, 2)}`)

	expect([...midRunShots].sort(), 'both cre steps should have been caught mid-flight').toEqual([
		'cre-build',
		'cre-simulate',
	])
	expect(timings.checks.map((check) => check.status)).toEqual(Array(9).fill('passed'))

	// The build produces the identity; it is not chosen. The panel has to show the same
	// hash the server recorded, in full, or the proof on screen is decoration.
	const recorded = await page.request.get(`${API_URL}/api/submissions/${submissionId}`, {
		headers: { authorization: `Bearer ${await sessionToken(page)}` },
	})
	const checked = await recorded.json()
	expect(checked.binaryHash).toMatch(/^[0-9a-f]{64}$/)
	expect(checked.configHash).toMatch(/^[0-9a-f]{64}$/)

	const identity = page.getByRole('button', { name: 'Copy the binary hash' })
	await expect(identity).toHaveText(new RegExp(checked.binaryHash))
	await expect(page.getByRole('button', { name: 'Copy the config hash' })).toHaveText(
		new RegExp(checked.configHash),
	)
	await shot('create-09-checks-passed')

	assertNoFalseClaims(await visibleText(page), 'the review step')

	/* ── F. publish, and find it in the marketplace ─────────────────── */

	const published = page.waitForResponse(
		(response) =>
			response.url().includes(`/submissions/${submissionId}/publish`) &&
			response.request().method() === 'POST',
	)
	const publishStarted = Date.now()
	await page.getByRole('button', { name: 'Publish strategy' }).click()
	const publishResponse = await published
	expect(publishResponse.status()).toBe(200)
	const publishSeconds = Number(((Date.now() - publishStarted) / 1000).toFixed(1))
	recordTimings('publish', { seconds: publishSeconds })

	const strategy = await publishResponse.json()
	expect(strategy.ticker).toBe(LISTING.ticker)
	expect(strategy.verification.binaryHash).toMatch(/^[0-9a-f]{64}$/)

	await page.waitForURL(`**/strategy/${strategy.slug}`)
	await expect(page.getByRole('heading', { name: LISTING.name })).toBeVisible()
	assertNoFalseClaims(await visibleText(page), 'the published strategy page')
	await shot('create-10-published-strategy')

	await page.getByRole('link', { name: 'Marketplace' }).first().click()
	await page.waitForURL((url) => url.pathname === '/')

	// The marketplace's own filter, not the shell's search box — that one navigates on
	// Enter, and a grid that never filtered would let this assertion pass on any card.
	await page.getByPlaceholder(/Search strategies, creators, tickers/).fill(LISTING.ticker)
	// The typeahead opens over the grid, and Escape on this field clears the query rather
	// than only closing the list, so dismiss it by clicking away.
	await page.getByRole('heading', { name: 'Marketplace', level: 1 }).click()

	// The grid has to have actually filtered: it shows exactly what the API returns for
	// this query, and that is fewer than the catalogue holds.
	const [matches, catalogue] = await Promise.all([
		page.request.get(`${API_URL}/api/strategies?q=${LISTING.ticker}`).then((response) => response.json()),
		page.request.get(`${API_URL}/api/strategies`).then((response) => response.json()),
	])
	expect(matches.total).toBeGreaterThan(0)
	expect(matches.total).toBeLessThan(catalogue.total)
	const cards = page.locator('article')
	await expect(cards).toHaveCount(matches.total)

	const card = cards.filter({ hasText: LISTING.name }).first()
	await expect(card).toContainText(`$${LISTING.ticker}`)
	// A strategy nobody has funded and nobody has ticked has no track record, and says so
	// rather than showing a figure it cannot support.
	await expect(card).toContainText('No NAV history')
	await shot('create-11-marketplace-listing')

	expect(apiFailures).toEqual([])
	expect(consoleGuard.messages).toEqual([])
})

/** The session the app is already holding, so the test speaks to the API as the creator. */
async function sessionToken(page: Page): Promise<string> {
	const token = await page.evaluate(() => window.localStorage.getItem('attesta.session.token'))
	if (token === null) throw new Error('no session token in localStorage')
	return token
}
