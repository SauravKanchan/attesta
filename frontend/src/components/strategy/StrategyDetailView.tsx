'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { getPortfolio, getStrategy } from '@/lib/api'
import { ChevronLeftIcon } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatTile } from '@/components/ui/StatTile'
import { StatusPill } from '@/components/ui/StatusPill'
import { Tag } from '@/components/ui/Tag'
import { VerificationBadge } from '@/components/VerificationBadge'
import {
	EM_DASH,
	formatDate,
	formatPercent,
	formatUsd,
	formatUsdcPrecise,
	signTextClass,
} from '@/lib/format'
import { isPositive } from '@/components/strategy/amount'
import { ActivityPanel } from '@/components/strategy/ActivityPanel'
import { InvestPanel } from '@/components/strategy/InvestPanel'
import { PerformancePanel } from '@/components/strategy/PerformancePanel'
import { PositionSummary } from '@/components/strategy/PositionSummary'
import { RequestError } from '@/components/strategy/RequestError'
import { VerificationPanel } from '@/components/strategy/VerificationPanel'
import { useResource } from '@/components/strategy/useResource'
import { displayHandle, displayTicker, RISK_LABEL, RISK_TONE, STRATEGY_TYPE_LABEL } from '@/components/strategy/strategy-meta'

export function StrategyDetailView({ slug }: { slug: string }) {
	// Bumped after a deposit or withdrawal so every series and table refetches together.
	const [settledAt, setSettledAt] = useState(0)

	const detail = useResource(() => getStrategy(slug), [slug, settledAt])
	const portfolio = useResource(() => getPortfolio(), [settledAt])

	if (detail.loading) return <DetailSkeleton />

	if (detail.error !== null) {
		return (
			<div className="flex flex-col gap-4">
				<BackLink />
				<RequestError
					error={detail.error}
					what={`the strategy "${slug}"`}
					notFound="No strategy is listed under this slug."
					onRetry={detail.reload}
				/>
			</div>
		)
	}

	if (detail.data === null) {
		return (
			<div className="flex flex-col gap-4">
				<BackLink />
				<EmptyState
					title="Strategy not found"
					description="No strategy is listed under this slug."
					action={
						<Link href="/" className="type-body-md text-verified underline underline-offset-2">
							Back to the marketplace
						</Link>
					}
				/>
			</div>
		)
	}

	const strategy = detail.data
	const { metrics, verification } = strategy
	// A fully redeemed position stays on the wire as a row with zero shares, so that its
	// deposit and withdrawal history survives. There is nothing left to manage, and the
	// page reads as an allocation opportunity again rather than a position worth $0.00.
	const position = isPositive(strategy.position?.shares) ? strategy.position : null

	return (
		<div className="flex flex-col gap-4">
			<BackLink />

			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="type-headline-xl text-fg">{strategy.name}</h1>
						<Tag mono recessed className="h-6">
							{displayTicker(strategy.ticker)}
						</Tag>
						<StatusPill status={strategy.status} />
					</div>
					<p className="mt-1 type-body-lg text-fg-secondary">
						by <span className="text-fg">{displayHandle(strategy.creator.username)}</span>
						<span className="mx-2 text-fg-muted">&middot;</span>
						listed {formatDate(strategy.createdAt)}
					</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{strategy.types.map((type) => (
							<Tag key={type}>{STRATEGY_TYPE_LABEL[type]}</Tag>
						))}
						<Tag tone={RISK_TONE[strategy.riskLevel]}>{RISK_LABEL[strategy.riskLevel]} risk</Tag>
						{strategy.assets.map((asset) => (
							<Tag key={asset} mono recessed>
								{asset}
							</Tag>
						))}
					</div>
				</div>
				<VerificationBadge verification={verification} />
			</header>

			{position === null ? null : <PositionSummary position={position} />}

			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<StatTile
					label="Attested return (APY)"
					scale="display"
					value={metrics.apy === null ? EM_DASH : formatPercent(metrics.apy)}
					valueClassName={metrics.apy === null ? 'text-fg-muted' : signTextClass(metrics.apy)}
					hint={metrics.apy === null ? 'Not enough NAV history to annualise yet' : undefined}
				/>
				<StatTile
					label="Total return"
					scale="display"
					value={metrics.totalReturn === null ? EM_DASH : formatPercent(metrics.totalReturn)}
					valueClassName={metrics.totalReturn === null ? 'text-fg-muted' : signTextClass(metrics.totalReturn)}
					hint={`${metrics.navSnapshotCount} NAV snapshots`}
				/>
				<StatTile
					label="Max drawdown"
					scale="display"
					value={metrics.maxDrawdown === null ? EM_DASH : formatPercent(metrics.maxDrawdown)}
					valueClassName={metrics.maxDrawdown === null ? 'text-fg-muted' : 'text-risk-light'}
					hint={metrics.sharpe === null ? undefined : `Sharpe ${metrics.sharpe.toFixed(2)}`}
				/>
				<StatTile
					label="AUM"
					scale="display"
					value={formatUsd(metrics.aum)}
					hint={`${metrics.investorCount} ${metrics.investorCount === 1 ? 'investor' : 'investors'} · NAV ${formatUsdcPrecise(metrics.navPerShare)}`}
				/>
			</section>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="flex flex-col gap-4 lg:col-span-2">
					<PerformancePanel key={`chart-${settledAt}`} slug={slug} position={position} />

					<section className="rounded-sm border border-hairline bg-surface-1 p-4">
						<h2 className="type-headline-sm text-fg">How it works</h2>
						<p className="mt-2 whitespace-pre-line type-body-md text-fg-secondary">
							{strategy.description.trim() === ''
								? 'The creator has not written a description for this strategy.'
								: strategy.description}
						</p>
					</section>

					<ActivityPanel key={`activity-${settledAt}`} slug={slug} />

					<VerificationPanel slug={slug} verification={verification} />
				</div>

				<div className="lg:col-span-1">
					<div className="flex flex-col gap-4 lg:sticky lg:top-6">
						<InvestPanel
							strategy={strategy}
							position={position}
							availableUsdc={portfolio.data?.summary.availableUsdc ?? null}
							onSettled={() => setSettledAt(Date.now())}
						/>
						{portfolio.error === null ? null : (
							<p className="type-body-sm text-warning-light">
								Your USDC balance could not be read, so the shortcuts are off. The amount you type
								is still checked by the backend before anything is signed.
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

function BackLink() {
	return (
		<Link
			href="/"
			className="inline-flex w-fit items-center gap-1 type-body-sm text-fg-secondary transition-colors hover:text-fg"
		>
			<ChevronLeftIcon className="size-3" />
			Marketplace
		</Link>
	)
}

function DetailSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-4 w-28" />
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-9 w-80" />
					<Skeleton className="h-4 w-52" />
					<div className="flex gap-1.5">
						<Skeleton className="h-5 w-24" />
						<Skeleton className="h-5 w-20" />
					</div>
				</div>
				<Skeleton className="h-7 w-64" />
			</div>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton key={index} className="h-24" />
				))}
			</div>
			<div className="grid gap-4 lg:grid-cols-3">
				<div className={cn('flex flex-col gap-4 lg:col-span-2')}>
					<Skeleton className="h-[380px]" />
					<Skeleton className="h-32" />
					<Skeleton className="h-64" />
				</div>
				<Skeleton className="h-[420px]" />
			</div>
		</div>
	)
}
