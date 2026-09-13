import type { SVGProps } from 'react'

/**
 * A small, deliberately flat icon set. Everything is a 16-unit viewBox drawn with a
 * 1.5 stroke so glyphs sit on the same optical weight as the hairline borders.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...rest }: IconProps) {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	)
}

export function ChevronDownIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3.5 6 8 10.5 12.5 6" />
		</Icon>
	)
}

export function ChevronLeftIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M10 3.5 5.5 8 10 12.5" />
		</Icon>
	)
}

export function ChevronRightIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M6 3.5 10.5 8 6 12.5" />
		</Icon>
	)
}

export function CheckIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3 8.5 6.25 11.75 13 5" />
		</Icon>
	)
}

export function CloseIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 4l8 8M12 4l-8 8" />
		</Icon>
	)
}

export function SearchIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="7" cy="7" r="4.25" />
			<path d="M10.25 10.25 13.5 13.5" />
		</Icon>
	)
}

export function ShieldCheckIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8 1.75 13.25 3.5v4.1c0 3.02-2.1 5.42-5.25 6.65-3.15-1.23-5.25-3.63-5.25-6.65V3.5L8 1.75Z" />
			<path d="M5.75 7.9 7.4 9.55l3-3.1" />
		</Icon>
	)
}

export function GridIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="2.25" y="2.25" width="5" height="5" rx="0.5" />
			<rect x="8.75" y="2.25" width="5" height="5" rx="0.5" />
			<rect x="2.25" y="8.75" width="5" height="5" rx="0.5" />
			<rect x="8.75" y="8.75" width="5" height="5" rx="0.5" />
		</Icon>
	)
}

export function WalletIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="1.75" y="3.75" width="12.5" height="9" rx="1" />
			<path d="M1.75 6.75h12.5" />
			<circle cx="11.25" cy="9.75" r="0.75" fill="currentColor" stroke="none" />
		</Icon>
	)
}

export function CodeIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3" />
		</Icon>
	)
}

export function SidebarIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1" />
			<path d="M6.25 2.75v10.5" />
		</Icon>
	)
}

export function SignOutIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M6.5 13.25H3.25v-10.5H6.5" />
			<path d="M9.75 10.5 12.75 8 9.75 5.5M12.75 8H6.25" />
		</Icon>
	)
}

export function InboxIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M1.75 8.75h3l1 2h4.5l1-2h3" />
			<path d="M3.4 3.25h9.2l1.65 5.5v4.5a.5.5 0 0 1-.5.5H2.25a.5.5 0 0 1-.5-.5v-4.5l1.65-5.5Z" />
		</Icon>
	)
}

export function AlertIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="8" cy="8" r="6.25" />
			<path d="M8 4.75v3.75M8 11.1h.01" />
		</Icon>
	)
}

export function ExternalIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5" />
			<path d="M12 9.75v2.75a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5A.75.75 0 0 1 3.75 4H6.5" />
		</Icon>
	)
}
