import { API_URL } from './browse.config'
import { assertNoFalseClaims, expect, test, visibleText } from './support/fixtures'
import type { Page } from '@playwright/test'

/**
 * Journeys C to F — the marketplace grid: what a card claims, fuzzy search, the filters
 * and the empty state. Every expected figure is read from the API in the test rather
 * than written down here, so a hardcoded number in a component fails this spec.
 */

interface ApiStrategy {
	slug: string
	name: string
	ticker: string
	riskLevel: string
	types: string[]
	metrics: { apy: number | null; investorCount: number; navSnapshotCount: number }
	verification: { binaryHash: string | null }
}

async function listStrategies(page: Page, query = ''): Promise<ApiStrategy[]> {
	const response = await page.request.get(`${API_URL}/api/strategies${query}`)
	expect(response.ok(), `GET /api/strategies${query} failed`).toBe(true)
	return (await response.json()).strategies as ApiStrategy[]
}

/** Mirrors `truncateHash(hash, 8, 6)`, the card's own truncation. */
function cardHash(hash: string): string {
	return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

const cards = (page: Page) => page.locator('article')
const resultCount = (page: Page) => page.getByText(/^Showing/)

async function openMarketplace(page: Page): Promise<void> {
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Marketplace', level: 1 })).toBeVisible()
	await expect(cards(page).first()).toBeVisible()
}

test('C. every seeded strategy appears with its badge, its binary hash and its real APY', async ({
	page,
	consoleGuard,
	apiFailures,
	shot,
}) => {
	const expected = await listStrategies(page)
	expect(expected.length, 'the seeded database should carry three strategies').toBe(3)

	await openMarketplace(page)
	await expect(cards(page)).toHaveCount(expected.length)
	await expect(resultCount(page)).toHaveText(
		new RegExp(`Showing\\s*${expected.length}\\s*of\\s*${expected.length}\\s*strategies`),
	)

	for (const strategy of expected) {
		const card = page.locator('article').filter({ hasText: strategy.name })
		await expect(card, `no card for ${strategy.slug}`).toHaveCount(1)

		// The verification badge is the card's central claim, in one of its two states.
		const badge = card.getByRole('button', { name: /Nitro enclave verified|Awaiting attestation/ })
		await expect(badge).toBeVisible()

		// The hash on the card must be the hash the API served, truncated — never a stub.
		expect(strategy.verification.binaryHash).not.toBeNull()
		await expect(card.getByText(cardHash(strategy.verification.binaryHash!))).toBeVisible()

		// APY renders the API's value, or an em dash when there is nothing to annualise.
		const apyBlock = card.getByText('Attested return').locator('..')
		if (strategy.metrics.apy === null) {
			await expect(apyBlock).toContainText('—')
		} else {
			await expect(apyBlock).toContainText(/[+-]?\d+\.\d\d%/)
		}
	}

	assertNoFalseClaims(await visibleText(page), 'the marketplace grid')
	await shot('browse-04-strategy-cards')

	// The unfiltered catalogue behind the typeahead is fetched on every load; a rejected
	// one costs the suggestions and the "of N" total without failing anything visibly.
	expect(apiFailures, 'the marketplace made an API call the backend rejected').toEqual([])
	expect(consoleGuard.messages).toEqual([])
})

test('D. a non-contiguous query matches and the matched characters are highlighted', async ({
	page,
	consoleGuard,
	shot,
}) => {
	// "emrv" is a subsequence of "ETH Mean Reversion" and of nothing else listed.
	const query = 'emrv'
	const matched = await listStrategies(page, `?q=${query}`)
	expect(matched.map((strategy) => strategy.slug)).toEqual(['rev'])

	await openMarketplace(page)

	const search = page.getByRole('combobox', { name: /Search strategies/ })
	await search.click()
	await search.fill(query)

	// The typeahead shows why the row matched before the grid narrows.
	const suggestions = page.getByRole('listbox', { name: 'Matching strategies' })
	await expect(suggestions).toBeVisible()
	await expect(suggestions.getByRole('option')).toHaveCount(1)
	await expect(suggestions.locator('mark').first()).toBeVisible()

	await shot('browse-05-fuzzy-typeahead')

	await page.keyboard.press('Escape')
	await expect(cards(page)).toHaveCount(1)
	await expect(cards(page).first()).toContainText(matched[0]!.name)
	await expect(resultCount(page)).toHaveText(/Showing\s*1\s*of\s*3\s*strategies/)

	// Highlighted characters, in order, must spell the query — that is the whole claim
	// the highlight makes.
	const marks = cards(page).first().locator('h3 mark')
	await expect(marks.first()).toBeVisible()
	const highlighted = (await marks.allInnerTexts()).join('').toLowerCase()
	expect(highlighted).toBe(query)

	// Non-contiguous: the matched characters are not one run of the name.
	expect(matched[0]!.name.toLowerCase()).not.toContain(query)

	await expect(page.getByText('Active criteria')).toBeVisible()
	await shot('browse-05a-fuzzy-match-highlighted')
	expect(consoleGuard.messages).toEqual([])
})

test('E. filtering by type and by risk tracks the result count, and clearing restores it', async ({
	page,
	consoleGuard,
	shot,
}) => {
	const all = await listStrategies(page)
	const byType = await listStrategies(page, '?types=momentum')
	const byRisk = await listStrategies(page, '?types=momentum&risk=high')
	expect(byType.length).toBeGreaterThan(0)
	expect(byRisk.length).toBeGreaterThan(0)
	expect(byType.length).toBeLessThan(all.length)

	await openMarketplace(page)

	await page.getByRole('button', { name: 'All types' }).click()
	await page.getByRole('option', { name: 'Momentum', exact: true }).click()
	await page.keyboard.press('Escape')

	await expect(cards(page)).toHaveCount(byType.length)
	await expect(resultCount(page)).toHaveText(
		new RegExp(`Showing\\s*${byType.length}\\s*of\\s*${all.length}\\s*strategies`),
	)

	await page.getByRole('radiogroup', { name: 'Risk profile' }).getByRole('radio', { name: 'High' }).click()
	await expect(cards(page)).toHaveCount(byRisk.length)
	await expect(resultCount(page)).toHaveText(
		new RegExp(`Showing\\s*${byRisk.length}\\s*of\\s*${all.length}\\s*strategies`),
	)
	for (const strategy of byRisk) {
		await expect(page.locator('article').filter({ hasText: strategy.name })).toHaveCount(1)
	}

	await shot('browse-06-filters-type-and-risk')

	await page.getByRole('button', { name: 'Clear all filters' }).click()
	await expect(cards(page)).toHaveCount(all.length)
	await expect(resultCount(page)).toHaveText(
		new RegExp(`Showing\\s*${all.length}\\s*of\\s*${all.length}\\s*strategies`),
	)
	await expect(page.getByText('Active criteria')).toHaveCount(0)

	await shot('browse-07-filters-cleared')
	expect(consoleGuard.messages).toEqual([])
})

test('F. a nonsense query shows the empty state and offers a way out', async ({
	page,
	consoleGuard,
	shot,
}) => {
	const nonsense = 'qqzzxx'
	expect(await listStrategies(page, `?q=${nonsense}`)).toEqual([])

	await openMarketplace(page)
	const search = page.getByRole('combobox', { name: /Search strategies/ })
	await search.click()
	await search.fill(nonsense)

	await expect(cards(page)).toHaveCount(0)
	await expect(page.getByText('No strategies match these criteria')).toBeVisible()
	await expect(resultCount(page)).toHaveText(/Showing\s*0\s*of\s*3\s*strategies/)

	await shot('browse-08-empty-state')

	// Two buttons carry this label: the one in the filter bar and the one the empty
	// state offers. The empty state's is the way out a reader who is stuck will reach for.
	await page.getByRole('button', { name: 'Clear all filters' }).last().click()
	await expect(cards(page)).toHaveCount(3)

	expect(consoleGuard.messages).toEqual([])
})
