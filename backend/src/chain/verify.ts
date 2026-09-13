// End-to-end proof that the chain layer works against a real chain.
//
// Starts anvil if nothing is listening, deploys the singletons if the address book is
// stale, then runs the full vault round trip — deploy, fund, deposit, gain, loss, trade,
// register, withdraw — printing the balances and NAV after every step. Nothing here is
// mocked: every number printed was read back from the node.
//
// Run with `npm run verify:chain`.

import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { formatEther, formatUnits, type Address } from 'viem'
import { closeDatabase, migrateToLatest } from '../db/index.js'
import { env } from '../lib/env.js'
import { BACKEND_ROOT } from '../lib/paths.js'
import { isChainUp, isContractDeployed, deployerAccount, publicClient } from './client.js'
import { readAddressBook, registryAddress, syncAddressBook, usdcAddress } from './deployments.js'
import { ChainError } from './errors.js'
import * as registry from './registry.js'
import * as usdc from './usdc.js'
import * as vault from './vault.js'
import * as wallets from './wallets.js'

const CONTRACTS_DIR = path.resolve(BACKEND_ROOT, '..', 'contracts')
const ONE_USDC = 1_000_000n

const usd = (value: bigint): string => `${formatUnits(value, 6).padStart(14)} USDC`
const nav = (value: bigint): string => formatUnits(value, 6)

let startedAnvil: ReturnType<typeof spawn> | null = null

async function ensureAnvil(): Promise<void> {
	if (await isChainUp()) {
		console.log(`chain already up at ${env.RPC_URL}`)
		return
	}

	console.log(`starting anvil on ${env.RPC_URL}`)
	startedAnvil = spawn(
		'anvil',
		['--host', '127.0.0.1', '--port', '8545', '--chain-id', String(env.CHAIN_ID)],
		{ stdio: 'ignore' },
	)
	startedAnvil.on('error', (error) => {
		console.error('anvil failed to start', error)
	})

	for (let attempt = 0; attempt < 60; attempt += 1) {
		await sleep(500)
		if (await isChainUp()) {
			console.log('anvil is up')
			return
		}
	}
	throw new Error('anvil did not become reachable')
}

function stopAnvil(): void {
	if (!startedAnvil) return
	try {
		startedAnvil.kill('SIGTERM')
		console.log('stopped the anvil this script started')
	} catch (error) {
		console.error('could not stop anvil', error)
	}
}

async function ensureContracts(): Promise<void> {
	const book = readAddressBook()
	const deployed = book ? await isContractDeployed(book.usdc) : false
	if (book && deployed) {
		console.log('contracts already deployed')
		syncAddressBook()
		return
	}

	console.log(book ? 'address book is stale — redeploying' : 'no address book — deploying')
	try {
		execFileSync('./deploy-local.sh', [], { cwd: CONTRACTS_DIR, stdio: 'inherit' })
	} catch (error) {
		console.error('contract deployment failed', { contractsDir: CONTRACTS_DIR, error })
		throw error
	}
	syncAddressBook()
}

async function report(
	label: string,
	vaultAddress: Address,
	investor: Address,
): Promise<void> {
	const [totals, shares, claim, walletUsdc, vaultUsdc] = await Promise.all([
		vault.vaultTotals(vaultAddress),
		vault.sharesOf(vaultAddress, investor),
		vault.balanceOfInvestor(vaultAddress, investor),
		usdc.balanceOf(investor),
		usdc.balanceOf(vaultAddress),
	])

	console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 46 - label.length))}`)
	console.log(`  navPerShare          ${nav(totals.navPerShare)}`)
	console.log(`  totalManagedAssets  ${usd(totals.totalManagedAssets)}`)
	console.log(`  totalShares         ${usd(totals.totalShares)}`)
	console.log(`  vault reserve       ${usd(totals.reserve)}`)
	console.log(`  vault token balance ${usd(vaultUsdc)}`)
	console.log(`  investor shares     ${usd(shares)}`)
	console.log(`  investor claim      ${usd(claim)}`)
	console.log(`  investor wallet     ${usd(walletUsdc)}`)
}

async function main(): Promise<void> {
	migrateToLatest()
	await ensureAnvil()
	await ensureContracts()

	console.log(`\nchainId  ${await publicClient.getChainId()}`)
	console.log(`deployer ${deployerAccount.address}`)
	console.log(`usdc     ${usdcAddress()}`)
	console.log(`registry ${registryAddress()}`)

	// Both wallets are freshly generated, so this also proves gas funding works: without
	// it neither could send a single transaction.
	const investor = wallets.generateWallet()
	const operator = wallets.generateWallet()
	const investorAccount = wallets.accountFromKey(investor.privateKey)
	const operatorAccount = wallets.accountFromKey(operator.privateKey)

	await wallets.fundGas(investor.address)
	await wallets.fundGas(operator.address)
	console.log(`\ninvestor ${investor.address}  gas ${formatEther(await wallets.gasBalance(investor.address))} ETH`)
	console.log(`operator ${operator.address}  gas ${formatEther(await wallets.gasBalance(operator.address))} ETH`)

	const strategyId = `verify-${Date.now()}`
	const deployed = await vault.deployVault('Verify Strategy', operator.address)
	console.log(`\nvault    ${deployed.address}  (tx ${deployed.txHash})`)
	console.log(`operator on chain ${await vault.operatorOf(deployed.address)}`)

	// The reserve is what a gain is paid out of; without it applyPnl(+x) reverts.
	const reserveAmount = 5_000n * ONE_USDC
	await usdc.mint(deployerAccount.address, reserveAmount)
	await usdc.approve(deployed.address, reserveAmount, deployerAccount)
	const reserveTx = await vault.fundReserve(deployed.address, reserveAmount)
	console.log(`reserve prefunded ${formatUnits(reserveAmount, 6)} USDC (tx ${reserveTx})`)

	const faucetAmount = 10_000n * ONE_USDC
	const mintTx = await usdc.mint(investor.address, faucetAmount)
	console.log(`faucet minted     ${formatUnits(faucetAmount, 6)} USDC (tx ${mintTx})`)

	await report('after deploy, before deposit', deployed.address, investor.address)

	const depositAmount = 1_000n * ONE_USDC
	await usdc.ensureAllowance(deployed.address, depositAmount, investorAccount)
	const deposited = await vault.deposit(deployed.address, depositAmount, investorAccount)
	console.log(
		`\ndeposit 1000 USDC -> ${formatUnits(deposited.shares, 6)} shares (tx ${deposited.txHash})`,
	)
	await report('after deposit', deployed.address, investor.address)

	const gain = 120n * ONE_USDC
	const applied = await vault.applyPnl(deployed.address, gain, operatorAccount)
	console.log(
		`\napplyPnl +120 USDC -> navPerShare ${nav(applied.navPerShare)} (tx ${applied.txHash})`,
	)
	await report('after +120 USDC pnl', deployed.address, investor.address)

	const tradeTx = await vault.recordTrade(
		deployed.address,
		{ pair: 'ETH/USDC', isBuy: true, size: 500n * ONE_USDC, price: 3_200n * ONE_USDC, pnl: gain },
		operatorAccount,
	)
	console.log(`recordTrade ETH/USDC buy (tx ${tradeTx})`)

	const loss = -45n * ONE_USDC
	const lost = await vault.applyPnl(deployed.address, loss, operatorAccount)
	console.log(`\napplyPnl -45 USDC  -> navPerShare ${nav(lost.navPerShare)} (tx ${lost.txHash})`)
	await report('after -45 USDC pnl', deployed.address, investor.address)

	const registerTx = await registry.register({
		strategyId,
		vault: deployed.address,
		binaryHash: '0x'.padEnd(66, 'a'),
		creator: investor.address,
	})
	const record = await registry.getRecord(strategyId)
	console.log(`\nregistered ${strategyId} (tx ${registerTx})`)
	console.log(`  strategyId  ${record?.strategyId}`)
	console.log(`  vault       ${record?.vault}`)
	console.log(`  binaryHash  ${record?.binaryHash}`)
	console.log(`  creator     ${record?.creator}`)
	console.log(`  registeredAt ${record ? new Date(record.registeredAt * 1000).toISOString() : 'n/a'}`)

	const heldShares = await vault.sharesOf(deployed.address, investor.address)
	const withdrawn = await vault.withdraw(deployed.address, heldShares, investorAccount)
	console.log(
		`\nwithdraw ${formatUnits(heldShares, 6)} shares -> ${formatUnits(withdrawn.assets, 6)} USDC (tx ${withdrawn.txHash})`,
	)
	await report('after full withdrawal', deployed.address, investor.address)

	const finalWallet = await usdc.balanceOf(investor.address)
	const net = finalWallet - faucetAmount
	console.log(
		`\nround trip: deposited 1000, +120 then -45 applied, withdrew everything -> net ${formatUnits(net, 6)} USDC`,
	)

	// A reverting write must not be silently tolerated: only the operator may settle a tick.
	// The assertion is on the decoded revert, not merely on "something threw" — a chain
	// that is down would otherwise satisfy this check just as well as an enforced guard.
	let guardRevert: string | null = null
	try {
		await vault.applyPnl(deployed.address, 1n * ONE_USDC, investorAccount)
	} catch (error) {
		if (!(error instanceof ChainError)) throw error
		guardRevert = error.revert
	}
	if (guardRevert === null) {
		throw new Error('a non-operator was allowed to call applyPnl')
	}
	if (!guardRevert.startsWith('NotOperator')) {
		throw new Error(`non-operator applyPnl reverted with ${guardRevert}, expected NotOperator`)
	}
	console.log(`\nnon-operator applyPnl rejected as expected: ${guardRevert}`)
}

try {
	await main()
	console.log('\nchain round trip OK')
} catch (error) {
	console.error('\nchain round trip FAILED', error)
	process.exitCode = 1
} finally {
	stopAnvil()
	closeDatabase()
}
