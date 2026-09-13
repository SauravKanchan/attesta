# Reference designs

Generated in Stitch (project "Attesta Trading Strategy Marketplace") and used as the
visual reference for the frontend. They are references, not source — the shipped UI is
hand-written React.

| File | Screen | State |
|---|---|---|
| `01-landing.png` | Public landing page | Final |
| `02-marketplace.png` | Marketplace browse | Final, after corrections |
| `00-signin.png` | Sign in | Superseded — being replaced by Privy, do not invest in it |

Screens still to design: strategy detail (both the un-invested and invested variants),
portfolio, and create strategy. Their content requirements are written out in
[../ui-prompt.md](../ui-prompt.md); build from that spec plus the design system below.

## Design system — "Cryptographic Quantitative Terminal"

| Token | Value |
|---|---|
| Canvas / ground | `#090A0D` |
| Surface tier 1 (panels, tables, charts) | `#0E1117` |
| Surface tier 2 (nested cards, stat cards, modals) | `#141820` |
| Hover / interactive | `#1C222E` |
| Hairline border | `#27272A`, secondary `#3F3F46` |
| Primary / verified | `#10B981`, hover `#34D399`, active `#059669` |
| Telemetry cyan | `#0284C7`, light `#38BDF8` |
| Risk crimson | `#EF4444`, light `#F87171` |
| Warning amber | `#F59E0B`, light `#FCD34D` |
| Text | primary `#F8FAFC`, secondary `#94A3B8`, muted `#475569` |

Inter for UI text. JetBrains Mono for every number, currency figure, hash, ticker, code
block and table header, always with `font-feature-settings: "tnum" on, "zero" on`.

Type scale: headline-xl 32/600/-0.025em, headline-lg 24/600, headline-md 18/600,
headline-sm 15/600, body-lg 15/400, body-md 13/400, body-sm 12/400, code-lg 14/500,
code-md 12/500, code-sm 11/500, label-caps 10/600/0.08em uppercase mono,
metric-display 28/600/-0.03em mono, metric-lg 20/600 mono.

4px radii, 2px on chips and hash tags, never fully rounded except avatars. 1px hairline
borders everywhere; no drop shadows except modals
(`0 20px 40px -10px rgba(0,0,0,0.85)`). Table rows 32px, compact buttons 28px, standard
buttons 36px, 8px spacing grid with 4px micro-spacers.

## Factual constraints on UI copy

The design system's own style guide mentions Intel SGX. **It is wrong.** This product
runs on AWS Nitro Enclaves in `us-west-2` and nothing else. Never render "Intel SGX",
"MRENCLAVE", "zk-STARK", zero-knowledge proofs, quorum counts or attestation latency
figures anywhere in the UI — none of them exist here, and a demo that claims them is
making a false cryptographic claim.

Every performance figure must come from the API. Nothing about a strategy's returns is
written by hand — see [../build-plan.md](../build-plan.md#the-value-loop).
