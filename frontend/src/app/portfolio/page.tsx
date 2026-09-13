'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { useAuth } from '@/components/AuthProvider'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { AlertIcon } from '@/components/ui/icons'
import { EM_DASH, formatUsdc } from '@/lib/format'
import { InvestmentsTable } from '@/components/portfolio/InvestmentsTable'
import { MyStrategiesTable } from '@/components/portfolio/MyStrategiesTable'
import { PortfolioSummaryTiles } from '@/components/portfolio/PortfolioSummaryTiles'
import { PortfolioValueChart } from '@/components/portfolio/PortfolioValueChart'
import { WithdrawModal } from '@/components/portfolio/WithdrawModal'
import { unitsOrZero } from '@/components/portfolio/units'
import { RequestError } from '@/components/strategy/RequestError'
import { ApiError, getPortfolio, listStrategies, requestFaucet } from '@/lib/api'
import type { Portfolio, Position, StrategySummary } from '@/lib/types'

type TabValue = 'investments' | 'created'

/**
 * `GET /portfolio` carries the investor side. The creator side and each position's APY
 * both live on the strategy, so the listing is fetched alongside it and joined here by
 * id — there is no per-creator endpoint, and inventing one metric locally to avoid a
 * second request would put an unattested number on the page.
 *
 * The endpoint refuses a page larger than this, so a listing that reports a bigger
 * `total` than it returned is a partial answer and the tables say so.
 */
const STRATEGY_PAGE_SIZE = 100

/**
 * What the last listing request produced. The two tabs are joins against it, so an
 * answer that never arrived and an answer that arrived complete are different facts:
 * "you have published nothing" is only true of the second.
 */
type Listing =
	| { status: 'ok'; strategies: StrategySummary[]; missing: number }
	| { status: 'failed'; error: ApiError }

/** Stable identity, so the joins below are not rebuilt on every render. */
const NO_STRATEGIES: StrategySummary[] = []

export default function PortfolioPage() {
	const { user } = useAuth()
	const { toast } = useToast()

	const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
	const [listing, setListing] = useState<Listing | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [tab, setTab] = useState<TabValue>('investments')
	const [withdrawing, setWithdrawing] = useState<Position | null>(null)
	const [faucetPending, setFaucetPending] = useState(false)

	// The two calls are settled separately: the listing only decorates the tables, so a
	// failure there must not take down the balances and the faucet, which are what an
	// investor with an empty wallet is on this page for.
	const load = useCallback(async () => {
		setError(null)
		const [portfolioResult, listingResult] = await Promise.allSettled([
			getPortfolio(),
			listStrategies({ limit: STRATEGY_PAGE_SIZE }),
		])

		if (portfolioResult.status === 'fulfilled') {
			setPortfolio(portfolioResult.value)
		} else {
			console.error('attesta: loading the portfolio failed', portfolioResult.reason)
			setError(
				portfolioResult.reason instanceof ApiError
					? portfolioResult.reason.message
					: 'The portfolio could not be loaded',
			)
		}

		if (listingResult.status === 'fulfilled') {
			const { strategies, total } = listingResult.value
			setListing({ status: 'ok', strategies, missing: Math.max(total - strategies.length, 0) })
		} else {
			console.error('attesta: loading the strategy listing failed', listingResult.reason)
			setListing({ status: 'failed', error: asApiError(listingResult.reason) })
		}

		setLoading(false)
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const strategies = listing?.status === 'ok' ? listing.strategies : NO_STRATEGIES

	const strategiesById = useMemo(() => {
		const index = new Map<string, StrategySummary>()
		for (const strategy of strategies) index.set(strategy.id, strategy)
		return index
	}, [strategies])

	const created = useMemo(() => {
		if (!user) return []
		return strategies.filter((strategy) => strategy.creator.id === user.id)
	}, [strategies, user])

	// Said once, under whichever table is open. A row that reads — for APY, or a strategy
	// missing from the creator tab, is then explained rather than left to look like a fact
	// about the strategy.
	const listingNote = useMemo(() => {
		if (listing === null || listing.status === 'failed' || listing.missing === 0) return null
		const shown = listing.strategies.length
		return `Showing the ${shown} most recent strategies of ${shown + listing.missing}. Anything older is missing from these tables, and its APY reads ${EM_DASH}.`
	}, [listing])

	// A fully redeemed position stays on the wire as a zero-share row so its history
	// survives; there is nothing left to withdraw from, so it leaves the table.
	const positions = useMemo(
		() => (portfolio?.positions ?? []).filter((position) => unitsOrZero(position.shares) > 0n),
		[portfolio],
	)

	async function runFaucet() {
		setFaucetPending(true)
		try {
			const result = await requestFaucet()
			toast({
				tone: 'success',
				title: 'Wallet funded',
				description: `${formatUsdc(result.minted)} USDC minted. Your balance is now ${formatUsdc(result.usdcBalance)} USDC, with ${result.gasBalance} ETH for gas.`,
			})
			await load()
		} catch (caught) {
			console.error('attesta: the faucet request failed', caught)
			toast({
				tone: 'error',
				title: 'Faucet failed',
				description: caught instanceof ApiError ? caught.message : 'The faucet could not be reached',
			})
		} finally {
			setFaucetPending(false)
		}
	}

	function handleWithdrawn() {
		setWithdrawing(null)
		void load()
	}

	return (
		<>
			<PageHeader
				title="Portfolio"
				description="Your allocations, their value over time, and the strategies you publish."
			/>

			{error === null ? null : (
				<Card tier={2} className="mb-4 flex items-start gap-2 border-risk/40">
					<AlertIcon className="mt-0.5 size-4 shrink-0 text-risk-light" />
					<div>
						<p className="type-headline-sm text-fg">The portfolio could not be loaded</p>
						<p className="mt-0.5 type-body-sm text-fg-secondary">{error}</p>
					</div>
				</Card>
			)}

			<div className="flex flex-col gap-4">
				<PortfolioSummaryTiles
					summary={portfolio?.summary ?? null}
					loading={loading}
					onFaucet={() => void runFaucet()}
					faucetPending={faucetPending}
				/>

				<PortfolioValueChart points={portfolio?.valueSeries ?? []} loading={loading} />

				<div className="flex flex-col gap-3">
					<Tabs
						ariaLabel="Portfolio sections"
						value={tab}
						onChange={setTab}
						items={[
							{
								value: 'investments',
								label: 'Investments',
								badge: <Tag mono>{positions.length}</Tag>,
							},
							{
								value: 'created',
								label: 'My strategies',
								// A listing that never arrived leaves the count unknown, and a zero
								// there would read as "you have published nothing".
								badge: <Tag mono>{listing?.status === 'failed' ? EM_DASH : created.length}</Tag>,
							},
						]}
					/>

					{tab === 'investments' ? (
						<InvestmentsTable
							positions={positions}
							strategies={strategiesById}
							loading={loading}
							onWithdraw={setWithdrawing}
						/>
					) : listing?.status === 'failed' ? (
						<RequestError
							error={listing.error}
							what="the strategies you publish"
							onRetry={() => void load()}
						/>
					) : (
						<MyStrategiesTable strategies={created} loading={loading} />
					)}

					{listing?.status === 'failed' && tab === 'investments' ? (
						<p className="type-body-sm text-fg-muted">
							APY reads {EM_DASH} because the strategy listing is unavailable:{' '}
							{listing.error.message}
						</p>
					) : null}

					{listingNote === null ? null : <p className="type-body-sm text-fg-muted">{listingNote}</p>}
				</div>
			</div>

			<WithdrawModal
				position={withdrawing}
				onClose={() => setWithdrawing(null)}
				onWithdrawn={handleWithdrawn}
			/>
		</>
	)
}

/**
 * `lib/api` rejects with an `ApiError` for transport failures as well as HTTP ones, so
 * this is a narrowing rather than a conversion. Anything else still reaches the reader
 * with its message instead of collapsing into a blank panel.
 */
function asApiError(reason: unknown): ApiError {
	if (reason instanceof ApiError) return reason
	const message = reason instanceof Error ? reason.message : 'The strategy listing could not be loaded'
	return new ApiError(0, 'unknown_error', message, reason)
}
