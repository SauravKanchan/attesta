// The tick loop that makes a strategy's returns real: advance the oracle, run
// the strategy's own workflow in the simulated enclave, price what it decided,
// settle it on-chain, snapshot NAV.
//
//   createScheduler()  start(), stop(), tickOnce(strategyId)
//   runTick()          one tick, no timers — what tickOnce calls
//   priceDecision()    the pure arithmetic that turns weights into a signed delta

export { schedulerConfig, type SchedulerConfig } from './config.js'
export {
	priceMap,
	type OraclePort,
	type OracleReadOptions,
	type OracleSnapshot,
} from './ports.js'
export {
	clampPnl,
	priceDecision,
	settlementFor,
	truncatingDiv,
	type ClampedPnl,
	type LegPnl,
	type PlannedTrade,
	type PriceDecisionInput,
	type PricedDecision,
	type PnlClamp,
	type Settlement,
} from './pricing.js'
export {
	createScheduler,
	defaultSelectStrategies,
	type Scheduler,
	type SchedulerOptions,
	type SchedulerStatus,
} from './scheduler.js'
export {
	readTickState,
	writeTickState,
	weightsFromLastExecution,
	type DecisionSource,
	type TickState,
} from './state.js'
export {
	formatReason,
	parseReason,
	runTick,
	type TickDeps,
	type TickOutcome,
} from './tick.js'
export { chainPort, defaultDeps, oraclePort, platformAddress } from './wiring.js'
