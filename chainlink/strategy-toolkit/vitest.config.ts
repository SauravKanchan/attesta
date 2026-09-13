import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		// tsc and the cre CLI are both shelled out to; neither is fast.
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
})
