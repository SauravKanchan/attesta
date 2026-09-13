// The composition root.
//
// Everything below this file is written against an interface: `publishSubmission` takes a
// ChainPort, `runTick` takes a ChainPort and an OraclePort, `createScheduler` takes both.
// Nothing constructs them for itself, which is what keeps the strategy subsystem and the
// tick loop testable against a fake — and it also means that until something here hands
// them the concrete adapters, the chain layer is code nobody reaches and the value loop
// cannot run at all.
//
// This is that something. It is the only module in the backend that both knows the real
// adapters exist and is imported by the entry point, so it is also the only place a
// process-wide singleton belongs: one scheduler, one chain port, started once at boot and
// stopped once on shutdown. Routes import the accessors rather than building their own.

import * as chain from './chain/index.js'
import { env } from './lib/env.js'
import {
	createScheduler,
	defaultDeps,
	schedulerConfig,
	type OraclePort,
	type Scheduler,
} from './scheduler/index.js'
import { consoleLogger, type ChainPort, type Logger } from './strategy/ports.js'

export interface Services {
	chain: ChainPort
	oracle: OraclePort
	scheduler: Scheduler
	/** The account holding the platform USDC float and paying for gas top-ups. */
	platformAddress: string
}

let services: Services | null = null

/**
 * Builds the singletons on first call and returns the same ones afterwards. Lazy rather
 * than built at import time so a script that only wants the chain port does not start a
 * tick loop by importing this file.
 */
export function getServices(logger: Logger = consoleLogger): Services {
	if (services) return services

	const deps = defaultDeps(logger)
	services = {
		chain: deps.chain,
		oracle: deps.oracle,
		scheduler: createScheduler(deps),
		platformAddress: chain.platformAddress(),
	}
	return services
}

export const getChainPort = (logger?: Logger): ChainPort => getServices(logger).chain
export const getOraclePort = (logger?: Logger): OraclePort => getServices(logger).oracle
export const getScheduler = (logger?: Logger): Scheduler => getServices(logger).scheduler

/**
 * Boot-time chain checks. The address book on disk is authoritative for the singletons —
 * a `deploy-local.sh` after an anvil restart writes new addresses, and a `deployments`
 * table still holding the old ones would send every transaction to an address with no
 * bytecode. Re-reading it here is what makes a chain reset survivable without a manual
 * step, and a chain that is simply down is reported rather than discovered one revert at
 * a time.
 */
export async function connectChain(logger: Logger = consoleLogger): Promise<boolean> {
	if (!(await chain.isChainUp())) {
		logger.error(
			{ rpcUrl: env.RPC_URL },
			'chain is unreachable: publishing and the tick loop will fail until it is up',
		)
		return false
	}

	const book = chain.syncAddressBook()
	if (!book) {
		logger.error(
			{ addressBook: chain.ADDRESS_BOOK_PATH },
			'no address book: run contracts/deploy-local.sh before publishing a strategy',
		)
		return false
	}

	const deployed = await chain.isContractDeployed(book.usdc)
	if (!deployed) {
		logger.error(
			{ usdc: book.usdc },
			'the address book points at a chain that has been reset: redeploy with contracts/deploy-local.sh',
		)
		return false
	}

	logger.info(
		{ chainId: book.chainId, usdc: book.usdc, registry: book.registry, platform: chain.platformAddress() },
		'chain connected',
	)
	return true
}

/**
 * Starts the tick loop, unless SCHEDULER_ENABLED says otherwise. A chain that is down is
 * not a reason to refuse to boot — the API still serves everything that does not touch it
 * — so the loop starts anyway and each tick records its own failure.
 */
export async function startServices(logger: Logger = consoleLogger): Promise<Services> {
	const built = getServices(logger)
	await connectChain(logger)

	if (!schedulerConfig.enabled) {
		logger.warn({}, 'scheduler is disabled by SCHEDULER_ENABLED: no strategy will tick')
		return built
	}

	built.scheduler.start()
	return built
}

/** Stops the tick loop and waits for any in-flight tick, so shutdown never tears one in half. */
export async function stopServices(logger: Logger = consoleLogger): Promise<void> {
	if (!services) return
	try {
		await services.scheduler.stop()
	} catch (error) {
		logger.error({ err: error }, 'the scheduler did not stop cleanly')
	}
}
