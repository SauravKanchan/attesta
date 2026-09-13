'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatUsd, formatUsdcPrecise } from '@/lib/format'
import { ApiError, getStrategy } from '@/lib/api'
import { UnrecordedTransferError, recordSettledTransfer } from '@/lib/settlement'
import { WalletError, withdrawFromStrategy } from '@/lib/wallet'
import { amountForShares, formatUnits6, parseUnits6, percentOf, sharesForAmount, unitsOrZero } from '@/components/portfolio/units'
import type { Position } from '@/lib/types'

const QUICK_PERCENTS = [25, 50, 75, 100] as const

export interface WithdrawModalProps {
	position: Position | null
	onClose: () => void
	/** Null when the backend reported the redemption as already recorded, so it sent no position back. */
	onWithdrawn: (position: Position | null) => void
}

/**
 * Withdrawals are denominated in shares on the wire, but an investor thinks in USDC,
 * so the amount entered here is converted against the position's own reported rate.
 * A full exit sends the share balance verbatim rather than a converted figure, so
 * rounding can never strand dust the investor is then unable to redeem.
 */
export function WithdrawModal({ position, onClose, onWithdrawn }: WithdrawModalProps) {
	const { toast } = useToast()
	const [amount, setAmount] = useState('')
	const [exitInFull, setExitInFull] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (position === null) return
		setAmount('')
		setExitInFull(false)
		setError(null)
		setSubmitting(false)
	}, [position])

	const heldShares = unitsOrZero(position?.shares)
	const heldValue = unitsOrZero(position?.currentValue)

	const requested = useMemo(() => {
		if (exitInFull) return { shares: heldShares, receive: heldValue }
		const entered = parseUnits6(amount)
		if (entered === null || entered <= 0n) return { shares: 0n, receive: 0n }
		const shares = sharesForAmount(entered, heldShares, heldValue)
		return { shares, receive: amountForShares(shares, heldShares, heldValue) }
	}, [amount, exitInFull, heldShares, heldValue])

	const entered = parseUnits6(amount)
	const overBalance = !exitInFull && entered !== null && entered > heldValue
	const invalid =
		position === null || requested.shares <= 0n || overBalance || (entered === null && amount.trim() !== '')

	function selectPercent(percent: number) {
		if (position === null) return
		setExitInFull(percent >= 100)
		setAmount(formatUnits6(percentOf(heldValue, percent)))
		setError(null)
	}

	// A `Position` names its strategy but not its vault, and the vault is what the browser
	// has to sign against — so the strategy is re-read here to find the address.
	async function submit() {
		if (position === null || invalid) return
		setSubmitting(true)
		setError(null)
		try {
			const strategy = await getStrategy(position.strategySlug)
			if (strategy.vaultAddress === null) {
				throw new WalletError(
					'chain-error',
					'This strategy has no vault deployed, so there is nothing to redeem against.',
				)
			}
			const txHash = await withdrawFromStrategy(strategy.vaultAddress, formatUnits6(requested.shares))
			const updated = await recordSettledTransfer('withdraw', position.strategySlug, txHash)
			toast({
				tone: 'success',
				title: 'Withdrawal settled',
				description: `${formatUsd(formatUnits6(requested.receive))} redeemed from ${position.strategyName}.`,
			})
			onWithdrawn(updated)
		} catch (caught) {
			// The vault pays out when the redemption is mined. A backend that cannot be
			// reached after that only leaves the position unwritten, so the investor is told
			// what actually happened rather than that the withdrawal failed.
			if (caught instanceof UnrecordedTransferError) {
				console.error('attesta: the withdrawal settled on chain but was not recorded', caught)
				const message = `The vault paid out in ${caught.transfer.txHash}, but attesta could not reach the backend to record it. It will be recorded as soon as it can.`
				setError(message)
				toast({ tone: 'error', title: 'Redeemed, not yet recorded', description: message })
				return
			}
			console.error('attesta: the withdrawal failed', caught)
			const message =
				caught instanceof WalletError || caught instanceof ApiError
					? caught.message
					: 'The withdrawal could not be submitted'
			setError(message)
			toast({ tone: 'error', title: 'Withdrawal failed', description: message })
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Modal
			open={position !== null}
			onClose={onClose}
			title="Withdraw"
			description={position === null ? undefined : `Redeem shares of ${position.strategyName} for USDC.`}
			footer={
				<>
					<Button onClick={onClose} disabled={submitting}>
						Cancel
					</Button>
					<Button variant="primary" onClick={submit} loading={submitting} disabled={invalid}>
						Confirm withdrawal
					</Button>
				</>
			}
		>
			{position === null ? null : (
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-2 gap-3">
						<Figure label="Position value" value={formatUsd(position.currentValue)} />
						<Figure label="Shares held" value={formatUsdcPrecise(position.shares)} />
					</div>

					<div className="flex flex-col gap-2">
						<Input
							mono
							label="Amount to withdraw"
							inputMode="decimal"
							placeholder="0.00"
							leading={<span className="type-code-md">$</span>}
							value={amount}
							onChange={(event) => {
								setAmount(event.target.value)
								setExitInFull(false)
								setError(null)
							}}
							error={overBalance ? 'More than this position is worth' : null}
						/>
						<div className="flex items-center gap-1.5">
							{QUICK_PERCENTS.map((percent) => (
								<Button
									key={percent}
									size="compact"
									onClick={() => selectPercent(percent)}
									className={cn(percent === 100 && exitInFull && 'border-verified text-verified')}
								>
									{percent === 100 ? 'Max' : `${percent}%`}
								</Button>
							))}
						</div>
					</div>

					<dl className="flex flex-col gap-2 rounded-sm border border-hairline bg-canvas px-3 py-2.5">
						<Row label="Shares burned" value={formatUsdcPrecise(formatUnits6(requested.shares))} />
						<Row label="Protocol fee" value={formatUsd('0')} />
						<Row
							label="You receive"
							value={formatUsd(formatUnits6(requested.receive))}
							emphasis
						/>
					</dl>

					<p className="type-body-sm text-fg-muted">
						The vault redeems shares at its current NAV per share and deducts nothing, so the fee is
						zero. The figure above is an estimate: the settled amount is priced at the NAV in force
						when the withdrawal transaction confirms, and it arrives in your wallet in that same
						transaction.
					</p>

					{error === null ? null : <p className="type-body-sm text-risk-light">{error}</p>}
				</div>
			)}
		</Modal>
	)
}

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-sm border border-hairline bg-canvas px-3 py-2">
			<p className="type-label-caps text-fg-muted">{label}</p>
			<p className="mt-1 type-code-lg text-fg">{value}</p>
		</div>
	)
}

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
	return (
		<div className="flex items-baseline justify-between gap-4">
			<dt className="type-body-sm text-fg-secondary">{label}</dt>
			<dd className={cn('num', emphasis ? 'type-code-lg text-fg' : 'type-code-md text-fg-secondary')}>
				{value}
			</dd>
		</div>
	)
}
