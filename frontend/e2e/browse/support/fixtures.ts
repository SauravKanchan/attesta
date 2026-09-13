import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SHOT_DIR } from '../browse.config'

/**
 * Nothing here is allowed to be noise. A console error or an unhandled rejection during
 * a demo journey is a defect in the journey, so the guard collects both and the tests
 * assert on them explicitly rather than letting them scroll past.
 */

/** Dev-server chatter that says nothing about the product. */
const IGNORED = [
	/Download the React DevTools/i,
	/\[Fast Refresh\]/i,
	/favicon\.ico/i,
	/React DevTools/i,
]

export interface ConsoleGuard {
	/** Console errors and page errors, oldest first. */
	readonly messages: string[]
	/** Everything seen so far, cleared. Use when a step deliberately provokes an error. */
	drain(): string[]
}

export interface Fixtures {
	consoleGuard: ConsoleGuard
	/** Every API response the page received with a 4xx or 5xx status. */
	apiFailures: string[]
	shot: (name: string, options?: { fullPage?: boolean }) => Promise<string>
}

export const test = base.extend<Fixtures>({
	consoleGuard: async ({ page }, use) => {
		const messages: string[] = []
		const record = (text: string) => {
			if (IGNORED.some((pattern) => pattern.test(text))) return
			messages.push(text)
		}

		page.on('console', (message) => {
			if (message.type() === 'error') record(`console.error: ${message.text()}`)
		})
		page.on('pageerror', (error) => record(`pageerror: ${error.message}`))
		page.on('requestfailed', (request) => {
			const failure = request.failure()?.errorText ?? 'unknown'
			// A navigation the test itself aborted is not a product failure.
			if (failure === 'net::ERR_ABORTED') return
			record(`requestfailed: ${request.method()} ${request.url()} (${failure})`)
		})

		await use({
			messages,
			drain(): string[] {
				const seen = [...messages]
				messages.length = 0
				return seen
			},
		})
	},

	apiFailures: async ({ page }, use) => {
		const failures: string[] = []
		page.on('response', (response) => {
			if (response.status() < 400) return
			if (!response.url().includes('/api/')) return
			failures.push(`${response.status()} ${response.request().method()} ${response.url()}`)
		})
		await use(failures)
	},

	shot: async ({ page }, use) => {
		fs.mkdirSync(SHOT_DIR, { recursive: true })
		await use(async (name, options = {}) => {
			const file = path.join(SHOT_DIR, `${name}.png`)
			// Web fonts and the chart's entry animation both settle a beat after load.
			await page.waitForTimeout(400)
			await page.screenshot({ path: file, fullPage: options.fullPage ?? false })
			return file
		})
	},
})

export { expect }

/** Every string the reader can see, lowercased, for the false-claim sweep. */
export async function visibleText(page: Page): Promise<string> {
	return (await page.locator('body').innerText()).toLowerCase()
}

/**
 * Claims this system cannot make. AWS Nitro Enclaves in us-west-2 is the whole of the
 * trust story; anything below would be a false cryptographic claim on camera.
 */
export const FORBIDDEN_CLAIMS = [
	'intel sgx',
	'mrenclave',
	'zk-stark',
	'zk stark',
	'zero-knowledge',
	'zero knowledge',
	'quorum',
]

export function assertNoFalseClaims(text: string, where: string): void {
	const found = FORBIDDEN_CLAIMS.filter((claim) => text.includes(claim))
	expect(found, `${where} makes a claim this system cannot support`).toEqual([])
}
