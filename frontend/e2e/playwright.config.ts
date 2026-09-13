import { defineConfig, devices } from '@playwright/test'

/**
 * Browser verification of the money journey. Points at the stack this agent runs on its
 * own ports so it never collides with another session's backend or database:
 * frontend 3185, backend 4185.
 */
export default defineConfig({
	testDir: '.',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	expect: { timeout: 20_000 },
	reporter: [['list']],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3185',
		viewport: { width: 1440, height: 900 },
		colorScheme: 'dark',
		deviceScaleFactor: 2,
		actionTimeout: 30_000,
		navigationTimeout: 60_000,
		trace: 'off',
		video: 'off',
		screenshot: 'off',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
