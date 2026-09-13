// The creator submission pipeline: everything between "pasted some TypeScript"
// and "a live strategy with a vault, an anchor on-chain and a workflow the
// scheduler can simulate".
//
//   runChecks()          the nine sanity checks, streamed as they resolve
//   publishSubmission()  deploy, fund, anchor, go live — idempotently
//   ensureWorkflow()     the kept CRE workflow directory a tick reuses
//   simulateWorkspace()  one enclave run over that directory

export { strategyConfig, type StrategyConfig } from './config.js'
export {
	runChecks,
	runChecksToCompletion,
	type CheckEvent,
	type CheckId,
	type CheckRunResult,
	type RunChecksOptions,
} from './pipeline.js'
export {
	consoleLogger,
	type ApplyPnlParams,
	type ChainPort,
	type DeployVaultParams,
	type DeployVaultResult,
	type Logger,
	type RecordTradeParams,
	type RegisterStrategyParams,
	type TxResult,
	type VaultTotals,
} from './ports.js'
export {
	onChainStrategyId,
	publishSubmission,
	type PublishOptions,
	type PublishResult,
	type PublishStep,
	type PublishStepName,
} from './publish.js'
export { discoverSecretIds, probeSeries, type ProbeSeries } from './secrets.js'
export {
	buildWorkspace,
	creAvailable,
	failureDetail,
	simulateWorkspace,
	wasmExists,
	type CreBuildOutcome,
	type CreRun,
	type CreRunOptions,
	type CreSimulateOutcome,
} from './simulate.js'
export {
	ensureWorkflow,
	moveWorkspace,
	openWorkspace,
	recordHashes,
	slugify,
	sourceFingerprint,
	workspacePath,
	writeSecretsFiles,
	writeTickConfig,
	type TickConfig,
	type Workspace,
	type WorkflowScope,
	type WorkspaceMeta,
} from './workspace.js'
