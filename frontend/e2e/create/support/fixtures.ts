import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { SHOT_DIR } from '../create.config'

/**
 * Shared guards for the creator journeys.
 *
 * A console error or a rejected API call during a demo journey is a defect in the
 * journey, so both are collected and asserted on rather than left to scroll past. The
 * network recorder is the load-bearing one here: journey D proves that what leaves the
 * browser for `/secrets` is ciphertext, and that can only be proved from the wire.
 */

/** Dev-server and browser chatter that says nothing about the product. */
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

export interface RecordedRequest {
	method: string
	url: string
	body: string | null
}

export interface NetworkLog {
	/** Every request the page made to the API, in order, with its raw body. */
	readonly requests: RecordedRequest[]
	/** The requests matching a path fragment and method, oldest first. */
	matching(fragment: string, method?: string): RecordedRequest[]
	/** The last request matching a path fragment, or null. */
	last(fragment: string, method?: string): RecordedRequest | null
}

export interface Fixtures {
	consoleGuard: ConsoleGuard
	/** Every API response the page received with a 4xx or 5xx status. */
	apiFailures: string[]
	network: NetworkLog
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

	network: async ({ page }, use) => {
		const requests: RecordedRequest[] = []
		const record = (request: Request) => {
			if (!request.url().includes('/api/')) return
			requests.push({ method: request.method(), url: request.url(), body: request.postData() })
		}
		page.on('request', record)

		const filter = (fragment: string, method?: string) =>
			requests.filter(
				(entry) => entry.url.includes(fragment) && (method === undefined || entry.method === method),
			)

		await use({
			requests,
			matching: filter,
			last(fragment, method) {
				const found = filter(fragment, method)
				return found.length === 0 ? null : (found[found.length - 1] as RecordedRequest)
			},
		})
	},

	shot: async ({ page }, use) => {
		fs.mkdirSync(SHOT_DIR, { recursive: true })
		await use(async (name, options = {}) => {
			const file = path.join(SHOT_DIR, `${name}.png`)
			// Web fonts and the editor's own paint both settle a beat after a change.
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
