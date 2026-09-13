import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'

/**
 * The investor money journey, driven in a real browser: sign in, faucet, allocate,
 * settle ticks, withdraw. Every transaction is signed in the page — the assertions below
 * fail if the backend is ever handed an amount instead of a transaction hash.
 */

const run = promisify(execFile)

const here = __dirname
const repoRoot = resolve(here, '../..')
const shots = resolve(repoRoot, 'docs/screenshots')
const evidenceFile = resolve(here, '.artifacts/money-journey.json')

/** anvil account #5, off the bottom of the picker so a concurrent session's nonce cannot race it. */
const ACCOUNT_INDEX = 5
/** anvil's published key for that account, asserted never to appear in a request body. */
const ACCOUNT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
/** The only seeded strategy that trades on its first tick; momentum and mean-reversion warm up for 20. */
const SLUG = 'churn'
const DEPOSIT_USDC = '2500'
const WITHDRAW_USDC = '1000'
const TICKS = Number(process.env.E2E_TICKS ?? '4')

interface Captured {
	url: string
	method: string
	body: string | null
}

const captured: Captured[] = []
const evidence: Record<string, unknown> = {}

let context: BrowserContext
let page: Page

function record(step: string, value: unknown): void {
	evidence[step] = value
	mkdirSync(dirname(evidenceFile), { recursive: true })
	writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
}

async function shot(name: string, fullPage = true): Promise<void> {
	mkdirSync(shots, { recursive: true })
	await page.screenshot({ path: resolve(shots, `${name}.png`), fullPage })
}

function moneyPosts(match: string): Captured[] {
	return captured.filter((entry) => entry.method === 'POST' && entry.url.includes(match))
}

/** A StatTile renders its label and its value as sibling paragraphs. */
async function tile(label: string): Promise<string> {
	const value = page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::p[1]')
	return (await value.innerText()).replace(/\s+/g, ' ').trim()
}

function positionHeading() {
	return page.getByRole('heading', { name: 'Your position' })
}

async function positionText(): Promise<string> {
	const section = page.locator('section').filter({ has: positionHeading() }).first()
	return (await section.innerText()).replace(/\s+/g, ' ').trim()
}

/**
 * One tick, driven the way the CLI drives it. Retried because the strategy's agent wallet
 * is a single anvil account on a chain several sessions share: a concurrent tick of the
 * same strategy takes the nonce and this one comes back "transaction already imported".
 */
async function tick(slug: string): Promise<string> {
	let lastError: unknown = null
	for (let attempt = 1; attempt <= 4; attempt += 1) {
		try {
			const { stdout } = await run('node', ['--import', 'tsx', 'src/scheduler/tick-once.ts', slug], {
				cwd: resolve(repoRoot, 'backend'),
				env: {
					...process.env,
					DATABASE_URL: './data/e2e-money-ui.db',
					PORT: '4185',
					ORACLE_URL: 'http://127.0.0.1:4185/api/oracle/prices',
				},
				timeout: 300_000,
				maxBuffer: 32 * 1024 * 1024,
			})
			const summary = stdout.slice(stdout.indexOf('── tick'))
			console.log(summary)
			return summary
		} catch (error) {
			lastError = error
			const message = error instanceof Error ? error.message : String(error)
			console.log(`  [tick ${slug} attempt ${attempt} failed] ${message.slice(0, 200)}`)
			await new Promise((done) => setTimeout(done, 5_000))
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`tick ${slug} failed`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
	context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
	page = await context.newPage()
	page.on('request', (request: Request) => {
		const url = request.url()
		if (!url.includes('/api/')) return
		captured.push({ url, method: request.method(), body: request.postData() })
	})
	page.on('console', (message) => {
		if (message.type() === 'error') console.log(`  [browser console] ${message.text()}`)
	})
	page.on('pageerror', (error) => console.log(`  [page error] ${error.message}`))
	page.on('response', async (response) => {
		if (!response.url().includes('/api/') || response.status() < 400) return
		console.log(`  [api ${response.status()}] ${response.url()} ${(await response.text()).slice(0, 400)}`)
	})
})

test.afterAll(async () => {
	await context?.close()
})

test('A · sign in with an anvil test account', async () => {
	await page.goto('/login')
	await expect(page.getByRole('heading', { name: 'anvil test accounts' })).toBeVisible()

	await page.locator('li button', { hasText: `#${ACCOUNT_INDEX}` }).first().click()
	await shot('money-01-login-key-picked')

	await page.getByRole('button', { name: 'Sign in', exact: true }).click()
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
	await expect(page.getByRole('link', { name: /Portfolio/ })).toBeVisible()
	// The grid paints skeletons first; a screenshot taken before the listing lands is of
	// the loading state, not the marketplace.
	await expect(page.locator(`a[href="/strategy/${SLUG}"]`).first()).toBeVisible({ timeout: 60_000 })
	await shot('money-02-signed-in-marketplace')

	const challenge = moneyPosts('/auth/challenge')
	const verify = moneyPosts('/auth/verify')
	expect(challenge.length).toBeGreaterThan(0)
	expect(verify.length).toBeGreaterThan(0)
	// The seam: the key that signed never crosses the wire, only the signature it produced.
	for (const call of [...challenge, ...verify]) {
		expect(call.body ?? '').not.toMatch(/privateKey/i)
		expect(call.body ?? '').not.toContain(ACCOUNT_KEY)
	}
	record('signIn', { challenge: challenge[0]?.body, verify: verify[0]?.body })
})

test('A2 · faucet mints USDC and tops up gas', async () => {
	await page.goto('/portfolio')
	await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible({ timeout: 60_000 })
	await page.getByRole('button', { name: 'Add funds' }).click()
	await expect(page.getByText('Wallet funded')).toBeVisible({ timeout: 60_000 })
	await expect(page.getByText('No ETH for gas')).toHaveCount(0)
	await shot('money-03-faucet-funded')

	const available = await tile('Available USDC')
	record('faucet', { availableTile: available })
	expect(available).toMatch(/\d/)
})

test('B · allocate — the browser signs approve and deposit', async () => {
	await page.goto('/')
	const card = page.locator(`a[href="/strategy/${SLUG}"]`).first()
	await expect(card).toBeVisible({ timeout: 60_000 })
	await card.click()
	await page.waitForURL(`**/strategy/${SLUG}`)
	await expect(page.getByRole('heading', { name: 'Allocate' })).toBeVisible({ timeout: 60_000 })
	await shot('money-04-strategy-uninvested')

	await page.locator('#amount-USDC').fill(DEPOSIT_USDC)
	const allocate = page.getByRole('button', { name: 'Allocate USDC' })
	await expect(allocate).toBeEnabled()
	await allocate.click()

	await expect(page.getByText('Allocation confirmed')).toBeVisible({ timeout: 120_000 })
	await shot('money-05-allocation-confirmed')

	const posts = moneyPosts(`/strategies/${SLUG}/invest`)
	expect(posts.length).toBe(1)
	const body = JSON.parse(posts[0]!.body ?? '{}') as Record<string, unknown>
	record('invest', { body })
	// The blocker check: the backend is handed a hash it verifies, never an amount.
	expect(Object.keys(body)).toEqual(['txHash'])
	expect(String(body.txHash)).toMatch(/^0x[0-9a-f]{64}$/)
	expect(JSON.stringify(body)).not.toContain(DEPOSIT_USDC)
})

test('C · the position shows a cost basis and survives a reload', async () => {
	await expect(positionHeading()).toBeVisible({ timeout: 30_000 })
	const before = await positionText()

	await page.reload()
	await expect(positionHeading()).toBeVisible({ timeout: 60_000 })
	const after = await positionText()
	record('position', { before, after })

	// The label is uppercased in CSS, so innerText reports it that way.
	// The label is uppercased in CSS, so innerText reports it that way. The cost basis is
	// the figure that has to survive the reload; the current value is free to move under it.
	expect(before).toContain('$2,500.00')
	expect(after).toMatch(/INVESTED/)
	expect(after).toContain('$2,500.00')
	await shot('money-06-position-after-reload')
})

test('D · scheduler ticks move the position value', async () => {
	test.setTimeout(900_000)
	const before = await positionText()

	const ticks: string[] = []
	for (let i = 0; i < TICKS; i += 1) ticks.push(await tick(SLUG))

	await page.reload()
	await expect(positionHeading()).toBeVisible({ timeout: 60_000 })
	const after = await positionText()

	record('tick', { before, after, ticks })
	await shot('money-07-position-after-tick')
	expect(after).not.toBe(before)
})

test('E · the detail page in its invested state, on the investor series', async () => {
	await expect(page.getByRole('heading', { name: 'Your value over time' })).toBeVisible({ timeout: 30_000 })
	await expect(page.getByText('Cost basis')).toBeVisible()
	await shot('money-08-your-value-chart')

	await page.getByRole('radio', { name: 'Strategy NAV' }).click()
	await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible()
	await shot('money-09-strategy-nav-chart')
	await page.getByRole('radio', { name: 'Your value' }).click()
})

test('F · portfolio shows the position, the chart and the creator tab', async () => {
	await page.goto('/portfolio')
	await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible({ timeout: 60_000 })
	await expect(page.getByText('ETH Overtrader').first()).toBeVisible({ timeout: 30_000 })
	await shot('money-10-portfolio-invested')

	record('portfolio', {
		totalValue: await tile('Total value'),
		totalInvested: await tile('Total invested'),
		availableUsdc: await tile('Available USDC'),
	})

	await page.getByRole('tab', { name: /My strategies/ }).click()
	await shot('money-11-portfolio-my-strategies')
	await page.getByRole('tab', { name: /Investments/ }).click()
})

test('G · withdraw part of the position through the modal', async () => {
	const usdcBefore = await tile('Available USDC')
	const valueBefore = await tile('Total value')

	await page.getByRole('button', { name: 'Withdraw', exact: true }).first().click()
	await expect(page.getByRole('dialog')).toBeVisible()
	await page.getByRole('dialog').locator('input').first().fill(WITHDRAW_USDC)
	await shot('money-12-withdraw-modal', false)

	await page.getByRole('button', { name: 'Confirm withdrawal' }).click()
	await expect(page.getByText('Withdrawal settled')).toBeVisible({ timeout: 120_000 })
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(page.getByText('Withdrawal settled')).toHaveCount(0, { timeout: 20_000 })
	await shot('money-13-after-withdrawal')

	const posts = moneyPosts(`/strategies/${SLUG}/withdraw`)
	expect(posts.length).toBe(1)
	const body = JSON.parse(posts[0]!.body ?? '{}') as Record<string, unknown>
	expect(Object.keys(body)).toEqual(['txHash'])

	const usdcAfter = await tile('Available USDC')
	const valueAfter = await tile('Total value')
	record('withdraw', { body, usdcBefore, usdcAfter, valueBefore, valueAfter })
	expect(usdcAfter).not.toBe(usdcBefore)
	expect(valueAfter).not.toBe(valueBefore)
})

test('H · a full exit redeems the remaining shares and clears the position', async () => {
	const usdcBefore = await tile('Available USDC')

	await page.getByRole('button', { name: 'Withdraw', exact: true }).first().click()
	await expect(page.getByRole('dialog')).toBeVisible()
	// Max sends the share balance verbatim rather than a figure converted back from USDC,
	// so rounding cannot strand dust that is then impossible to redeem.
	await page.getByRole('dialog').getByRole('button', { name: 'Max' }).click()
	await shot('money-14-full-exit-modal', false)

	await page.getByRole('button', { name: 'Confirm withdrawal' }).click()
	await expect(page.getByText('Withdrawal settled')).toBeVisible({ timeout: 120_000 })
	await expect(page.getByText('No allocations yet')).toBeVisible({ timeout: 30_000 })
	await expect(page.getByText('Withdrawal settled')).toHaveCount(0, { timeout: 20_000 })
	await shot('money-15-position-closed')

	// The strategy page has to agree: nothing is held there any more.
	await page.goto(`/strategy/${SLUG}`)
	await expect(page.getByRole('heading', { name: 'Allocate' })).toBeVisible({ timeout: 60_000 })
	await expect(positionHeading()).toHaveCount(0)
	await shot('money-16-strategy-after-exit')
	await page.goto('/portfolio')
	await expect(page.getByText('No allocations yet')).toBeVisible({ timeout: 60_000 })

	const usdcAfter = await tile('Available USDC')
	record('fullExit', {
		usdcBefore,
		usdcAfter,
		totalValue: await tile('Total value'),
		withdrawCalls: moneyPosts(`/strategies/${SLUG}/withdraw`).length,
	})
	expect(usdcAfter).not.toBe(usdcBefore)
	expect(await tile('Total value')).toBe('$0.00')
})
