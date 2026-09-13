'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { ApiError } from '@/lib/api'
import { UnrecordedTransferError, flushUnrecorded, recordSettledTransfer } from '@/lib/settlement'
import { WalletError, investInStrategy, withdrawFromStrategy } from '@/lib/wallet'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useToast } from '@/components/ui/Toast'
import { EM_DASH, formatUsd, formatUsdcPrecise } from '@/lib/format'
import type { Position, StrategyDetail } from '@/lib/types'
import {
	amountForShares,
	exceeds,
	isPositive,
	scaleAmount,
	sharesForAmount,
	toMicros,
	trimAmount,
} from '@/components/strategy/amount'

type Mode = 'deposit' | 'withdraw'

/**
 * A failure can come from the wallet (no gas, short balance, a revert the vault named) or
 * from the backend refusing the receipt. Both carry a message worth showing verbatim.
 */
function reasonFor(cause: unknown, fallback: string): string {
	if (cause instanceof WalletError) return cause.message
	if (cause instanceof ApiError) return cause.message
	return fallback
}

const MODE_OPTIONS: readonly { value: Mode; label: string }[] = [
	{ value: 'deposit', label: 'Deposit' },
	{ value: 'withdraw', label: 'Withdraw' },
]

/** Shortcuts are percentages of a real balance, never fixed ticket sizes. */
const QUICK_PERCENTS = [25, 50, 75, 100] as const

export interface InvestPanelProps {
	strategy: StrategyDetail
	position: Position | null
	/** The caller's spendable USDC, or null when the portfolio call failed. */
	availableUsdc: string | null
	onSettled: () => void
	className?: string
}

export function InvestPanel({ strategy, position, availableUsdc, onSettled, className }: InvestPanelProps) {
	const [mode, setMode] = useState<Mode>('deposit')
	const activeMode: Mode = position === null ? 'deposit' : mode

	// A transfer that settled on chain but never reached the backend is replayed the moment
	// this panel is on screen, so an investor who reloads after a failed record sees their
	// position rather than having to move money again to shake it loose.
	useEffect(() => {
		let live = true
		flushUnrecorded()
			.then((settled) => {
				if (live && settled > 0) onSettled()
			})
			.catch((error: unknown) => {
				console.error('attesta: replaying unrecorded transfers failed', error)
			})
		return () => {
			live = false
		}
	}, [onSettled])

	return (
		<section className={cn('rounded-sm border border-hairline bg-surface-1', className)}>
			<div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
				<h2 className="type-headline-sm text-fg">{position === null ? 'Allocate' : 'Manage position'}</h2>
				{position === null ? null : (
					<SegmentedControl ariaLabel="Action" options={MODE_OPTIONS} value={mode} onChange={setMode} />
				)}
			</div>
			{activeMode === 'deposit' ? (
				<DepositForm
					strategy={strategy}
					availableUsdc={availableUsdc}
					onSettled={onSettled}
					holding={position !== null}
				/>
			) : position === null ? null : (
				<WithdrawForm strategy={strategy} position={position} onSettled={onSettled} />
			)}
		</section>
	)
}

interface DepositFormProps {
	strategy: StrategyDetail
	availableUsdc: string | null
	onSettled: () => void
	holding: boolean
}

function DepositForm({ strategy, availableUsdc, onSettled, holding }: DepositFormProps) {
	const { toast } = useToast()
	const [amount, setAmount] = useState('')
	const [submitting, setSubmitting] = useState(false)

	const navPerShare = strategy.metrics.navPerShare
	const parsed = toMicros(amount)
	const overBalance = availableUsdc !== null && amount !== '' && exceeds(amount, availableUsdc)
	const invalid = amount !== '' && (parsed === null || parsed <= 0n)
	const shares = amount === '' || parsed === null ? null : sharesForAmount(amount, navPerShare)
	const ready = isPositive(amount) && !overBalance && !invalid && strategy.vaultAddress !== null

	const error = invalid
		? 'Enter an amount in USDC.'
		: overBalance
		  ? 'More than the wallet holds.'
		  : strategy.vaultAddress === null
		    ? 'This strategy has no vault deployed yet, so it cannot take an allocation.'
		    : null

	// The browser signs approve and deposit itself, then hands the backend the hash; the
	// backend records the position from the receipt rather than from anything claimed here.
	async function submit() {
		const vault = strategy.vaultAddress
		if (!ready || vault === null) return
		setSubmitting(true)
		try {
			const txHash = await investInStrategy(vault, amount)
			const next = await recordSettledTransfer('deposit', strategy.slug, txHash)
			toast({
				tone: 'success',
				title: holding ? 'Added to your position' : 'Allocation confirmed',
				description:
					next === null
						? `${formatUsd(amount)} into ${strategy.name}.`
						: `${formatUsd(amount)} into ${strategy.name}. You now hold ${trimAmount(next.shares) ?? next.shares} shares.`,
			})
			setAmount('')
			onSettled()
		} catch (cause: unknown) {
			// The vault has the USDC once the deposit is mined, so a backend that cannot be
			// reached after that point is a bookkeeping failure, not a failed deposit, and
			// saying otherwise would send the investor to deposit a second time.
			if (cause instanceof UnrecordedTransferError) {
				console.error('attesta: the allocation settled on chain but was not recorded', cause)
				toast({
					tone: 'error',
					title: 'Allocated, not yet recorded',
					description: `The vault took ${formatUsd(amount)} in ${cause.transfer.txHash}. attesta could not reach the backend to write it down and will record it as soon as it can.`,
				})
				setAmount('')
				onSettled()
				return
			}
			console.error('attesta: the allocation failed', cause)
			toast({
				tone: 'error',
				title: 'Allocation failed',
				description: reasonFor(cause, 'The deposit did not go through.'),
			})
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="flex flex-col gap-3 p-4">
			<AmountField
				label="Amount"
				unit="USDC"
				value={amount}
				onChange={setAmount}
				error={error}
			/>

			<div className="flex items-center justify-between gap-2">
				<span className="type-body-sm text-fg-secondary">Available</span>
				<span className="type-code-md text-fg">
					{availableUsdc === null ? (
						<span className="text-fg-muted">unavailable</span>
					) : (
						formatUsd(availableUsdc)
					)}
				</span>
			</div>

			<QuickAmounts source={availableUsdc} onPick={setAmount} />

			<dl className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface-2 p-3">
				<SummaryRow label="You allocate" value={amount === '' ? EM_DASH : formatUsd(amount)} />
				<SummaryRow label="Platform fee" value="0.00 USDC" />
				<SummaryRow label="NAV per share" value={`${formatUsdcPrecise(navPerShare)} USDC`} />
				<SummaryRow
					label="You receive"
					value={shares === null ? EM_DASH : `${shares} shares`}
					emphasis
				/>
			</dl>

			<p className="type-body-sm text-fg-muted">
				attesta charges no allocation fee — the vault mints shares against the full deposit at the NAV
				per share above.
			</p>

			<Button variant="primary" block loading={submitting} disabled={!ready} onClick={submit}>
				{holding ? 'Add to position' : 'Allocate USDC'}
			</Button>
		</div>
	)
}

interface WithdrawFormProps {
	strategy: StrategyDetail
	position: Position
	onSettled: () => void
}

function WithdrawForm({ strategy, position, onSettled }: WithdrawFormProps) {
	const { toast } = useToast()
	const [shares, setShares] = useState('')
	const [submitting, setSubmitting] = useState(false)

	const navPerShare = strategy.metrics.navPerShare
	const parsed = toMicros(shares)
	const overHolding = shares !== '' && exceeds(shares, position.shares)
	const invalid = shares !== '' && (parsed === null || parsed <= 0n)
	const proceeds = shares === '' || parsed === null ? null : amountForShares(shares, navPerShare)
	const ready = isPositive(shares) && !overHolding && !invalid && strategy.vaultAddress !== null

	const error = invalid
		? 'Enter a number of shares.'
		: overHolding
		  ? 'More shares than you hold.'
		  : strategy.vaultAddress === null
		    ? 'This strategy has no vault deployed, so there is nothing to redeem against.'
		    : null

	async function submit() {
		const vault = strategy.vaultAddress
		if (!ready || vault === null) return
		setSubmitting(true)
		try {
			const txHash = await withdrawFromStrategy(vault, shares)
			const next = await recordSettledTransfer('withdraw', strategy.slug, txHash)
			toast({
				tone: 'success',
				title: 'Withdrawal confirmed',
				description:
					next === null
						? `Redeemed ${shares} shares from ${strategy.name}.`
						: `Redeemed ${shares} shares. ${trimAmount(next.shares) ?? next.shares} shares remain in ${strategy.name}.`,
			})
			setShares('')
			onSettled()
		} catch (cause: unknown) {
			if (cause instanceof UnrecordedTransferError) {
				console.error('attesta: the withdrawal settled on chain but was not recorded', cause)
				toast({
					tone: 'error',
					title: 'Redeemed, not yet recorded',
					description: `The vault paid out ${shares} shares in ${cause.transfer.txHash}. attesta could not reach the backend to write it down and will record it as soon as it can.`,
				})
				setShares('')
				onSettled()
				return
			}
			console.error('attesta: the withdrawal failed', cause)
			toast({
				tone: 'error',
				title: 'Withdrawal failed',
				description: reasonFor(cause, 'The withdrawal did not go through.'),
			})
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="flex flex-col gap-3 p-4">
			<AmountField label="Shares to redeem" unit="SHARES" value={shares} onChange={setShares} error={error} />

			<div className="flex items-center justify-between gap-2">
				<span className="type-body-sm text-fg-secondary">You hold</span>
				<span className="type-code-md text-fg">{trimAmount(position.shares) ?? position.shares} shares</span>
			</div>

			<QuickAmounts source={position.shares} onPick={setShares} />

			<dl className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface-2 p-3">
				<SummaryRow label="Redeeming" value={shares === '' ? EM_DASH : `${shares} shares`} />
				<SummaryRow label="Platform fee" value="0.00 USDC" />
				<SummaryRow label="NAV per share" value={`${formatUsdcPrecise(navPerShare)} USDC`} />
				<SummaryRow label="You receive" value={proceeds === null ? EM_DASH : formatUsd(proceeds)} emphasis />
			</dl>

			<p className="type-body-sm text-fg-muted">
				Shares are redeemed against the vault at the NAV per share of the settling block, so the figure
				above is a quote rather than a promise.
			</p>

			<Button variant="destructive" block loading={submitting} disabled={!ready} onClick={submit}>
				Withdraw
			</Button>
		</div>
	)
}

interface AmountFieldProps {
	label: string
	unit: string
	value: string
	onChange: (next: string) => void
	error: string | null
}

function AmountField({ label, unit, value, onChange, error }: AmountFieldProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<label className="type-label-caps text-fg-secondary" htmlFor={`amount-${unit}`}>
				{label}
			</label>
			<div className="relative flex items-center">
				<input
					id={`amount-${unit}`}
					inputMode="decimal"
					autoComplete="off"
					placeholder="0.00"
					value={value}
					onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))}
					aria-invalid={error !== null || undefined}
					className={cn(
						'h-11 w-full rounded-sm border bg-surface-2 pl-3 pr-20 type-metric-lg text-fg',
						'placeholder:text-fg-muted transition-colors focus:outline-none',
						error === null
							? 'border-hairline hover:border-hairline-strong focus:border-telemetry-hover'
							: 'border-risk focus:border-risk-light',
					)}
				/>
				<span className="pointer-events-none absolute right-3 type-label-caps text-fg-muted">{unit}</span>
			</div>
			{error === null ? null : <p className="type-body-sm text-risk-light">{error}</p>}
		</div>
	)
}

function QuickAmounts({ source, onPick }: { source: string | null; onPick: (next: string) => void }) {
	return (
		<div className="grid grid-cols-4 gap-1.5">
			{QUICK_PERCENTS.map((percent) => {
				const next = source === null ? null : scaleAmount(source, percent)
				return (
					<Button
						key={percent}
						size="compact"
						disabled={next === null || next === '0'}
						onClick={() => {
							if (next !== null) onPick(next)
						}}
					>
						{percent === 100 ? 'Max' : `${percent}%`}
					</Button>
				)
			})}
		</div>
	)
}

function SummaryRow({ label, value, emphasis }: { label: string; value: ReactNode; emphasis?: boolean }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<dt className="type-body-sm text-fg-secondary">{label}</dt>
			<dd className={cn('truncate type-code-md', emphasis ? 'text-verified' : 'text-fg')}>{value}</dd>
		</div>
	)
}
