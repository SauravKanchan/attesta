// The one place a strategy's platform id becomes the bytes32 the registry is keyed by.
//
// A strategy's database id is a uuid and StrategyRegistry keys on bytes32, so the id is
// hashed rather than truncated: keccak of the id is stable, collision-free in practice,
// and recomputable by anyone holding the public id.
//
// It lives here, above both the chain layer and the strategy subsystem, because the two
// have to agree on it exactly. Two hashing helpers — one in the port's caller, one in the
// registry client — are two chances to hash the same id twice or hash it differently, and
// either mistake anchors a strategy under a key nothing can find again.

import { keccak256, toBytes, type Hex } from 'viem'

/**
 * The registry key for a platform strategy id. Callers hash once, at the edge of the
 * chain layer, and pass the result as bytes32 from there on.
 */
export const toStrategyId = (strategyId: string): Hex => keccak256(toBytes(strategyId))

/** True for a 32-byte hex string — what the registry accepts as a key. */
export const isStrategyIdHex = (value: string): value is Hex =>
	/^0x[0-9a-fA-F]{64}$/.test(value)
