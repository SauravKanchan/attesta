// Shared DTOs between backend and frontend. Source of truth for the API contract.
// Money is USDC with 6 decimals, carried as a decimal string ("1234.50") across the
// wire so no precision is lost in JSON. Convert with parseUnits/formatUnits (6).

export type StrategyType =
	| 'momentum'
	| 'mean-reversion'
	| 'arbitrage'
	| 'market-making'
	| 'trend-following'
	| 'volatility'
	| 'yield'

export type RiskLevel = 'low' | 'medium' | 'high'

export type StrategyStatus = 'draft' | 'checking' | 'simulating' | 'live' | 'failed' | 'paused'

export interface User {
	id: string
	username: string
	walletAddress: string
	createdAt: string
}

export interface Session {
	token: string
	user: User
}

// ─── Strategy ───────────────────────────────────────────────

export interface StrategyMetrics {
	/** Annualised return derived from the NAV series. Null until enough history. */
	apy: number | null
	/** Cumulative return since inception, as a fraction (0.42 = +42%). */
	totalReturn: number | null
	/** Largest peak-to-trough NAV decline, as a negative fraction. */
	maxDrawdown: number | null
	sharpe: number | null
	/** Total USDC under management. */
	aum: string
	investorCount: number
	/** NAV per share, 6dp decimal string. */
	navPerShare: string
	navSnapshotCount: number
	updatedAt: string | null
}

export interface StrategyVerification {
	/** sha256 of the compiled WASM. The strategy's permanent identity. */
	binaryHash: string | null
	configHash: string | null
	workflowId: string | null
	/** TEE the workflow declares. Always 'nitro' for CRE today. */
	tee: 'nitro'
	regions: string[]
	/** Set once a simulation has produced a signed decision. */
	lastAttestedAt: string | null
	sourceAvailable: boolean
}

export interface StrategySummary {
	id: string
	slug: string
	name: string
	ticker: string
	types: StrategyType[]
	riskLevel: RiskLevel
	status: StrategyStatus
	creator: { id: string; username: string }
	vaultAddress: string | null
	metrics: StrategyMetrics
	verification: StrategyVerification
	/** Recent NAV points for the card sparkline, oldest first. */
	sparkline: number[]
	createdAt: string
}

export interface StrategyDetail extends StrategySummary {
	description: string
	assets: string[]
	sourceCode: string | null
	/** Present only when the caller holds a position. */
	position: Position | null
}

// ─── Positions and portfolio ────────────────────────────────

export interface Position {
	id: string
	strategyId: string
	strategyName: string
	strategySlug: string
	creatorUsername: string
	shares: string
	/** Sum of deposits minus withdrawals, 6dp. */
	costBasis: string
	currentValue: string
	unrealisedPnl: string
	/** Percentage points, not a fraction: 42 = +42%. Unlike `totalReturn`, which is a fraction. */
	unrealisedPnlPct: number
	firstAllocatedAt: string
}

export interface PortfolioSummary {
	totalValue: string
	totalInvested: string
	allTimePnl: string
	/** Percentage points, not a fraction: 42 = +42%. Unlike `totalReturn`, which is a fraction. */
	allTimePnlPct: number
	availableUsdc: string
	walletAddress: string
}

export interface Portfolio {
	summary: PortfolioSummary
	positions: Position[]
	/** Investor's total portfolio value over time. */
	valueSeries: TimeseriesPoint[]
}

// ─── Timeseries ─────────────────────────────────────────────

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all'

export interface TimeseriesPoint {
	t: string
	/** 6dp decimal string. */
	v: string
}

export interface PositionSeries {
	/** The investor's own money over time, starting at their first deposit. */
	points: TimeseriesPoint[]
	/** Deposit and withdrawal markers to draw on the line. */
	events: Array<{ t: string; kind: 'deposit' | 'withdraw'; amount: string; txHash: string }>
	costBasis: string
}

// ─── Trades and executions ──────────────────────────────────

export interface Trade {
	id: string
	strategyId: string
	t: string
	pair: string
	side: 'buy' | 'sell'
	size: string
	price: string
	pnl: string
	txHash: string | null
}

export interface Execution {
	id: string
	strategyId: string
	t: string
	status: 'ok' | 'failed'
	/** Decision the strategy returned from inside the simulated enclave. */
	action: string | null
	targetWeightsBps: Record<string, number> | null
	reason: string | null
	pnlApplied: string | null
	txHash: string | null
	durationMs: number
	error: string | null
}

// ─── Creator submission ─────────────────────────────────────

export interface SanityCheck {
	id:
		| 'parses'
		| 'required-exports'
		| 'forbidden-imports'
		| 'no-side-effects'
		| 'typechecks'
		| 'describe-valid'
		| 'deterministic'
		| 'cre-build'
		| 'cre-simulate'
	label: string
	status: 'pending' | 'running' | 'passed' | 'failed'
	detail: string | null
}

export interface SubmissionDraft {
	id: string
	name: string
	ticker: string
	types: StrategyType[]
	riskLevel: RiskLevel
	description: string
	sourceCode: string
	/** Keys only — values are stored encrypted and never returned. */
	secretKeys: string[]
	checks: SanityCheck[]
	simulationLog: string[]
	binaryHash: string | null
	configHash: string | null
	status: StrategyStatus
	createdAt: string
}

/** Ciphertext produced in the creator's browser. The backend never sees plaintext. */
export interface EncryptedSecret {
	key: string
	ciphertext: string
	/** Which scheme produced it, so the backend can route to the right relay. */
	scheme: 'tdh2-p256-aesgcm' | 'local-dev'
}

// ─── API envelopes ──────────────────────────────────────────

export interface ListStrategiesQuery {
	q?: string
	types?: StrategyType[]
	risk?: RiskLevel
	sort?: 'apy' | 'totalReturn' | 'aum' | 'newest' | 'investors'
	status?: StrategyStatus
	limit?: number
	offset?: number
}

export interface ListStrategiesResponse {
	strategies: StrategySummary[]
	total: number
}

export interface ApiError {
	error: string
	message: string
	details?: unknown
}
