// Compiling a submitted strategy and evaluating it in an isolated context.
//
// ── Isolation, honestly ─────────────────────────────────────────────────────
//
// The source is transpiled to CommonJS and evaluated in a fresh `node:vm`
// context whose global starts empty. Nothing from this realm is handed in: no
// `require`, no `process`, no `fetch`, no timers, and no `console` — a
// recording stub is defined *inside* the context to stand in for it. The only
// module the sandbox's `require` resolves is the strategy contract, and that is
// evaluated from source inside the same context, so even the default accounting
// functions a strategy re-exports belong to the sandbox realm; handing in this
// realm's copies would have given away our `Function` constructor through
// `defaultOnDeposit.constructor`. Code generation from strings is disabled on
// the context, so `eval` and `new Function` are dead inside it even if the
// static analysis missed a route to them.
//
// What this is NOT is a security boundary. `node:vm` does not claim to be one.
// Two holes remain here by construction:
//
//   * The `StrategyContext` handed to `onTick` is built in this realm, so a
//     strategy can walk out through it — `ctx.constructor.constructor` reaches
//     our `Function`. Callers only ever pass synthetic contexts, but that
//     narrows the blast radius rather than closing the hole.
//   * `timeout` bounds the evaluation calls below and nothing else. A
//     `while (true)` inside `onTick` hangs whichever process calls it, because
//     that call happens outside `runInContext`.
//
// The real boundary is the one the platform already relies on: static analysis
// rejects the obvious escapes before anything gets here, and strategy builds run
// in a sandboxed, network-restricted builder (docs/project-overview.md, "The
// build is the attack surface, not the run"). Treat this loader as a lint that
// executes, not as containment.

import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { REQUIRED_EXPORTS, type StrategyModule } from '../../../shared/strategy-contract'
import {
	CONTRACT_FILE_NAME,
	CONTRACT_SPECIFIER,
	readContractSource,
	STRATEGY_FILE_NAME,
} from './paths'

const EVAL_TIMEOUT_MS = 5_000

const BOOTSTRAP = `
globalThis.__logs = [];
globalThis.console = Object.freeze({
	log: function () { globalThis.__logs.push(Array.prototype.map.call(arguments, String).join(' ')) },
	info: function () { globalThis.__logs.push(Array.prototype.map.call(arguments, String).join(' ')) },
	warn: function () { globalThis.__logs.push(Array.prototype.map.call(arguments, String).join(' ')) },
	error: function () { globalThis.__logs.push(Array.prototype.map.call(arguments, String).join(' ')) },
	debug: function () {},
});
globalThis.__modules = Object.create(null);
globalThis.__define = function (id, factory) { globalThis.__modules[id] = factory() };
globalThis.__require = function (id) {
	if (id in globalThis.__modules) return globalThis.__modules[id];
	throw new Error('module "' + id + '" is not available inside the strategy sandbox');
};
`

/** Wraps transpiled CommonJS so the "use strict" prologue stays first in its function. */
const wrapModule = (js: string): string =>
	`(function () {
	var module = { exports: {} };
	(function (require, module, exports) {
${js}
	})(globalThis.__require, module, module.exports);
	return module.exports;
})()`

function toCommonJs(source: string, fileName: string): string {
	const output = ts.transpileModule(source, {
		fileName,
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
			esModuleInterop: true,
			removeComments: true,
		},
		reportDiagnostics: true,
	})

	const errors = output.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? []
	if (errors.length > 0) {
		throw new Error(
			`cannot transpile ${fileName}: ${errors
				.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
				.join('; ')}`,
		)
	}

	return output.outputText
}

export interface LoadedStrategy {
	module: StrategyModule
	/** Anything the module wrote to `console` while loading. */
	logs: string[]
}

export function loadStrategyVerbose(source: string): LoadedStrategy {
	const context = createContext(
		{},
		{
			name: 'attesta-strategy-sandbox',
			codeGeneration: { strings: false, wasm: false },
		},
	)

	runInContext(BOOTSTRAP, context, { filename: 'sandbox-bootstrap.js', timeout: EVAL_TIMEOUT_MS })

	const contractJs = wrapModule(toCommonJs(readContractSource(), CONTRACT_FILE_NAME))
	runInContext(
		`globalThis.__define(${JSON.stringify(CONTRACT_SPECIFIER)}, function () { return ${contractJs} });`,
		context,
		{ filename: CONTRACT_FILE_NAME, timeout: EVAL_TIMEOUT_MS },
	)

	const strategyJs = wrapModule(toCommonJs(source, STRATEGY_FILE_NAME))
	const exported: unknown = runInContext(strategyJs, context, {
		filename: STRATEGY_FILE_NAME,
		timeout: EVAL_TIMEOUT_MS,
	})

	if (typeof exported !== 'object' || exported === null) {
		throw new Error('strategy module exported nothing')
	}

	const record = exported as Record<string, unknown>
	const missing = REQUIRED_EXPORTS.filter((name) => typeof record[name] !== 'function')
	if (missing.length > 0) {
		throw new Error(`strategy module is missing required exports: ${missing.join(', ')}`)
	}

	const logs = runInContext('globalThis.__logs.slice()', context) as string[]

	return { module: exported as unknown as StrategyModule, logs }
}

export function loadStrategy(source: string): StrategyModule {
	return loadStrategyVerbose(source).module
}
