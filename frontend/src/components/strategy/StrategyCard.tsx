import Link from 'next/link'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/ui/Skeleton'
import { Sparkline } from '@/components/Sparkline'
import { StatusPill } from '@/components/ui/StatusPill'
import { Tag } from '@/components/ui/Tag'
import { VerificationBadge } from '@/components/VerificationBadge'
import { EM_DASH, formatPercent, formatUsdCompact, signTextClass, truncateHash } from '@/lib/format'
import { Highlight } from '@/components/strategy/Highlight'
import type { StrategyEntry } from '@/components/strategy/entries'
import { RISK_LABEL, RISK_TONE, STRATEGY_TYPE_LABEL } from '@/components/strategy/strategy-meta'

export interface StrategyCardProps {
	entry: StrategyEntry
	className?: string
}

export function StrategyCard({ entry, className }: StrategyCardProps) {
	const { strategy, ticker, handle, match } = entry
	const { metrics, verification } = strategy
	const apy = metrics.apy
	// A strategy minutes old has no defensible annualised figure, so the card leads with
	// the fact — return since inception — and falls back to APY once there is history for
	// it. Both are attested; only one of them is a projection.
	const headline = apy ?? metrics.totalReturn
	const headlineLabel = apy === null ? 'SINCE INCEPTION' : 'APY'

	return (
		<article
			className={cn(
				'group relative flex flex-col gap-3 rounded-sm border border-hairline bg-surface-1 p-4',
				'transition-colors hover:border-hairline-strong',
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<h3 className="min-w-0 type-headline-sm text-fg">
					{/* Stretched link: the whole card is the target, without nesting the badge in an anchor. */}
					<Link
						href={`/strategy/${strategy.slug}`}
						className="after:absolute after:inset-0 after:content-[''] hover:text-verified"
					>
						<Highlight text={strategy.name} indices={match?.name} />
					</Link>
				</h3>
				<StatusPill status={strategy.status} className="shrink-0" />
			</div>

			<p className="flex flex-wrap items-center gap-x-2 type-body-sm text-fg-secondary">
				<span>
					by <Highlight text={handle} indices={match?.creator} className="text-fg-secondary" />
				</span>
				<span className="text-fg-muted">&middot;</span>
				<Highlight text={ticker} indices={match?.ticker} className="type-code-sm text-fg-secondary" />
			</p>

			<div className="flex flex-wrap gap-1.5">
				{strategy.types.map((type) => (
					<Tag key={type}>{STRATEGY_TYPE_LABEL[type]}</Tag>
				))}
				<Tag tone={RISK_TONE[strategy.riskLevel]}>{RISK_LABEL[strategy.riskLevel]} risk</Tag>
			</div>

			<div className="flex items-end justify-between gap-3 rounded-sm border border-hairline bg-surface-2 px-3 py-2.5">
				<div className="min-w-0">
					<p className="type-label-caps text-fg-muted">Attested return</p>
					<p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
						<span className={cn('type-metric-display', headline === null ? 'text-fg-muted' : signTextClass(headline))}>
							{headline === null ? EM_DASH : formatPercent(headline)}
						</span>
						{/* The label is one unit: a narrow card drops it to its own line rather than
						    breaking "SINCE INCEPTION" across two. */}
						<span className="whitespace-nowrap type-label-caps text-fg-muted">{headlineLabel}</span>
					</p>
				</div>
				{strategy.sparkline.length > 1 ? (
					<Sparkline
						values={strategy.sparkline}
						tone={headline !== null && headline < 0 ? 'down' : undefined}
						className="shrink-0"
					/>
				) : (
					<span className="shrink-0 type-body-sm text-fg-muted">No NAV history</span>
				)}
			</div>

			<dl className="grid grid-cols-3 gap-2">
				<Metric label="AUM" value={formatUsdCompact(metrics.aum)} />
				<Metric
					label="Max drawdown"
					value={metrics.maxDrawdown === null ? EM_DASH : formatPercent(metrics.maxDrawdown)}
					valueClassName={metrics.maxDrawdown === null ? 'text-fg-muted' : 'text-risk-light'}
				/>
				<Metric label="Investors" value={String(metrics.investorCount)} />
			</dl>

			<div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
				<VerificationBadge verification={verification} size="compact" />
				<Tag recessed mono title={verification.binaryHash ?? undefined}>
					{verification.binaryHash === null ? 'hash pending' : truncateHash(verification.binaryHash, 8, 6)}
				</Tag>
			</div>
		</article>
	)
}

function Metric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
	return (
		<div className="min-w-0">
			<dt className="type-label-caps text-fg-muted">{label}</dt>
			<dd className={cn('mt-0.5 truncate type-code-md text-fg', valueClassName)}>{value}</dd>
		</div>
	)
}

export function StrategyCardSkeleton() {
	return (
		<div className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-1 p-4">
			<div className="flex items-start justify-between gap-3">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-5 w-16" />
			</div>
			<Skeleton className="h-3.5 w-32" />
			<div className="flex gap-1.5">
				<Skeleton className="h-5 w-20" />
				<Skeleton className="h-5 w-24" />
			</div>
			<Skeleton className="h-16 w-full" />
			<div className="grid grid-cols-3 gap-2">
				<Skeleton className="h-8" />
				<Skeleton className="h-8" />
				<Skeleton className="h-8" />
			</div>
			<Skeleton className="h-7 w-full" />
		</div>
	)
}
