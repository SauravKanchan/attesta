# Stitch prompt

Paste the brief first, then each screen one at a time in the same thread. Only content and
behaviour are specified — layout, colour, type and component styling are left to Stitch.

---

## Brief (paste first)

I'm designing **attesta**, a web app marketplace for verifiable automated trading
strategies. Anyone can publish a trading strategy as code; the code runs inside a secure
hardware enclave, so its performance record is cryptographically provable rather than
self-reported. Investors browse strategies and allocate USDC to the ones they like.

Two audiences share the app: **investors**, who browse, allocate and track returns, and
**creators**, who write and publish strategy code. It should feel like a serious financial
product — data-dense and trustworthy, not a playful consumer crypto app.

Navigation has three destinations: Marketplace, Portfolio, Create strategy. The signed-in
user is identified by a username only.

One motif recurs throughout and matters more than anything else on screen: a
**verification badge** shown on every strategy, marking it as running inside an attested
enclave with its code hash-locked. It should read as the app's core promise.

Design it desktop-first and responsive. I'll ask for individual screens next — pick the
visual language yourself and keep it consistent across all of them.

---

## Screens (one per message)

### 1. Sign in

The sign-in screen. The user picks a username and continues — no password, no wallet, no
sign-up flow separate from sign-in. Note somewhere that wallet sign-in is coming soon.
Include the taken-username error state.

### 2. Marketplace

The main browse screen: a grid of strategy cards with search and filtering above it.

Search is fuzzy and matches strategy name, creator or ticker — show the results dropdown
with the matched letters highlighted inside each result, including non-contiguous matches.
Filters are strategy type (multi-select: momentum, mean reversion, arbitrage, market
making, trend following, volatility, yield), risk level, and a sort control (APY, total
return, AUM, newest, investors). Active filters are removable, with a result count.

Each strategy card shows: name, creator, its type tags, a live/simulating/draft status, a
prominent APY, a small performance sparkline, and secondary metrics for AUM, max drawdown
and investor count — plus the verification badge with a truncated code hash.

Include one card with a negative APY, and the no-results empty state.

### 3. Strategy detail — not yet invested

The page an investor sees before allocating. It carries the strategy's identity and
description, its verified performance, and the action to invest.

It needs: name, creator, type tags and status; headline metrics for APY, total return, max
drawdown and AUM; a large performance chart with selectable time ranges; a written
description of how the strategy works; a recent trades table; and an invest panel with an
amount input, the user's USDC balance, quick-amount shortcuts, a fee and receive summary,
and the invest action.

It also needs a verification section — the strongest part of the page. It shows the chain
of proof as a short checklist (source published, binary hash matches, running in an
attested enclave, reports signed inside the enclave), the copyable workflow and binary
hashes, and a link to view the source.

### 4. Strategy detail — invested

A variant of the same page for someone who already holds a position.

Add a position summary: amount invested, current value, unrealised profit or loss in both
dollars and percent, and when they first allocated.

The main chart gains a toggle between the strategy's performance and **the investor's own
money over time** — the second is the default here, starts at their first deposit rather
than strategy inception, marks deposits and withdrawals along the line, and shows their
cost basis as a reference line.

The invest panel becomes a manage-position panel that switches between depositing more and
withdrawing.

### 5. Portfolio

The signed-in user's own page, with two tabs.

Above the tabs: total portfolio value, total invested, all-time profit or loss, and
available USDC with a way to add funds — plus a chart of portfolio value over time with
selectable ranges.

The **Investments** tab lists strategies they hold: strategy and creator, amount
allocated, current value, profit or loss, APY, what share of their portfolio it represents,
and a withdraw action per row. Include one position in loss.

The **My strategies** tab lists strategies they have *created*: name, status
(live/simulating/draft), investor count, AUM, APY, fees earned, and a manage action.
Include its empty state, pointing at creating a strategy.

Also design the withdraw modal: how much of the position to take out, what they'll
receive, estimated fee and arrival time.

### 6. Create strategy

A three-step flow: write the code, add private parameters, then review and publish.

**Step 1 — Code.** The creator either writes TypeScript in an in-browser editor or uploads
a `.ts` file; both paths are equally prominent. The editor starts from a template that can
be reset. Alongside it, a live checklist of the interface every strategy must implement —
`describe()`, `onTick()`, `balanceOf(investor)`, `totalAssets()`, `onDeposit()`,
`onWithdraw()` — ticking off as each export appears, with one shown still missing. Explain
that the shared interface is what lets the marketplace read balances and process
withdrawals. The listing metadata is captured here too: name, type, risk level and
description.

**Step 2 — Private parameters.** A list of key-value secrets the strategy reads at
runtime, with values masked. The critical message, stated prominently: these are encrypted
in the creator's own browser, attesta only ever relays the ciphertext and cannot read them,
and only the enclave running the strategy can decrypt them. Show how the strategy reads one
back in code.

**Step 3 — Review and publish.** Pre-flight checks run as a checklist — compiles, required
exports present, no forbidden imports, simulation run — with one check passing, one still
running, and one shown failed with its expandable error detail. Below it, the simulation's
console output with one line standing out as the strategy's own verdict. Then a preview of
how the listing will appear in the marketplace, and the workflow's binary and config
hashes, noted as the strategy's permanent identity — changing the code publishes a new
strategy. Publishing is blocked until simulation passes.
