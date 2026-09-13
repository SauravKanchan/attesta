import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Browser verification of the public and browse surfaces.
 *
 * Several agents drive this repo at once, each on its own ports and its own database, so
 * nothing here may assume a default: point E2E_BASE_URL and E2E_API_URL at the stack
 * under test. The suite never starts a server — it drives one that is already running
 * against a database copied from `backend/data/seed-template.db`.
 *
 * The specs are named `*.pw.ts` rather than `*.spec.ts` deliberately: a sibling suite in
 * `frontend/e2e/` runs with `testDir: '.'` and the default `*.spec.ts` glob, and this
 * naming keeps the two suites from picking each other up.
 *
 *   npx playwright test -c e2e/browse/browse.config.ts
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3184'
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4184'

/** Screenshots land where the demo recording reads them from. */
export const SHOT_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'screenshots')

/**
 * Traces, storage state and other run output stay outside the Next project. Written
 * inside it they trip the dev server's file watcher, which recompiles and reloads the
 * page in the middle of a journey.
 */
const RUN_DIR = process.env.E2E_RUN_DIR ?? path.join(__dirname, '..', '..', '..', 'logs', 'e2e-browse')

/** Storage state written by the sign-in journey and reused by the browse journeys. */
export const AUTH_STATE = path.join(RUN_DIR, 'auth', 'investor.json')

const chrome = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }

export default defineConfig({
	testDir: __dirname,
	testMatch: /\.pw\.ts$/,
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	outputDir: path.join(RUN_DIR, 'artifacts'),
	use: {
		baseURL: BASE_URL,
		viewport: { width: 1440, height: 900 },
		colorScheme: 'dark',
		deviceScaleFactor: 2,
		actionTimeout: 20_000,
		navigationTimeout: 45_000,
		trace: 'retain-on-failure',
		video: 'off',
	},
	projects: [
		{ name: 'public', testMatch: /01-landing\.pw\.ts$/, use: chrome },
		{ name: 'signin', testMatch: /02-signin\.pw\.ts$/, use: chrome },
		{
			name: 'browse',
			testMatch: /0[34]-.*\.pw\.ts$/,
			dependencies: ['signin'],
			use: { ...chrome, storageState: AUTH_STATE },
		},
	],
})
