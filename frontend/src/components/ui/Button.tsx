'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'
export type ButtonSize = 'compact' | 'standard' | 'large'

const VARIANT: Record<ButtonVariant, string> = {
	primary: 'border-verified bg-verified text-canvas hover:bg-verified-hover active:bg-verified-active',
	secondary: 'border-hairline-strong bg-surface-2 text-fg hover:bg-interact active:bg-surface-2',
	destructive: 'border-risk/50 bg-risk/10 text-risk-light hover:bg-risk/20 active:bg-risk/30',
	ghost: 'border-transparent bg-transparent text-fg-secondary hover:bg-interact hover:text-fg',
}

const SIZE: Record<ButtonSize, string> = {
	compact: 'h-7 gap-1.5 px-3 type-body-sm',
	standard: 'h-9 gap-2 px-4 type-body-md',
	large: 'h-11 gap-2.5 px-5 type-body-lg',
}

const BASE = [
	'inline-flex shrink-0 select-none items-center justify-center rounded-sm border font-medium',
	'transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
].join(' ')

interface ButtonStyleOptions {
	variant?: ButtonVariant
	size?: ButtonSize
	block?: boolean
	className?: string
}

/** The button's look on its own, so an anchor or a label can wear it too. */
export function buttonClassName({
	variant = 'secondary',
	size = 'standard',
	block,
	className,
}: ButtonStyleOptions = {}): string {
	return cn(BASE, VARIANT[variant], SIZE[size], block && 'w-full', className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant
	size?: ButtonSize
	/** Renders a spinner in place of the leading icon and blocks interaction. */
	loading?: boolean
	icon?: ReactNode
	/** Sits after the label — an arrow on a forward action, a chevron on a menu. */
	trailingIcon?: ReactNode
	block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{
		variant = 'secondary',
		size = 'standard',
		loading = false,
		icon,
		trailingIcon,
		block,
		className,
		children,
		disabled,
		...rest
	},
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={buttonClassName({ variant, size, block, className })}
			{...rest}
		>
			{loading ? <Spinner /> : icon}
			{children}
			{loading ? null : trailingIcon}
		</button>
	)
})

export interface LinkButtonProps extends ComponentProps<typeof Link> {
	variant?: ButtonVariant
	size?: ButtonSize
	icon?: ReactNode
	trailingIcon?: ReactNode
	block?: boolean
}

/**
 * A navigation that looks like a button. Anything that changes the URL should be
 * a link, so it opens in a new tab and shows its destination on hover.
 */
export function LinkButton({
	variant = 'secondary',
	size = 'standard',
	icon,
	trailingIcon,
	block,
	className,
	children,
	...rest
}: LinkButtonProps) {
	return (
		<Link className={buttonClassName({ variant, size, block, className })} {...rest}>
			{icon}
			{children}
			{trailingIcon}
		</Link>
	)
}

function Spinner() {
	return (
		<svg className="size-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
			<path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}
