'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'
export type ButtonSize = 'compact' | 'standard'

const VARIANT: Record<ButtonVariant, string> = {
	primary: 'border-verified bg-verified text-canvas hover:bg-verified-hover active:bg-verified-active',
	secondary: 'border-hairline-strong bg-surface-2 text-fg hover:bg-interact active:bg-surface-2',
	destructive: 'border-risk/50 bg-risk/10 text-risk-light hover:bg-risk/20 active:bg-risk/30',
	ghost: 'border-transparent bg-transparent text-fg-secondary hover:bg-interact hover:text-fg',
}

const SIZE: Record<ButtonSize, string> = {
	compact: 'h-7 gap-1.5 px-3 type-body-sm',
	standard: 'h-9 gap-2 px-4 type-body-md',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant
	size?: ButtonSize
	/** Renders a spinner in place of the leading icon and blocks interaction. */
	loading?: boolean
	icon?: ReactNode
	block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ variant = 'secondary', size = 'standard', loading = false, icon, block, className, children, disabled, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={cn(
				'inline-flex shrink-0 select-none items-center justify-center rounded-sm border font-medium',
				'transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
				VARIANT[variant],
				SIZE[size],
				block && 'w-full',
				className,
			)}
			{...rest}
		>
			{loading ? <Spinner /> : icon}
			{children}
		</button>
	)
})

function Spinner() {
	return (
		<svg className="size-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
			<path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}
