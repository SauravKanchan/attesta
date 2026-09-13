// Turning viem's error tower into something a log line can carry.
//
// A revert arrives as a nest of wrapped errors whose useful part — the custom error the
// contract actually raised, e.g. `ReserveExhausted(120000000, 0)` — sits several `cause`
// hops down. Losing it turns every failed tick into "execution reverted", which says
// nothing about whether the reserve ran dry or the operator was wrong.

import { BaseError, ContractFunctionRevertedError } from 'viem'

export class ChainError extends Error {
	readonly operation: string
	/** The decoded custom error or revert string, when the node returned one. */
	readonly revert: string | null

	constructor(operation: string, revert: string | null, cause: unknown) {
		super(revert ? `${operation} reverted: ${revert}` : `${operation} failed`)
		this.name = 'ChainError'
		this.operation = operation
		this.revert = revert
		this.cause = cause
	}
}

/** The contract's own error, formatted with its arguments, or the node's short message. */
export function revertReason(error: unknown): string | null {
	if (!(error instanceof BaseError)) return null

	const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError)
	if (reverted instanceof ContractFunctionRevertedError) {
		const name = reverted.data?.errorName
		if (name) {
			const args = reverted.data?.args ?? []
			return args.length > 0 ? `${name}(${args.map((arg) => String(arg)).join(', ')})` : name
		}
		return reverted.reason ?? reverted.shortMessage
	}

	return error.shortMessage || error.message || null
}

/**
 * Runs a chain call, logging and rethrowing as a `ChainError` with the revert attached.
 * Every write in this directory goes through it so no failure is swallowed.
 */
export async function onChain<T>(
	operation: string,
	run: () => Promise<T>,
	context: Record<string, unknown> = {},
): Promise<T> {
	try {
		return await run()
	} catch (error) {
		const revert = revertReason(error)
		console.error(`chain call failed: ${operation}`, { ...context, revert, error })
		throw new ChainError(operation, revert, error)
	}
}
