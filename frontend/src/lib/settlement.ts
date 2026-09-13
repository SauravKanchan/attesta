/**
 * Recording a transfer the browser has already settled on chain.
 *
 * A deposit is two facts, not one: the vault minted shares (irreversible, on chain) and
 * attesta wrote the position down (a POST that can fail). Between them sits the whole
 * failure surface of the network — and a failure there must never be reported as "the
 * deposit did not go through", because the USDC has left the wallet either way.
 *
 * So the hash is written to storage the instant the chain confirms it, the POST is
 * retried, and a hash that still will not record is left in the queue for `flushUnrecorded`
 * to replay on the next page load or the next money action. The backend reads the receipt
 * rather than trusting the caller, so replaying a hash is safe: it either records the
 * transfer or reports that it is already recorded, and both mean the queue can drop it.
 */

import { ApiError, recordInvestment, recordWithdrawal } from '@/lib/api'
import type { Position } from '@/lib/types'

export type TransferKind = 'deposit' | 'withdraw'

export interface UnrecordedTransfer {
	kind: TransferKind
	slug: string
	txHash: string
	/** When the receipt came back, so a stale queue entry can be named in the log. */
	settledAt: string
}

/**
 * A transfer that settled on chain and could not be recorded. Distinct from `ApiError` so
 * a caller can tell "your money did not move" from "your money moved and we lost the
 * paperwork", which are opposite things to tell an investor.
 */
export class UnrecordedTransferError extends Error {
	readonly transfer: UnrecordedTransfer

	constructor(transfer: UnrecordedTransfer, cause: unknown) {
		super(
			`the ${transfer.kind} settled on chain as ${transfer.txHash} but attesta could not record it`,
		)
		this.name = 'UnrecordedTransferError'
		this.transfer = transfer
		this.cause = cause
	}
}

const STORAGE_KEY = 'attesta.transfers.unrecorded'

/** Four attempts over about five seconds — long enough to ride out a backend restart. */
const RETRY_DELAYS_MS = [400, 1_200, 3_000] as const

function record(kind: TransferKind, slug: string, txHash: string): Promise<Position> {
	return kind === 'deposit' ? recordInvestment(slug, txHash) : recordWithdrawal(slug, txHash)
}

/**
 * Whether another attempt could plausibly succeed right now. A dead backend, a dropped
 * connection and a 5xx are all worth retrying immediately.
 */
function retryable(error: unknown): boolean {
	if (!(error instanceof ApiError)) return false
	return error.status === 0 || error.status >= 500
}

/**
 * Whether the backend has answered about this transfer for good: 400 says the chain has no
 * such transaction or it carries no matching event, 403 says it was somebody else's, 404
 * says there is no such strategy. None of those change on a replay, so the hash is dropped.
 *
 * A 401 is deliberately absent: an expired session is the one refusal that a later attempt
 * fixes, so those entries stay queued until the investor signs back in.
 */
function finalRefusal(error: unknown): boolean {
	if (!(error instanceof ApiError)) return false
	return error.status === 400 || error.status === 403 || error.status === 404
}

/**
 * A hash the backend has already recorded is done, not failed — the first attempt reached
 * it and only the response was lost.
 */
function alreadyRecorded(error: unknown): boolean {
	return error instanceof ApiError && error.status === 409
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

function readQueue(): UnrecordedTransfer[] {
	if (typeof window === 'undefined') return []
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (raw === null) return []
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((entry): entry is UnrecordedTransfer => {
			if (typeof entry !== 'object' || entry === null) return false
			const candidate = entry as Partial<UnrecordedTransfer>
			return (
				(candidate.kind === 'deposit' || candidate.kind === 'withdraw') &&
				typeof candidate.slug === 'string' &&
				typeof candidate.txHash === 'string'
			)
		})
	} catch (error) {
		console.error('attesta: the unrecorded-transfer queue could not be read', error)
		return []
	}
}

function writeQueue(queue: readonly UnrecordedTransfer[]): void {
	if (typeof window === 'undefined') return
	try {
		if (queue.length === 0) window.localStorage.removeItem(STORAGE_KEY)
		else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
	} catch (error) {
		console.error('attesta: the unrecorded-transfer queue could not be written', error)
	}
}

function enqueue(transfer: UnrecordedTransfer): void {
	const queue = readQueue()
	if (queue.some((entry) => entry.txHash === transfer.txHash)) return
	writeQueue([...queue, transfer])
}

function dequeue(txHash: string): void {
	const queue = readQueue()
	const remaining = queue.filter((entry) => entry.txHash !== txHash)
	if (remaining.length !== queue.length) writeQueue(remaining)
}

/**
 * Records one settled transfer, retrying while the failure still looks transient.
 *
 * Resolves with the updated position, or with null when the backend reports the hash as
 * already recorded — the transfer is on file either way, but that response carries no
 * position with it. Throws `UnrecordedTransferError` when every attempt failed: the money
 * has still moved, and the hash is queued for a later replay.
 */
export async function recordSettledTransfer(
	kind: TransferKind,
	slug: string,
	txHash: string,
): Promise<Position | null> {
	const transfer: UnrecordedTransfer = { kind, slug, txHash, settledAt: new Date().toISOString() }
	enqueue(transfer)

	let lastError: unknown = null
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			const position = await record(kind, slug, txHash)
			dequeue(txHash)
			return position
		} catch (error) {
			lastError = error
			// Only after a first attempt that failed in flight: a 409 on the very first try is
			// a hash this browser is presenting twice, which is the caller's bug, not a lost
			// response, and it must not be reported as a success.
			if (attempt > 0 && alreadyRecorded(error)) {
				console.warn(`attesta: ${kind} ${txHash} was already recorded by an earlier attempt`, error)
				dequeue(txHash)
				return null
			}
			if (!retryable(error)) {
				console.error(`attesta: recording the ${kind} ${txHash} failed and will not be retried`, error)
				if (finalRefusal(error)) dequeue(txHash)
				throw error
			}
			const delay = RETRY_DELAYS_MS[attempt]
			if (delay === undefined) break
			console.warn(`attesta: recording the ${kind} ${txHash} failed; retrying in ${delay}ms`, error)
			await wait(delay)
		}
	}

	console.error(
		`attesta: the ${kind} ${txHash} settled on chain but could not be recorded; queued for replay`,
		lastError,
	)
	throw new UnrecordedTransferError(transfer, lastError)
}

/**
 * Replays every queued transfer. Called on the portfolio page and before each new money
 * action, so a position that went missing because one POST failed comes back on its own
 * rather than staying invisible until someone reads the console.
 *
 * Returns how many entries left the queue, so a caller can refresh what it is showing.
 */
export async function flushUnrecorded(): Promise<number> {
	const queue = readQueue()
	if (queue.length === 0) return 0

	let settled = 0
	for (const entry of queue) {
		try {
			await record(entry.kind, entry.slug, entry.txHash)
			dequeue(entry.txHash)
			settled += 1
			console.warn(`attesta: replayed the ${entry.kind} ${entry.txHash} and recorded it`)
		} catch (error) {
			if (alreadyRecorded(error)) {
				dequeue(entry.txHash)
				settled += 1
				continue
			}
			if (finalRefusal(error)) {
				console.error(
					`attesta: the queued ${entry.kind} ${entry.txHash} was refused and has been dropped`,
					error,
				)
				dequeue(entry.txHash)
				continue
			}
			console.error(`attesta: the queued ${entry.kind} ${entry.txHash} could not be replayed`, error)
		}
	}
	return settled
}

/** How many settled transfers are still waiting to be recorded. */
export function unrecordedCount(): number {
	return readQueue().length
}
