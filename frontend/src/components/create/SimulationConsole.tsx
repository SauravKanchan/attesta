'use client'

import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/cn'
import type { StrategyAction } from '@shared/strategy-contract'

/**
 * The simulation's own output, verbatim. The one piece of interpretation applied is
 * finding the strategy's verdict: a `TickDecision.action` is one of four tokens from
 * the shared contract, so a line carrying one is the decision line and is lifted out of
 * the rest of the log.
 */

/** Keyed by the union, so a new action in the contract fails this file to compile. */
const ACTION_TOKENS: Record<StrategyAction, true> = {
	HOLD: true,
	REBALANCE: true,
	ENTER: true,
	EXIT: true,
}

const ACTION_PATTERN = new RegExp(`\\b(${Object.keys(ACTION_TOKENS).join('|')})\\b`)

export interface SimulationConsoleProps {
	lines: readonly string[]
	streaming: boolean
}

export function SimulationConsole({ lines, streaming }: SimulationConsoleProps) {
	const scroller = useRef<HTMLDivElement>(null)

	// A running pipeline appends; keep the newest line in view.
	useEffect(() => {
		const element = scroller.current
		if (element === null) return
		element.scrollTop = element.scrollHeight
	}, [lines])

	const verdictIndex = useMemo(() => {
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (ACTION_PATTERN.test(lines[index] ?? '')) return index
		}
		return -1
	}, [lines])

	return (
		<div className="flex min-h-0 flex-col rounded-sm border border-hairline bg-surface-1">
			<div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
				<div>
					<h2 className="type-headline-sm text-fg">Simulation output</h2>
					<p className="mt-0.5 type-body-sm text-fg-secondary">
						What `cre workflow simulate` printed while your strategy ran.
					</p>
				</div>
				{streaming ? (
					<span className="flex items-center gap-1.5 type-label-caps text-telemetry-hover">
						<span className="size-1.5 rounded-xs bg-telemetry-hover pulse-dot" />
						Running
					</span>
				) : null}
			</div>

			<div ref={scroller} className="max-h-72 overflow-y-auto bg-canvas p-3">
				{lines.length === 0 ? (
					<p className="type-code-sm text-fg-muted">
						No output yet. Run the pre-flight checks to build and simulate the workflow.
					</p>
				) : (
					<ol className="flex flex-col">
						{lines.map((line, index) => (
							<li
								key={`${index}-${line}`}
								className={cn(
									'flex gap-3 rounded-xs px-1.5 py-0.5',
									index === verdictIndex && 'border-l-2 border-verified bg-verified/8',
								)}
							>
								<span className="shrink-0 select-none type-code-sm text-fg-muted">
									{String(index + 1).padStart(2, '0')}
								</span>
								<span
									className={cn(
										'min-w-0 whitespace-pre-wrap break-words type-code-sm',
										index === verdictIndex ? 'text-verified' : 'text-fg-secondary',
									)}
								>
									{line}
								</span>
							</li>
						))}
					</ol>
				)}
			</div>

			{verdictIndex === -1 ? null : (
				<p className="border-t border-hairline px-4 py-2.5 type-body-sm text-fg-muted">
					The highlighted line is the strategy&apos;s own verdict for the simulated tick — the
					decision the enclave would sign.
				</p>
			)}
		</div>
	)
}
