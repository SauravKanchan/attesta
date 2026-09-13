import fs from 'node:fs'
import path from 'node:path'
import { AUTH_STATE } from './browse.config'
import { expect, test } from './support/fixtures'

/**
 * Journey B — sign in with an anvil quick-pick account and land on the marketplace.
 *
 * The key never leaves the browser: what crosses the wire is an address and a signature
 * over the nonce the backend issued. This journey also writes the storage state the
 * browse specs reuse, so it runs first and its failure stops them.
 */

test('B. signing in with an anvil test account lands on the marketplace', async ({
	page,
	consoleGuard,
	shot,
}) => {
	await page.goto('/login')

	await expect(page.getByRole('heading', { name: 'anvil test accounts' })).toBeVisible()
	const quickPick = page.getByRole('button', { name: /^#1 0x/ })
	await expect(quickPick).toBeVisible()
	await shot('browse-02-login-quick-pick')

	await quickPick.click()

	// The screen derives the address locally, before anything is sent.
	await expect(page.locator('form').getByTitle(/^0x/)).toBeVisible()

	const challenge = page.waitForResponse(
		(response) => response.url().includes('/auth/challenge') && response.request().method() === 'POST',
	)
	const verify = page.waitForResponse(
		(response) => response.url().includes('/auth/verify') && response.request().method() === 'POST',
	)

	await page.getByRole('button', { name: 'Sign in' }).click()

	expect((await challenge).status()).toBe(200)
	const verified = await verify
	expect(verified.status()).toBe(200)

	// The private key is the one thing that may never be posted.
	const challengeBody = JSON.parse((await challenge).request().postData() ?? '{}')
	expect(Object.keys(challengeBody)).toEqual(['address'])
	const verifyBody = JSON.parse(verified.request().postData() ?? '{}')
	expect(Object.keys(verifyBody).sort()).toEqual(['address', 'signature'])

	await page.waitForURL('**/')
	await expect(page.getByRole('heading', { name: 'Marketplace', level: 1 })).toBeVisible()
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
	await expect(page.locator('article').first()).toBeVisible()

	await shot('browse-03-marketplace-signed-in')

	fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true })
	await page.context().storageState({ path: AUTH_STATE })

	expect(consoleGuard.messages).toEqual([])
})
