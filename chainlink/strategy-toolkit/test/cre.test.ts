// The real thing: generate a CRE workflow around the template, compile it to
// WASM with the cre CLI, and run one tick through the simulated Nitro enclave
// against a local oracle.
//
// Skipped rather than failed when the CLI or chainlink/.env is missing, since
// .env is gitignored and holds the key the CLI signs with.

import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
	buildWorkflow,
	chainlinkDir,
	creBinary,
	creBuildCheck,
	creSimulateCheck,
	extractDecision,
	generateWorkflow,
	rewriteContractImports,
	simulateWorkflow,
	type WorkflowOptions,
} from '../src/index'
import { readTemplate, TEMPLATE_PATH, walk } from './fixtures'

const ORACLE_PORT = 8788
const PRICES = walk({ seed: 21, ticks: 30, drift: 0.004, vol: 0.008 })

const creAvailable = existsSync(creBinary()) && existsSync(join(chainlinkDir(), '.env'))

let server: Server

beforeAll(async () => {
	server = createServer((_request, response) => {
		const start = 1_700_000_000
		const at = (index: number): number => start + index * 60
		response.setHeader('content-type', 'application/json')
		response.end(
			JSON.stringify({
				t: at(PRICES.length - 1),
				prices: [
					{ symbol: 'ETH', price: PRICES[PRICES.length - 1]?.toFixed(2), t: at(PRICES.length - 1) },
				],
				history: PRICES.slice(0, -1).map((price, index) => ({
					t: at(index),
					prices: [{ symbol: 'ETH', price: price.toFixed(2), t: at(index) }],
				})),
			}),
		)
	})
	await new Promise<void>((resolve) => server.listen(ORACLE_PORT, '127.0.0.1', resolve))
})

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

const options = (): WorkflowOptions => ({
	name: 'toolkit-test',
	oracleUrl: `http://127.0.0.1:${ORACLE_PORT}/api/oracle/prices`,
	// API_TOKEN is the only secret provisioned locally; aliasing it proves the
	// Vault path runs without asking creators to know the platform's ids.
	secretAliases: { TARGET_WEIGHT_BPS: 'API_TOKEN' },
	currentWeightsBps: { ETH: 0 },
})

describe('workflow generation', () => {
	test('rewrites the contract specifier without touching anything else', () => {
		const rewritten = rewriteContractImports(readTemplate(TEMPLATE_PATH), './strategy-contract')
		expect(rewritten).not.toContain("'@attesta/strategy-contract'")
		expect(rewritten).toContain('"./strategy-contract"')
		expect(rewritten).toContain('export const onTick')
	})

	test('writes a complete CRE workflow directory', async () => {
		const workflow = await generateWorkflow(readTemplate(TEMPLATE_PATH), options())
		for (const file of ['workflow.ts', 'main.ts', 'strategy.ts', 'strategy-contract.ts', 'workflow.yaml', 'config.staging.json', 'package.json', 'tsconfig.json']) {
			expect(existsSync(join(workflow.dir, file)), file).toBe(true)
		}
		expect(workflow.relativeDir.startsWith('strategy-toolkit/')).toBe(true)
	})
})

describe('decision parsing', () => {
	const decision = '{"action":"ENTER","targetWeightsBps":{"ETH":8000},"reason":"above the mean"}'

	test('reads the enclave log line', () => {
		expect(extractDecision(`2026-01-01 [USER LOG] attesta-decision:${decision}`)).toEqual({
			action: 'ENTER',
			targetWeightsBps: { ETH: 8000 },
			reason: 'above the mean',
		})
	})

	test('falls back to the JSON-escaped simulation result', () => {
		const escaped = JSON.stringify(`attesta-decision:${decision}`)
		expect(extractDecision(`Workflow Simulation Result:\n${escaped}\n`)?.action).toBe('ENTER')
	})

	test('returns null when there is no decision in the output', () => {
		expect(extractDecision('Workflow Simulation Result:\n"APPROVE (score: 803)"')).toBeNull()
	})
})

describe.runIf(creAvailable)('cre CLI', () => {
	test('builds the template to a WASM binary', async () => {
		const result = await buildWorkflow(readTemplate(TEMPLATE_PATH), options())
		expect(result.stderr + result.stdout).toBeTruthy()
		expect(result.ok, result.stderr || result.stdout).toBe(true)
		expect(result.binaryHash).toMatch(/^[0-9a-f]{64}$/)
		expect(existsSync(result.wasmPath)).toBe(true)
		expect(creBuildCheck(result)).toMatchObject({ id: 'cre-build', status: 'passed' })
	}, 600_000)

	test('simulates one tick inside the enclave and returns the decision', async () => {
		const result = await simulateWorkflow(readTemplate(TEMPLATE_PATH), options())
		expect(result.ok, result.stderr || result.stdout).toBe(true)
		expect(result.binaryHash).toMatch(/^[0-9a-f]{64}$/)
		expect(result.configHash).toMatch(/^[0-9a-f]{64}$/)

		// The prices trend up, so the template's crossover has to enter.
		expect(result.decision).toEqual({
			action: 'ENTER',
			targetWeightsBps: { ETH: 8000 },
			reason: 'ETH above its 12-tick mean',
		})
		expect(result.enclaveLogs.some((line) => line.includes('crossed above'))).toBe(true)
		expect(creSimulateCheck(result)).toMatchObject({ id: 'cre-simulate', status: 'passed' })
	}, 600_000)
})
