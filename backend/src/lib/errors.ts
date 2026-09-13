import type { ApiError } from '../../../shared/types.js'

/** An error the client is allowed to see. Anything else becomes a 500 with no detail. */
export class HttpError extends Error {
	readonly statusCode: number
	readonly code: string
	readonly details: unknown

	constructor(statusCode: number, code: string, message: string, details?: unknown) {
		super(message)
		this.name = 'HttpError'
		this.statusCode = statusCode
		this.code = code
		this.details = details
	}

	toApiError(): ApiError {
		const body: ApiError = { error: this.code, message: this.message }
		if (this.details !== undefined) body.details = this.details
		return body
	}
}

export const badRequest = (message: string, details?: unknown) =>
	new HttpError(400, 'bad_request', message, details)

export const unauthorized = (message = 'authentication required') =>
	new HttpError(401, 'unauthorized', message)

export const forbidden = (message = 'not permitted') => new HttpError(403, 'forbidden', message)

export const notFound = (message = 'not found') => new HttpError(404, 'not_found', message)

export const conflict = (message: string, details?: unknown) =>
	new HttpError(409, 'conflict', message, details)

const STATUS_CODES: Record<number, string> = {
	400: 'bad_request',
	401: 'unauthorized',
	403: 'forbidden',
	404: 'not_found',
	405: 'method_not_allowed',
	409: 'conflict',
	413: 'payload_too_large',
	415: 'unsupported_media_type',
	429: 'rate_limited',
}

/** Keeps the client's error vocabulary stable instead of leaking framework codes. */
export function codeForStatus(statusCode: number): string {
	return STATUS_CODES[statusCode] ?? 'bad_request'
}
