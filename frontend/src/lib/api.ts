import type {
	ApiError as ApiErrorBody,
	EncryptedSecret,
	Execution,
	ListStrategiesQuery,
	ListStrategiesResponse,
	Portfolio,
	Position,
	PositionSeries,
	Session,
	StrategyDetail,
	SubmissionDraft,
	TimeRange,
	TimeseriesPoint,
	Trade,
	User,
} from '@/lib/types'

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')

const TOKEN_STORAGE_KEY = 'attesta.session.token'

/* ── Session token ───────────────────────────────────────── */

export function getToken(): string | null {
	if (typeof window === 'undefined') return null
	try {
		return window.localStorage.getItem(TOKEN_STORAGE_KEY)
	} catch (error) {
		console.error('attesta: could not read the session token from localStorage', error)
		return null
	}
}

export function setToken(token: string | null): void {
	if (typeof window === 'undefined') return
	try {
		if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY)
		else window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
	} catch (error) {
		console.error('attesta: could not persist the session token to localStorage', error)
	}
}

/* ── Errors ──────────────────────────────────────────────── */

/** Every failure out of this module — transport, HTTP status, or unparseable body. */
export class ApiError extends Error {
	/** HTTP status, or 0 when the request never reached the backend. */
	readonly status: number
	/** Machine-readable code, mirroring `ApiError.error` on the wire. */
	readonly code: string
	readonly details: unknown

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message)
		this.name = 'ApiError'
		this.status = status
		this.code = code
		this.details = details
	}
}

/* ── Transport ───────────────────────────────────────────── */

type QueryValue = string | number | boolean | readonly string[] | undefined | null

interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH'
	body?: unknown
	query?: Record<string, QueryValue>
	signal?: AbortSignal
}

/** Repeated keys carry list filters, matching the backend's array query parsing. */
function buildUrl(path: string, query?: Record<string, QueryValue>): string {
	const url = new URL(`${API_BASE_URL}/api${path}`)
	if (!query) return url.toString()
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === '') continue
		if (Array.isArray(value)) {
			for (const entry of value) url.searchParams.append(key, entry)
		} else {
			url.searchParams.set(key, String(value))
		}
	}
	return url.toString()
}

async function toApiError(response: Response): Promise<ApiError> {
	let body: Partial<ApiErrorBody> = {}
	try {
		body = (await response.json()) as Partial<ApiErrorBody>
	} catch (error) {
		console.error(`attesta: ${response.status} from ${response.url} had no JSON error body`, error)
	}
	return new ApiError(
		response.status,
		body.error ?? 'http_error',
		body.message ?? response.statusText ?? 'The request failed',
		body.details,
	)
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
	const { method = 'GET', body, query, signal } = options
	const headers: Record<string, string> = { Accept: 'application/json' }
	const token = getToken()
	if (token) headers.Authorization = `Bearer ${token}`
	if (body !== undefined) headers['Content-Type'] = 'application/json'

	let response: Response
	try {
		response = await fetch(buildUrl(path, query), {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
			cache: 'no-store',
		})
	} catch (error) {
		console.error(`attesta: ${method} ${path} never reached ${API_BASE_URL}`, error)
		const message = error instanceof Error ? error.message : 'The backend is unreachable'
		throw new ApiError(0, 'network_error', message, error)
	}

	if (!response.ok) throw await toApiError(response)
	return response
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
	const response = await send(path, options)
	if (response.status === 204) return undefined as T
	try {
		return (await response.json()) as T
	} catch (error) {
		console.error(`attesta: could not parse the JSON body of ${response.url}`, error)
		throw new ApiError(response.status, 'malformed_response', 'The backend returned a malformed body', error)
	}
}

async function requestText(path: string, options?: RequestOptions): Promise<string> {
	const response = await send(path, options)
	return response.text()
}

/* ── Response shapes with no DTO in shared/types.ts ───────── */

/** GET /oracle/prices — PriceSnapshot with the 6dp price carried as a decimal string. */
export interface OraclePrice {
	symbol: string
	price: string
	t: number
}

/** POST /wallet/faucet — the caller's balance after the mint. */
export interface FaucetResult {
	availableUsdc: string
}

/** GET /health */
export interface HealthStatus {
	status: string
}

export type SubmissionInput = Pick<
	SubmissionDraft,
	'name' | 'ticker' | 'types' | 'riskLevel' | 'description' | 'sourceCode'
>

export type SubmissionPatch = Partial<SubmissionInput>

/* ── Auth ────────────────────────────────────────────────── */

export function login(username: string): Promise<Session> {
	return request<Session>('/auth/login', { method: 'POST', body: { username } })
}

export function getMe(): Promise<User> {
	return request<User>('/auth/me')
}

/* ── Strategies ──────────────────────────────────────────── */

export function listStrategies(query: ListStrategiesQuery = {}): Promise<ListStrategiesResponse> {
	return request<ListStrategiesResponse>('/strategies', {
		query: {
			q: query.q,
			types: query.types,
			risk: query.risk,
			sort: query.sort,
			status: query.status,
			limit: query.limit,
			offset: query.offset,
		},
	})
}

export function getStrategy(slug: string): Promise<StrategyDetail> {
	return request<StrategyDetail>(`/strategies/${encodeURIComponent(slug)}`)
}

export function getStrategySeries(slug: string, range: TimeRange = '30d'): Promise<TimeseriesPoint[]> {
	return request<TimeseriesPoint[]>(`/strategies/${encodeURIComponent(slug)}/series`, { query: { range } })
}

export function getStrategyPositionSeries(slug: string, range: TimeRange = '30d'): Promise<PositionSeries> {
	return request<PositionSeries>(`/strategies/${encodeURIComponent(slug)}/position-series`, { query: { range } })
}

export function getStrategyTrades(slug: string): Promise<Trade[]> {
	return request<Trade[]>(`/strategies/${encodeURIComponent(slug)}/trades`)
}

export function getStrategyExecutions(slug: string): Promise<Execution[]> {
	return request<Execution[]>(`/strategies/${encodeURIComponent(slug)}/executions`)
}

export function getStrategySource(slug: string): Promise<string> {
	return requestText(`/strategies/${encodeURIComponent(slug)}/source`)
}

export function investInStrategy(slug: string, amount: string): Promise<Position> {
	return request<Position>(`/strategies/${encodeURIComponent(slug)}/invest`, { method: 'POST', body: { amount } })
}

export function withdrawFromStrategy(slug: string, shares: string): Promise<Position> {
	return request<Position>(`/strategies/${encodeURIComponent(slug)}/withdraw`, { method: 'POST', body: { shares } })
}

/* ── Portfolio and wallet ────────────────────────────────── */

export function getPortfolio(): Promise<Portfolio> {
	return request<Portfolio>('/portfolio')
}

export function requestFaucet(): Promise<FaucetResult> {
	return request<FaucetResult>('/wallet/faucet', { method: 'POST' })
}

/* ── Creator submissions ─────────────────────────────────── */

export function createSubmission(input: SubmissionInput): Promise<SubmissionDraft> {
	return request<SubmissionDraft>('/submissions', { method: 'POST', body: input })
}

export function updateSubmission(id: string, patch: SubmissionPatch): Promise<SubmissionDraft> {
	return request<SubmissionDraft>(`/submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

/** Ciphertext only — the plaintext parameters never leave the creator's browser. */
export function putSubmissionSecrets(id: string, secrets: EncryptedSecret[]): Promise<SubmissionDraft> {
	return request<SubmissionDraft>(`/submissions/${encodeURIComponent(id)}/secrets`, {
		method: 'POST',
		body: secrets,
	})
}

export function getSubmission(id: string): Promise<SubmissionDraft> {
	return request<SubmissionDraft>(`/submissions/${encodeURIComponent(id)}`)
}

export function publishSubmission(id: string): Promise<StrategyDetail> {
	return request<StrategyDetail>(`/submissions/${encodeURIComponent(id)}/publish`, { method: 'POST' })
}

function parseDraftLine(line: string): SubmissionDraft {
	try {
		return JSON.parse(line) as SubmissionDraft
	} catch (error) {
		console.error('attesta: the sanity pipeline emitted a line that is not JSON', error, line)
		throw new ApiError(0, 'malformed_stream', 'The sanity pipeline emitted an unreadable line', line)
	}
}

/**
 * Runs the sanity pipeline and yields the draft again after every check, so a caller
 * can render check state as it lands. The backend streams newline-delimited drafts.
 */
export async function* streamSubmissionChecks(
	id: string,
	signal?: AbortSignal,
): AsyncGenerator<SubmissionDraft> {
	const response = await send(`/submissions/${encodeURIComponent(id)}/check`, { method: 'POST', signal })
	if (!response.body) {
		throw new ApiError(response.status, 'empty_stream', 'The sanity pipeline returned no stream')
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
	let buffer = ''
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += value
			let boundary = buffer.indexOf('\n')
			while (boundary !== -1) {
				const line = buffer.slice(0, boundary).trim()
				buffer = buffer.slice(boundary + 1)
				if (line) yield parseDraftLine(line)
				boundary = buffer.indexOf('\n')
			}
		}
		const tail = buffer.trim()
		if (tail) yield parseDraftLine(tail)
	} finally {
		reader.releaseLock()
	}
}

/* ── Oracle and liveness ─────────────────────────────────── */

export function getOraclePrices(): Promise<OraclePrice[]> {
	return request<OraclePrice[]>('/oracle/prices')
}

export function getHealth(): Promise<HealthStatus> {
	return request<HealthStatus>('/health')
}
