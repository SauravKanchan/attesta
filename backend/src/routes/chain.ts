// What the browser needs before it can sign anything: where the contracts live, and a way
// to fund the wallet that will be signing.
//
// Both exist because the key stays client-side. The browser builds and signs its own
// approve, deposit and withdraw, so it must be told the chain id, the RPC URL and the
// contract addresses — and none of those may be compiled into the client, or a redeploy
// silently points the UI at contracts that no longer exist.

import type { FastifyInstance } from 'fastify'
import { formatEther, getAddress, type Address } from 'viem'
import { z } from 'zod'
import type { ChainConfig, FaucetResult } from '../../../shared/types.js'
import { registryAddress, syncAddressBook, usdc, usdcAddress, wallets } from '../chain/index.js'
import { env } from '../lib/env.js'
import { HttpError } from '../lib/errors.js'
import { formatAmount, parseAmount } from '../lib/money.js'
import { requireAuth, requireUser } from '../lib/session.js'

/** Enough to exercise every flow in the UI without asking twice. */
const DEFAULT_FAUCET_USDC = 10_000n * usdc.ONE_USDC

/** A local faucet still refuses absurd mints, so one bad request cannot distort every AUM. */
const MAX_FAUCET_USDC = 1_000_000n * usdc.ONE_USDC

const faucetBody = z
	.object({ amount: z.string().trim().min(1).optional() })
	.optional()
	.transform((value) => value ?? {})

function chainUnavailable(): HttpError {
	return new HttpError(
		503,
		'chain_unavailable',
		'the contracts are not deployed — run contracts/deploy-local.sh against anvil',
	)
}

export async function chainRoutes(app: FastifyInstance): Promise<void> {
	// Public: the login screen needs it before there is a session to authenticate with.
	app.get('/chain/config', async (request): Promise<ChainConfig> => {
		// contracts/deployments/local.json is what the deploy step writes, so it is the
		// authority. Re-reading it per request keeps the browser and the backend pointed at
		// the same contracts after a redeploy instead of one of them holding a dead address.
		const book = syncAddressBook()
		if (book && book.chainId !== env.CHAIN_ID) {
			request.log.warn(
				{ addressBookChainId: book.chainId, envChainId: env.CHAIN_ID },
				'the address book and CHAIN_ID disagree; serving the address book',
			)
		}

		try {
			return {
				chainId: book?.chainId ?? env.CHAIN_ID,
				rpcUrl: env.RPC_URL,
				usdcAddress: book?.usdc ?? usdcAddress(),
				registryAddress: book?.registry ?? registryAddress(),
				usdcDecimals: usdc.USDC_DECIMALS,
			}
		} catch (error) {
			request.log.error({ err: error }, 'no deployed contracts to report')
			throw chainUnavailable()
		}
	})

	// Mints USDC and tops up gas together. Minting alone leaves a pasted key holding
	// balances it cannot spend, because approve and deposit both cost ETH — and "your
	// transaction failed" is an unreadable way to say "you have no gas".
	app.post('/wallet/faucet', { preHandler: requireAuth }, async (request): Promise<FaucetResult> => {
		const user = requireUser(request)
		const { amount } = faucetBody.parse(request.body ?? {})
		const address = getAddress(user.walletAddress as Address)

		const minted = amount ? BigInt(parseAmount(amount)) : DEFAULT_FAUCET_USDC
		if (minted <= 0n || minted > MAX_FAUCET_USDC) {
			throw new HttpError(
				400,
				'bad_request',
				`amount must be between 0 and ${formatAmount(MAX_FAUCET_USDC.toString())} USDC`,
			)
		}

		try {
			const gasTxHash = await wallets.ensureGas(address)
			const mintTxHash = await usdc.mint(address, minted)
			const [usdcBalance, gasBalance] = await Promise.all([
				usdc.balanceOf(address),
				wallets.gasBalance(address),
			])

			request.log.info(
				{ userId: user.id, address, minted: minted.toString(), mintTxHash, gasTxHash },
				'faucet funded a wallet',
			)

			return {
				walletAddress: address,
				minted: formatAmount(minted.toString()),
				mintTxHash,
				gasTxHash,
				usdcBalance: formatAmount(usdcBalance.toString()),
				gasBalance: formatEther(gasBalance),
			}
		} catch (error) {
			request.log.error({ err: error, address }, 'faucet failed')
			throw new HttpError(502, 'chain_error', 'the faucet transaction did not go through')
		}
	})
}
