import { API_URL } from './browse.config'
import { assertNoFalseClaims, expect, test, visibleText } from './support/fixtures'
import type { Page } from '@playwright/test'

/**
 * Journey G — one strategy end to end: the metric tiles, the chart and its range
 * selector, the description, the activity tables, the verification card, copying a hash,
 * and the published source behind it.
 *
 * The source check is the one that matters most: the page claims the hash measures this
 * TypeScript, so the test compares what is rendered against what the API serves for that
 * slug, and against the other strategies' source, so a shared placeholder cannot pass.
 */

const SLUG = 'mom'

interface Detail {
	slug: string
	name: string
	ticker: string
	description: string
	metrics: {
		apy: number | null
		totalReturn: number | null
		maxDrawdown: number | null
		aum: string
		investorCount: number
		navSnapshotCount: number
		navPerShare: string
	}
	verification: { binaryHash: string | null; workflowId: string | null; lastAttestedAt: string | null }
}

async function getDetail(page: Page, slug: string): Promise<Detail> {
	const response = await page.request.get(`${API_URL}/api/strategies/${slug}`)
	expect(response.ok(), `GET /api/strategies/${slug} failed`).toBe(true)
	return (await response.json()) as Detail
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The substantial lines `source` has and `other` does not, longest first. */
function distinctiveLines(source: string, other: string): string[] {
	const elsewhere = new Set(other.split('\n').map(squash))
	return source
		.split('\n')
		.map(squash)
		.filter((line) => line.length > 32 && !elsewhere.has(line))
		.sort((a, b) => b.length - a.length)
}

async function getSource(page: Page, slug: string): Promise<string> {
	const response = await page.request.get(`${API_URL}/api/strategies/${slug}/source`)
	expect(response.ok(), `GET /api/strategies/${slug}/source failed`).toBe(true)
	return await response.text()
}

test('G1. the strategy page shows the API metrics, the chart, the description and the activity tables', async ({
	page,
	consoleGuard,
	shot,
}) => {
	const detail = await getDetail(page, SLUG)

	await page.goto(`/strategy/${SLUG}`)
	await expect(page.getByRole('heading', { name: detail.name, level: 1 })).toBeVisible()

	// Metric tiles carry the API's values, em dash where the API served null.
	const apyTile = page.getByText('Attested return (APY)').locator('..')
	await expect(apyTile).toContainText(detail.metrics.apy === null ? '—' : /\d+\.\d\d%/)

	const returnTile = page.getByText('Total return', { exact: true }).locator('..')
	await expect(returnTile).toContainText(`${detail.metrics.navSnapshotCount} NAV snapshots`)

	const aumTile = page.getByText('AUM', { exact: true }).locator('..')
	await expect(aumTile).toContainText(
		`${detail.metrics.investorCount} ${detail.metrics.investorCount === 1 ? 'investor' : 'investors'}`,
	)

	// The chart and its range selector.
	const ranges = page.getByRole('radiogroup', { name: 'Time range' })
	await expect(ranges).toBeVisible()
	await expect(ranges.getByRole('radio', { name: '30D' })).toHaveAttribute('aria-checked', 'true')
	await ranges.getByRole('radio', { name: 'ALL' }).click()
	await expect(ranges.getByRole('radio', { name: 'ALL' })).toHaveAttribute('aria-checked', 'true')
	await expect(ranges.getByRole('radio', { name: '30D' })).toHaveAttribute('aria-checked', 'false')

	// A chart with points draws an SVG; one with none says so rather than drawing a
	// flat line that would read as a real result.
	const hasHistory = detail.metrics.navSnapshotCount > 0
	if (hasHistory) {
		await expect(page.locator('.recharts-surface').first()).toBeVisible()
	} else {
		await expect(page.getByText('No data in this range yet')).toBeVisible()
	}

	// The description is the creator's own, not boilerplate.
	await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
	expect(detail.description.trim().length).toBeGreaterThan(0)
	await expect(page.getByText(detail.description.trim().split('\n')[0]!.slice(0, 60))).toBeVisible()

	// Trades, then the enclave runs behind them.
	await expect(page.getByRole('tab', { name: /Recent trades/ })).toBeVisible()
	await page.getByRole('tab', { name: /Enclave runs/ }).click()
	await expect(page.getByRole('tab', { name: /Enclave runs/ })).toHaveAttribute('aria-selected', 'true')
	await page.getByRole('tab', { name: /Recent trades/ }).click()

	await expect(page.getByRole('heading', { name: 'Verification' })).toBeVisible()

	assertNoFalseClaims(await visibleText(page), `the ${SLUG} strategy page`)
	await shot('browse-09-strategy-detail', { fullPage: true })
	await page.evaluate(() => window.scrollTo(0, 0))
	await shot('browse-09a-strategy-detail-above-fold')
	expect(consoleGuard.messages).toEqual([])
})

test('G2. the attestation drawer copies the binary hash to the clipboard', async ({
	page,
	context,
	consoleGuard,
	shot,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'])
	const detail = await getDetail(page, SLUG)
	expect(detail.verification.binaryHash).not.toBeNull()

	await page.goto(`/strategy/${SLUG}`)
	await page
		.getByRole('button', { name: /Nitro enclave verified|Awaiting attestation/ })
		.first()
		.click()

	const drawer = page.getByRole('dialog', { name: 'Attestation proof' })
	await expect(drawer).toBeVisible()
	await expect(drawer).toContainText('AWS Nitro Enclaves')
	await expect(drawer).toContainText('us-west-2')
	assertNoFalseClaims((await drawer.innerText()).toLowerCase(), 'the attestation drawer')

	await shot('browse-10-attestation-proof')

	await drawer.getByText(detail.verification.binaryHash!).click()
	await expect(drawer.getByText('Copied')).toBeVisible()
	const clipboard = await page.evaluate(() => navigator.clipboard.readText())
	expect(clipboard).toBe(detail.verification.binaryHash)

	await page.keyboard.press('Escape')
	await expect(drawer).toHaveCount(0)
	expect(consoleGuard.messages).toEqual([])
})

test('G3. the source view shows this strategy’s own TypeScript', async ({
	page,
	consoleGuard,
	shot,
}) => {
	const detail = await getDetail(page, SLUG)
	const source = await getSource(page, SLUG)
	const otherSource = await getSource(page, 'rev')
	expect(source.trim().length, 'the API served no source').toBeGreaterThan(0)
	expect(source, 'two strategies served identical source').not.toBe(otherSource)

	await page.goto(`/strategy/${SLUG}/source`)
	await expect(page.getByRole('heading', { name: 'Published source', level: 1 })).toBeVisible()
	await expect(page.getByText(`${detail.ticker}.ts`)).toBeVisible()
	await expect(page.getByText(`${source.split('\n').length} lines`)).toBeVisible()

	// The rendered code must be this strategy's code, not a template or a placeholder.
	const rendered = squash(await page.locator('pre, code').first().innerText())
	const own = distinctiveLines(source, otherSource)
	expect(own.length, 'the two strategies share every line of source').toBeGreaterThan(2)
	for (const line of own.slice(0, 5)) {
		expect(rendered, `the rendered source is missing a line only ${SLUG} has`).toContain(squash(line))
	}

	// And not the other strategy's: a shared template rendered for every slug would
	// satisfy every check above but this one.
	for (const line of distinctiveLines(otherSource, source).slice(0, 3)) {
		expect(rendered, 'the source view rendered another strategy’s code').not.toContain(squash(line))
	}

	// Every export the strategy contract demands is on the page a reader can check.
	for (const symbol of ['describe', 'onTick']) {
		expect(rendered, `the rendered source is missing ${symbol}`).toContain(symbol)
	}
	expect(rendered, 'the describe() name does not match the listing').toContain(detail.name)

	await expect(page.getByText(detail.verification.binaryHash!)).toBeVisible()
	assertNoFalseClaims(await visibleText(page), 'the source view')

	await shot('browse-11-source-view', { fullPage: true })
	await page.evaluate(() => window.scrollTo(0, 0))
	await shot('browse-11a-source-view-top')
	expect(consoleGuard.messages).toEqual([])
})
