'use client'

import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { EnclaveArtifact } from '@/app/(marketing)/EnclaveArtifact'
import { cn } from '@/lib/cn'
import { LinkButton } from '@/components/ui/Button'
import { ArrowRightIcon, ChipIcon, LinkIcon, LockIcon } from '@/components/ui/icons'
import { Tag } from '@/components/ui/Tag'
import { Wordmark } from '@/components/ui/Wordmark'

/**
 * The public root. A signed-out visitor lands here; a signed-in one gets the
 * marketplace at the same URL.
 *
 * Deliberately without a single figure. The platform has no track record yet, and a
 * landing page that claims one is exactly the thing the product exists to make
 * impossible.
 */

const SIGN_IN_HREF = '/login'
const REPO_URL = 'https://github.com/SauravKanchan/attesta'
const DOCS_URL = `${REPO_URL}/tree/main/docs`

const GUARANTEES = [
	{
		icon: <LinkIcon className="size-4" />,
		title: 'The code is hash-locked',
		body: "A strategy's identity is the hash of its compiled binary. Swap the code and it becomes a different strategy with a fresh track record.",
		footnote: 'WASM SHA-256 digest',
	},
	{
		icon: <ChipIcon className="size-4" />,
		title: 'It runs where nobody can reach it',
		body: 'Execution happens inside the enclave, so neither the creator, the platform, nor the node operators can alter it mid-run.',
		footnote: 'AWS Nitro Enclave isolation',
	},
	{
		icon: <LockIcon className="size-4" />,
		title: 'Your parameters stay yours',
		body: "Strategy parameters are encrypted in the creator's own browser; the platform relays ciphertext it cannot read.",
		footnote: 'Client-side enclave keying',
	},
]

const STEPS = [
	{
		index: '01',
		tag: 'TypeScript',
		title: 'Publish',
		body: 'Write a strategy as TypeScript. We compile it and measure the binary.',
	},
	{
		index: '02',
		tag: 'Enclave',
		title: 'Attest',
		body: 'The workflow runs inside an AWS Nitro Enclave, isolated from everyone.',
	},
	{
		index: '03',
		tag: 'USDC',
		title: 'Trade',
		body: 'A policy-capped USDC wallet executes the decisions the strategy returned.',
	},
	{
		index: '04',
		tag: 'Verify',
		title: 'Verify',
		body: 'Recompute the hash from the published source and check that it matches.',
	},
]

/** The chain a reported number has to travel before anyone is asked to believe it. */
const CHAIN = ['TypeScript', 'binary hash', 'enclave attestation', 'signed report', 'performance record']

const GRID_FIELD: CSSProperties = {
	backgroundImage: [
		'linear-gradient(to right, color-mix(in oklab, var(--color-hairline) 85%, transparent) 1px, transparent 1px)',
		'linear-gradient(to bottom, color-mix(in oklab, var(--color-hairline) 85%, transparent) 1px, transparent 1px)',
	].join(', '),
	backgroundSize: '64px 64px',
	maskImage: 'radial-gradient(ellipse 70% 55% at 50% 38%, black 0%, transparent 100%)',
	WebkitMaskImage: 'radial-gradient(ellipse 70% 55% at 50% 38%, black 0%, transparent 100%)',
}

export function Landing() {
	return (
		<div className="flex min-h-screen flex-col bg-canvas">
			<TopBar />
			<main className="flex-1">
				<Hero />
				<Guarantees />
				<HowItWorks />
				<ClosingBand />
			</main>
			<Footer />
		</div>
	)
}

function TopBar() {
	return (
		<header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
				<Link href="/" aria-label="attesta" className="flex min-w-0 items-center gap-2">
					<Wordmark size="sm" />
					<Tag tone="telemetry" mono className="hidden sm:inline-flex">
						TEE
					</Tag>
				</Link>
				<nav aria-label="Landing page" className="ml-auto flex shrink-0 items-center gap-1 sm:gap-4">
					<a
						href="#how-it-works"
						className="hidden h-8 items-center px-2 type-body-md text-fg-secondary transition-colors hover:text-fg sm:inline-flex"
					>
						How it works
					</a>
					<a
						href={DOCS_URL}
						target="_blank"
						rel="noreferrer"
						className="hidden h-8 items-center px-2 type-body-md text-fg-secondary transition-colors hover:text-fg sm:inline-flex"
					>
						Docs
					</a>
					<LinkButton
						href={SIGN_IN_HREF}
						variant="primary"
						trailingIcon={<ArrowRightIcon className="size-3.5" />}
					>
						Enter the marketplace
					</LinkButton>
				</nav>
			</div>
		</header>
	)
}

function Hero() {
	return (
		<section className="relative overflow-hidden border-b border-hairline">
			<div className="pointer-events-none absolute inset-0" style={GRID_FIELD} aria-hidden="true" />
			<div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 py-24 text-center sm:py-32">
				<h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-fg sm:text-5xl lg:text-[56px]">
					Performance you can verify instead of performance you&rsquo;re told about.
				</h1>
				<p className="mt-6 max-w-2xl text-pretty type-body-lg text-fg-secondary">
					Anyone can publish a trading strategy as code, which runs inside an attested hardware
					enclave. Every reported number traces back to the exact binary that produced it.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<LinkButton
						href={SIGN_IN_HREF}
						variant="primary"
						size="large"
						className="uppercase tracking-[0.06em]"
						trailingIcon={<ArrowRightIcon className="size-4" />}
					>
						Browse strategies
					</LinkButton>
					<LinkButton
						href={SIGN_IN_HREF}
						variant="secondary"
						size="large"
						className="uppercase tracking-[0.06em]"
					>
						Publish a strategy
					</LinkButton>
				</div>
				<EnclaveArtifact className="mt-10" />
			</div>
		</section>
	)
}

function Guarantees() {
	return (
		<Section id="trust" eyebrow="Cryptographic guarantees" title="Why you can trust the numbers">
			<div className="grid gap-4 md:grid-cols-3">
				{GUARANTEES.map((item) => (
					<article
						key={item.title}
						className="flex flex-col rounded-sm border border-hairline bg-surface-1 p-5"
					>
						<span className="flex size-8 items-center justify-center rounded-sm border border-hairline bg-surface-2 text-verified">
							{item.icon}
						</span>
						<h3 className="mt-5 type-headline-sm text-fg">{item.title}</h3>
						<p className="mt-2 type-body-md text-fg-secondary">{item.body}</p>
						<p className="mt-6 border-t border-hairline pt-3 type-label-caps text-fg-muted">
							{item.footnote}
						</p>
					</article>
				))}
			</div>
		</Section>
	)
}

function HowItWorks() {
	return (
		<Section id="how-it-works" eyebrow="Execution pipeline" title="How it works">
			<ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{STEPS.map((step) => (
					<li key={step.index} className="rounded-sm border border-hairline bg-surface-1 p-4">
						<div className="flex items-center justify-between gap-2">
							<span className="inline-flex h-5 items-center rounded-xs border border-verified/40 bg-verified/10 px-1.5 type-code-sm text-verified">
								{step.index}
							</span>
							<span className="type-label-caps text-fg-muted">{step.tag}</span>
						</div>
						<h3 className="mt-4 type-headline-sm text-fg">{step.title}</h3>
						<p className="mt-1.5 type-body-sm text-fg-secondary">{step.body}</p>
					</li>
				))}
			</ol>

			<div className="mt-4 overflow-x-auto rounded-sm border border-hairline bg-surface-1 px-4 py-3">
				<div className="flex w-max items-center gap-2">
					{CHAIN.map((link, index) => {
						const first = index === 0
						const last = index === CHAIN.length - 1
						return (
							<span key={link} className="flex items-center gap-2">
								{first ? null : (
									<ArrowRightIcon className="size-3.5 shrink-0 text-verified" aria-hidden="true" />
								)}
								{first || last ? (
									<span className={cn('type-code-md', last ? 'text-verified' : 'text-fg-secondary')}>
										{link}
									</span>
								) : (
									<span className="recessed inline-flex h-6 items-center rounded-xs px-2 type-code-md text-fg-secondary">
										{link}
									</span>
								)}
							</span>
						)
					})}
				</div>
			</div>
		</Section>
	)
}

function ClosingBand() {
	return (
		<section className="border-t border-hairline bg-surface-1">
			<div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-20 text-center">
				<h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-[28px]">
					Whether you&rsquo;re allocating capital or publishing strategy code.
				</h2>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<LinkButton
						href={SIGN_IN_HREF}
						variant="primary"
						size="large"
						className="uppercase tracking-[0.06em]"
						trailingIcon={<ArrowRightIcon className="size-4" />}
					>
						Browse strategies
					</LinkButton>
					<LinkButton
						href={SIGN_IN_HREF}
						variant="secondary"
						size="large"
						className="uppercase tracking-[0.06em]"
					>
						Publish a strategy
					</LinkButton>
				</div>
			</div>
		</section>
	)
}

function Footer() {
	return (
		<footer className="border-t border-hairline">
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center">
				<div className="flex min-w-0 items-center gap-3">
					<Wordmark size="sm" />
					<span className="type-code-sm text-fg-muted" aria-hidden="true">
						·
					</span>
					<span className="truncate type-code-sm text-fg-muted">
						&copy; {new Date().getFullYear()} attesta &middot; strategies run in AWS Nitro
						Enclaves, us-west-2
					</span>
				</div>
				<nav aria-label="Footer" className="flex items-center gap-5 sm:ml-auto">
					<FooterLink href={DOCS_URL} external>
						Docs
					</FooterLink>
					<FooterLink href={REPO_URL} external>
						GitHub
					</FooterLink>
					<FooterLink href="#how-it-works">Verification guide</FooterLink>
				</nav>
			</div>
		</footer>
	)
}

function FooterLink({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
	return (
		<a
			href={href}
			target={external ? '_blank' : undefined}
			rel={external ? 'noreferrer' : undefined}
			className="type-body-sm text-fg-secondary transition-colors hover:text-fg"
		>
			{children}
		</a>
	)
}

function Section({
	id,
	eyebrow,
	title,
	children,
}: {
	id: string
	eyebrow: string
	title: string
	children: ReactNode
}) {
	return (
		<section id={id} className="border-b border-hairline scroll-mt-14">
			<div className="mx-auto max-w-6xl px-6 py-20">
				<p className="type-label-caps text-verified">{eyebrow}</p>
				<h2 className="mt-3 mb-10 type-headline-xl text-fg">{title}</h2>
				{children}
			</div>
		</section>
	)
}
