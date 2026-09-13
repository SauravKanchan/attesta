# ETHGlobal submission assets

Everything the submission form asks for, in the order its slots appear. One logo, one
cover, six screenshots — the form takes a minimum of three and a maximum of six, and all
six here are load-bearing rather than padding.

Every frame is a real run of the stack against a local anvil chain (`31337`): three
strategies published through the actual pipeline, a funded investor holding three
positions, and NAV series derived from the vaults' own `PnlApplied` logs. Nothing on
screen is a mock-up, and no figure was edited.

## The files

| Slot | File | Pixels | What it shows |
|---|---|---|---|
| Logo | `logo.png` | 512×512 | The mark. Unchanged — not regenerated here. |
| Cover | `cover.png` | 1920×1080 (16:9) | The marketplace grid, composed to read at thumbnail size: three live strategies, each with its attested return, sparkline, AUM, drawdown, investor count, Nitro-enclave badge and binary hash. |
| 1 | `01-marketplace.png` | 3200×2000 (1600×1000 @2x) | The browse grid with filters and sort. One strategy up, two down — the "ETH Overtrader" control strategy is down by design: maximum turnover, no signal, and the trading costs to match. |
| 2 | `02-strategy-detail.png` | 3200×3930 (full page) | ETH Mean Reversion with a $2,500 position held: position tiles, the curve every tick wrote, the trades the vault settled, and the verification card — workflow id, binary hash, config hash, AWS Nitro in us-west-2. |
| 3 | `03-create-checks.png` | 3200×2000 | Create flow, step 3. The nine pre-flight checks all passed and the simulation console showing a real `cre workflow build` and `cre workflow simulate`, including the decision line the enclave would sign. |
| 4 | `04-create-editor.png` | 3200×2000 | Create flow, step 1. The TypeScript editor with a real strategy in it and the required-exports checklist validating the interface as you type. |
| 5 | `05-portfolio.png` | 3200×2000 (full page) | The investor portfolio: total value, invested, all-time P&L, the value curve, and three positions with per-strategy P&L and withdrawal. |
| 6 | `06-secrets.png` | 3200×2000 | Create flow, step 2. Strategy parameters encrypted in the creator's browser — the key name and the ciphertext are all the platform ever receives. |

`00-cover.png` in this directory was produced by a different session and is not part of
this set. Its cards read `AWAITING ATTESTATION` where `cover.png` reads
`NITRO ENCLAVE VERIFIED`; prefer `cover.png`.

## Suggested captions

Paste one per screenshot slot.

**Cover** — Every listed strategy, its attested track record, and the binary hash anyone
can recompute.

**01 · Marketplace** — Three strategies running as Chainlink CRE confidential workflows
inside AWS Nitro enclaves. Return since inception, drawdown and AUM are derived from the
vault's own settlement log, not reported by the creator.

**02 · Strategy detail** — One strategy, end to end: the investor's position, the NAV
curve each enclave run produced, the trades that settled on chain, and the verification
chain — workflow id, binary hash, config hash — that ties every figure above to the
measured binary.

**03 · Pre-flight checks** — Publishing runs nine checks in order. The last two are a real
`cre workflow build` and `cre workflow simulate`; the binary hash the build produces
becomes the strategy's on-chain identity, so a creator cannot swap the code behind a track
record.

**04 · Write the strategy** — A strategy is a TypeScript CRE workflow. The required-exports
checklist validates the interface as you type, which is what lets the marketplace read an
investor's balance and settle a withdrawal against the creator's own code.

**05 · Portfolio** — Allocations valued at the latest attested NAV, with per-strategy P&L
and one-click withdrawal. Every deposit and withdrawal is signed in the browser; the
backend only ever sees a transaction hash.

**06 · Private parameters** — Thresholds are encrypted in the creator's browser before they
leave the page. attesta stores the key name and the ciphertext and holds no key that opens
it — in production the same field carries TDH2 ciphertext that only a threshold of
Chainlink Vault DON nodes can open, inside an attested enclave.

## Known weaknesses in these frames

Stated so nobody is surprised by them in a demo.

- **APY reads `—`.** Annualising twenty minutes of NAV history is an artefact, not a
  projection, so APY is null until the series spans six hours (commit `c90e58d`). Cards
  lead with return since inception instead; the detail page's APY tile and the portfolio
  table's APY column therefore show a dash with the reason under it. Every other figure on
  those screens is real.
- **The portfolio value chart looks flat.** Its y-axis runs from 4,000 while the portfolio
  sits near 7,500, so a −5.8% move draws as a nearly straight line. The data is right; the
  domain is too generous for the range the series actually covers.
- **The marketplace still says "Sorted by APY"** while every card shows return since
  inception, because no strategy has six hours of history yet.
- **A green card can carry a red sparkline.** The sparkline is the last 32 NAV points, so a
  strategy up since inception can be down across that window — which is what ETH Mean
  Reversion shows on the cover and on 01.
- **Two of the three strategies are down.** ETH Overtrader is the control and is meant to
  lose; ETH Momentum is down on fee drag over a short window. Only ETH Mean Reversion is
  green, and only just. More history would make the contrast less marginal.
- **The figures move between frames if they are re-shot separately.** The set here was
  captured in one pass, so 01, 02, 05 and the cover agree with each other.

## Regenerating

Stack: backend on `:4190` with `DATABASE_URL=./data/shots.db`, frontend production build
on `:3190` with `NEXT_PUBLIC_API_URL=http://localhost:4190`, anvil on `:8545`. A dev server
is not usable for this — the Next.js dev badge lands in the frame.

Every capture runs through one `shoot()` helper that, before the shutter: waits for
`networkidle` and `document.fonts.ready`, injects a stylesheet hiding the Next.js overlay
selectors and then asserts none are present, waits until no `[data-loading]`,
`[aria-busy]`, `.animate-pulse` or skeleton element is visible, polls the rendered SVG
geometry until the Recharts mount animation stops changing it, blurs the active element
and parks the mouse in a corner, hides scrollbars, and asserts no `NaN`, `undefined`,
`null` or empty figure is on screen.

Create-flow frames are viewport captures rather than full-page ones: a full-page capture of
`/create` paints its sticky footer through the middle of the layout. `03` is captured at a
page zoom of 0.72 so the nine rows and the simulator's own output are in one frame.

One caveat for whoever reshoots `03`: `POST /api/submissions/:id/check` calls
`reply.hijack()` and writes its own headers, so the ndjson stream carries no
`access-control-allow-origin` and the browser drops it. The capture browser is launched
with web security off to get round it. Fixing the route would remove the need — and would
also fix the create flow in any real cross-origin browser, which is every configuration
this repo ships, `:3000` → `:4000` included.
