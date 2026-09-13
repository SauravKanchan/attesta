import { StatTile } from '@/components/ui/StatTile'
import { formatDate, formatPercentPoints, formatSignedUsd, formatUsd, signTextClass } from '@/lib/format'
import type { Position } from '@/lib/types'
import { trimAmount } from '@/components/strategy/amount'

/** What the caller's own money has done here, ahead of anything about the strategy. */
export function PositionSummary({ position }: { position: Position }) {
	return (
		<section className="rounded-sm border border-verified/30 bg-verified/5 p-4">
			<div className="flex items-center gap-2">
				<span className="size-1.5 rounded-xs bg-verified pulse-dot" />
				<h2 className="type-label-caps text-verified">Your position</h2>
			</div>
			<div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<StatTile label="Invested" value={formatUsd(position.costBasis)} />
				<StatTile label="Current value" value={formatUsd(position.currentValue)} />
				<StatTile
					label="Unrealised P&L"
					value={formatSignedUsd(position.unrealisedPnl)}
					valueClassName={signTextClass(position.unrealisedPnl)}
					delta={
						<span className={signTextClass(position.unrealisedPnlPct)}>
							{formatPercentPoints(position.unrealisedPnlPct)}
						</span>
					}
				/>
				<StatTile
					label="First allocated"
					value={<span className="type-code-lg">{formatDate(position.firstAllocatedAt)}</span>}
					hint={`${trimAmount(position.shares) ?? position.shares} shares held`}
				/>
			</div>
		</section>
	)
}
