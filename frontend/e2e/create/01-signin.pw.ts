import fs from 'node:fs'
import path from 'node:path'
import { AUTH_STATE } from './create.config'
import { assertNoFalseClaims, expect, test, visibleText } from './support/fixtures'

/**
 * Journey A — sign in as a creator and open Create strategy.
 *
 * The creator signs in exactly as an investor does: the key stays in the browser and what
 * crosses the wire is an address and a signature over the nonce the backend issued. This
 * journey also writes the storage state the create journeys reuse, so it runs first and
 * its failure stops them.
 *
 * Account #3 rather than #1, so a creator run and a concurrent investor run are not the
 * same address competing for the same nonce.
 */

const CREATOR_ACCOUNT = 3

test('A. a creator signs in and opens the create flow', async ({ page, consoleGuard, shot }) => {
	await page.goto('/login')

	const quickPick = page.getByRole('button', { name: new RegExp(`^#${CREATOR_ACCOUNT} 0x`) })
	await expect(quickPick).toBeVisible()
	await quickPick.click()

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

	// Reaching the create flow is a click from the marketplace, not a typed URL.
	await page.getByRole('link', { name: /create strategy/i }).first().click()
	await page.waitForURL('**/create')

	await expect(page.getByRole('heading', { name: 'Create strategy', level: 1 })).toBeVisible()
	await expect(page.locator('.cm-content')).toBeVisible()

	assertNoFalseClaims(await visibleText(page), 'the create flow')
	await shot('create-01-code-step-template')

	fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true })
	await page.context().storageState({ path: AUTH_STATE })

	expect(consoleGuard.messages).toEqual([])
})
