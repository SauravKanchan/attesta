// @attesta/strategy-toolkit — everything the platform does to a creator's
// TypeScript between "submitted" and "live", with no dependency on the backend
// so the backend can import it.
//
//   analyse()            static AST checks: parses, exports, imports, side effects
//   typecheck()          tsc --noEmit against the strategy contract
//   loadStrategy()       compile and evaluate in an isolated context
//   checkDescribe()      metadata is usable
//   checkDeterminism()   same context in, same decision out
//   buildWorkflow()      generate a CRE workflow and compile it to WASM
//   simulateWorkflow()   run one tick inside the simulated enclave
//   runBacktest()        the NAV curve the listing's metrics are derived from
//   runPipeline()        all of the above, in order, stopping at the first failure

export { analyse, collectExports, parseStrategy, type ParsedStrategy } from './analyse'
export {
	annualisedReturn,
	DEFAULT_FEE_BPS,
	maxDrawdown,
	runBacktest,
	type BacktestOptions,
	type BacktestResult,
	type BacktestTick,
} from './backtest'
export {
	allPassed,
	CHECK_LABELS,
	CHECK_ORDER,
	firstFailure,
	makeCheck,
	type CheckId,
} from './checks'
export {
	BPS,
	buildPriceSeries,
	fromPrice6,
	HISTORY_LIMIT,
	makeContext,
	normaliseWeights,
	probeContext,
	stableSerialise,
	toPrice6,
	type MakeContextOptions,
} from './context'
export {
	buildWorkflow,
	creBinary,
	creBuildCheck,
	creSimulateCheck,
	DECISION_PREFIX,
	extractDecision,
	extractEnclaveLogs,
	generateWorkflow,
	rewriteContractImports,
	simulateWorkflow,
	type CreBuildResult,
	type CreRunResult,
	type CreSimulateResult,
	type GeneratedWorkflow,
	type WorkflowOptions,
} from './cre'
export { loadStrategy, loadStrategyVerbose, type LoadedStrategy } from './load'
export {
	CONTRACT_FILE_NAME,
	CONTRACT_SPECIFIER,
	chainlinkDir,
	contractSourcePath,
	readContractSource,
	STRATEGY_FILE_NAME,
	templatesDir,
	toolkitDir,
} from './paths'
export { runPipeline, type PipelineOptions, type PipelineResult } from './pipeline'
export { checkDescribe, checkDeterminism, errorText } from './runtime-checks'
export { typecheck, typecheckVerbose, type TypecheckOptions, type TypecheckResult } from './typecheck'
