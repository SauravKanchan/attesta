// The strategy id has one representation, and the registry answers to it.
//
// A uuid is hashed to bytes32 before it reaches StrategyRegistry. When two modules each
// own a copy of that step, one of them eventually hashes an id the other had already
// hashed, and the strategy is anchored under keccak(keccak(id)) — a key nothing looks up,
// with no error anywhere to say so. These tests pin the representation in one place and
// then prove it against a real registry: register under the key `publish` computes, read
// the record back, and require the very same bytes32 to come out.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { keccak256, stringToHex, toBytes, toHex, type Hex } from 'viem'
import * as chain from '../src/chain/index.js'
import { createChainPort } from '../src/chain/port.js'
import { closeDatabase, migrateToLatest } from '../src/db/index.js'
import { isStrategyIdHex, toStrategyId } from '../src/lib/strategy-id.js'
import { onChainStrategyId } from '../src/strategy/publish.js'

const SAMPLE_IDS = [
	'0f9d3c2e-9a5b-4b1e-8d1a-2c7f4b6e5a90',
	'strategy-with-a-plain-name',
	'',
	'unicode: ünïcodé 🜲',
] as const

describe('the on-chain strategy id', () => {
	for (const id of SAMPLE_IDS) {
		test(`is one function for ${JSON.stringify(id)}`, () => {
			const canonical = toStrategyId(id)

			// Same value from every door callers reach it through. `publish` re-exports the
			// canonical helper rather than owning a second copy, and so does the registry
			// client, so a drift between them is a compile-time impossibility rather than a
			// silently wrong key.
			assert.equal(onChainStrategyId(id), canonical)
			assert.equal(chain.toStrategyId(id), canonical)
			assert.equal(chain.registry.toStrategyId(id), canonical)

			// keccak over the utf8 bytes of the id: what an outside observer holding the
			// public id would compute, by either of viem's two spellings.
			assert.equal(canonical, keccak256(toBytes(id)))
			assert.equal(canonical, keccak256(toHex(id)))
			assert.equal(canonical, keccak256(stringToHex(id)))

			assert.ok(isStrategyIdHex(canonical))
			assert.equal(canonical.length, 66)
		})
	}

	test('is not what hashing twice produces', () => {
		const id = SAMPLE_IDS[0]
		assert.notEqual(toStrategyId(toStrategyId(id)), toStrategyId(id))
	})
})

// The live half. Anvil is the local stack's chain; when it is not up there is nothing to
// register against, and the test says so rather than passing quietly.
describe('registering against StrategyRegistry', () => {
	let usable = false
	let reason = ''

	before(async () => {
		migrateToLatest()
		if (!(await chain.isChainUp())) {
			reason = 'no chain at RPC_URL: start anvil (scripts/dev.sh)'
			return
		}
		const book = chain.syncAddressBook()
		if (!book) {
			reason = 'no address book: run contracts/deploy-local.sh'
			return
		}
		if (!(await chain.isContractDeployed(book.registry))) {
			reason = 'the address book points at a chain that has been reset'
			return
		}
		usable = true
	})

	after(() => {
		closeDatabase()
	})

	test('reads back the same id it was registered under', async (t) => {
		if (!usable) {
			t.skip(reason)
			return
		}

		const port = createChainPort()
		const platformId = `test-${randomSuffix()}`
		const key = toStrategyId(platformId)
		const operator = chain.wallets.generateWallet()
		const binaryHash = keccak256(toBytes(platformId))

		const deployed = await port.deployVault({ name: 'Id Round Trip', operator: operator.address })

		assert.equal(await port.isStrategyRegistered(key), false)
		const registered = await port.registerStrategy({
			onChainStrategyId: key,
			vaultAddress: deployed.vaultAddress,
			binaryHash,
			creator: chain.deployerAccount.address,
		})
		assert.match(registered.txHash, /^0x[0-9a-f]{64}$/)

		assert.equal(await port.isStrategyRegistered(key), true)

		const record = await chain.registry.getRecord(key)
		assert.ok(record, 'the registry returned no record for the key it was registered under')
		assert.equal(record.strategyId, key)
		assert.equal(record.vault.toLowerCase(), deployed.vaultAddress.toLowerCase())
		assert.equal(record.binaryHash.toLowerCase(), binaryHash.toLowerCase())

		// The failure this whole exercise exists to prevent: had either side hashed a second
		// time, the anchor would sit here instead and the key above would find nothing.
		const doubleHashed = toStrategyId(key) as Hex
		assert.equal(await port.isStrategyRegistered(doubleHashed), false)
		assert.equal(await chain.registry.getRecord(doubleHashed), null)
	})
})

/** Registrations are permanent, so every run needs an id no earlier run used. */
const randomSuffix = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
