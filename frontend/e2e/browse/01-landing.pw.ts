import { assertNoFalseClaims, expect, test, visibleText } from './support/fixtures'

/**
 * Journey A — the signed-out root.
 *
 * The product exists to make unverifiable performance claims impossible, so the page
 * that sells it may not carry a single figure of its own. This spec is the guard on
 * that: it fails if anyone ever adds a TVL counter, a node count or a proof tally.
 */

/** Shapes a fabricated statistic takes. Each is checked against the rendered text. */
const FABRICATED_STATISTIC = [
	{ label: 'a currency figure', pattern: /\$\s?\d/ },
	{ label: 'a percentage', pattern: /\d\s*%/ },
	{ label: 'a compact magnitude such as 12k or 4.2M', pattern: /\b\d+(?:\.\d+)?\s?[kmb]\b(?!\w)/i },
	{ label: 'a padded count such as "1,200+"', pattern: /\b\d{1,3}(?:,\d{3})+\+?/ },
	{ label: 'a "1,200+" style claim', pattern: /\b\d+\+/ },
	{ label: 'total value locked', pattern: /\btvl\b|total value locked/i },
	{ label: 'a node count', pattern: /\b\d[\d,.]*\s*(?:nodes|node operators|operators|dons?)\b/i },
	{ label: 'a proof or attestation counter', pattern: /\b\d[\d,.]*\s*(?:proofs?|attestations?|strategies|executions?|runs?)\b/i },
	{ label: 'an uptime or latency figure', pattern: /\b\d[\d.]*\s*(?:ms|%\s*uptime|seconds?)\b/i },
]

test('A. the signed-out root renders the landing page with no fabricated statistics', async ({
	page,
	consoleGuard,
	shot,
}) => {
	await page.goto('/')

	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'Performance you can verify',
	)
	await expect(page.getByRole('link', { name: 'Enter the marketplace' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Browse strategies' }).first()).toBeVisible()

	// Signed out means signed out: no sidebar, no portfolio, no session chrome.
	await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

	const text = await visibleText(page)

	for (const { label, pattern } of FABRICATED_STATISTIC) {
		const match = text.match(pattern)
		expect(match?.[0] ?? null, `the landing page shows ${label}`).toBeNull()
	}

	assertNoFalseClaims(text, 'the landing page')
	// The one factual claim it does make.
	expect(text).toContain('aws nitro enclave')
	expect(text).toContain('us-west-2')

	await shot('browse-01-landing-signed-out', { fullPage: true })
	await page.setViewportSize({ width: 1440, height: 900 })
	await shot('browse-01a-landing-hero')

	expect(consoleGuard.messages).toEqual([])
})
