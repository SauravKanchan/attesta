import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Browser verification of the creator flow: write a strategy, encrypt its parameters,
 * run the nine pre-flight checks and publish.
 *
 * Several agents drive this repo at once, each on its own ports and its own database, so
 * nothing here may assume a default: point E2E_BASE_URL and E2E_API_URL at the stack
 * under test. The suite never starts a server — it drives one that is already running
 * against a database copied from `backend/data/seed-template.db`.
 *
 * Specs are `*.pw.ts` for the same reason as the browse suite: `frontend/e2e/` runs with
 * `testDir: '.'` and the default `*.spec.ts` glob, and this keeps the suites apart.
 *
 *   npx playwright test -c e2e/create/create.config.ts
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3186'
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4186'

/** Screenshots land where the demo recording reads them from. */
export const SHOT_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'screenshots')

/** The examples the create flow is exercised with, read off disk rather than inlined. */
export const EXAMPLES_DIR = path.join(__dirname, '..', '..', '..', 'chainlink', 'templates', 'examples')

/**
 * Traces and storage state stay outside the Next project. Written inside it they trip the
 * dev server's file watcher, which recompiles and reloads the page mid-journey.
 */
const RUN_DIR = process.env.E2E_RUN_DIR ?? path.join(__dirname, '..', '..', '..', 'logs', 'e2e-create')

/** Storage state written by the sign-in journey and reused by the creator journeys. */
export const AUTH_STATE = path.join(RUN_DIR, 'auth', 'creator.json')

/** Where a journey records timings worth reporting, such as how long the checks take. */
export const TIMING_LOG = path.join(RUN_DIR, 'timings.json')

const chrome = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }

export default defineConfig({
	testDir: __dirname,
	testMatch: /\.pw\.ts$/,
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	// `cre workflow build` compiles to WASM and `cre workflow simulate` runs it, so the
	// publish journey is minutes long by nature rather than by accident.
	timeout: 900_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	outputDir: path.join(RUN_DIR, 'artifacts'),
	use: {
		baseURL: BASE_URL,
		viewport: { width: 1440, height: 900 },
		colorScheme: 'dark',
		deviceScaleFactor: 2,
		actionTimeout: 30_000,
		navigationTimeout: 60_000,
		trace: 'retain-on-failure',
		video: 'off',
	},
	projects: [
		{ name: 'signin', testMatch: /01-signin\.pw\.ts$/, use: chrome },
		{
			name: 'create',
			testMatch: /0[23]-.*\.pw\.ts$/,
			dependencies: ['signin'],
			use: { ...chrome, storageState: AUTH_STATE },
		},
	],
})
