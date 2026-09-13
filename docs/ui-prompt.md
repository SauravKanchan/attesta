# Stitch prompt

Paste **Part A** as the first message to set the design system. Then paste each screen
prompt from **Part B** one at a time, each ending with "Use the exact design system
defined earlier." Regenerate individual screens as needed; keep Part A in the thread so
the system stays consistent.

---

## Part A — design system (paste first)

I'm designing **attesta**, a web app marketplace for verifiable automated trading
strategies. Anyone can publish a trading strategy as code; the code runs inside a secure
hardware enclave (TEE), so its performance record is cryptographically provable rather
than self-reported. Investors browse strategies and allocate USDC to the ones they like.
Two audiences share the same app: **investors** (browse, allocate, track) and **creators**
(write and publish strategy code).

Design a desktop-first responsive web app. Set up the design system now; I'll ask for
individual screens next.

**Visual direction**
Dark, precise, high-signal fintech — closer to a professional trading terminal than a
consumer crypto app. Calm and data-dense, not playful. No gradients on surfaces, no glass
morphism, no drop shadows except a subtle one on modals and dropdowns. Flat surfaces
separated by 1px borders. Generous whitespace inside cards, tight vertical rhythm between
rows.

**Color tokens**
- Page background `#0B0C0E`
- Card / surface `#131518`
- Elevated surface (modal, dropdown, popover) `#1A1D21`
- Border `#24282E`, hover border `#333941`
- Text primary `#E8EAED`, secondary `#9BA1A9`, muted `#6B7280`
- Positive / verified `#3DDC97`
- Negative `#FF5D5D`
- Interactive accent (buttons, links, focus rings, active nav) `#6C8CFF`
- Warning / pending `#F0B429`

**Typography**
- UI text: Inter. Page title 24px/600, section heading 16px/600, body 14px/400, label and
  caption 12px/500 uppercase with 0.04em letter-spacing.
- All numbers, percentages, currency, code, and hashes: JetBrains Mono with tabular
  figures. Big metric numbers 32px/500.

**Components**
- 8px spacing grid. Card radius 10px, button and input radius 8px, pill radius 999px.
- Buttons: primary is solid `#6C8CFF` with white text; secondary is transparent with a
  `#24282E` border; destructive is transparent with a `#FF5D5D` border and red text.
  Height 36px, 14px/500 label.
- Inputs: `#0B0C0E` fill, `#24282E` border, 36px high, focus ring `#6C8CFF` at 40% opacity.
- Status pills, 12px, uppercase: **Live** green, **Simulating** amber with a small
  spinner, **Draft** grey, **Failed** red.
- A recurring **verification badge**: a small shield-check icon in `#3DDC97` with the
  label "TEE-verified", followed by a truncated monospace hash like `cc28c202…1bc8bc62`
  in `#6B7280`. On hover it shows a tooltip "This strategy's code is hash-locked and runs
  inside an attested enclave."
- Percentage changes are always colored — green for positive with a `+`, red for negative
  — and always monospace.

**App shell**
- Fixed 240px left sidebar on `#0B0C0E` with a 1px right border: the wordmark "attesta"
  at the top in 18px/600 with a small shield glyph, then nav items with 16px icons —
  **Marketplace**, **Portfolio**, **Create strategy**. Active item has a `#131518` fill
  and a 2px `#6C8CFF` left bar.
- Bottom of the sidebar: the signed-in user as an avatar circle with their initial, their
  username, and a small "Sign out" link.
- Main area is a max 1240px centered column with 32px padding.
- On mobile the sidebar collapses to a bottom tab bar with the same three destinations.

**Empty and loading states**
Every list and chart needs a designed empty state: a thin-stroke line icon, one line of
16px `#9BA1A9` text, and where useful a single primary button. Loading states are
skeleton blocks in `#1A1D21`, never spinners, except inside buttons.

---

## Part B — screens (paste one at a time)

### 1. Sign in

Design the sign-in screen for attesta. A single centered card, 400px wide, on the page
background. Inside: the attesta wordmark with its shield glyph, a heading "Sign in", one
line of secondary text "Pick a username to continue. Wallet sign-in is coming soon.", a
single text input labeled "Username" with the placeholder "satoshi", and a full-width
primary button "Continue". Below the button, 12px muted text: "No password, no wallet —
this is a preview build." Show the input's error state as a variant: a red border with
the message "That username is taken" beneath it. Nothing else on the screen — no sidebar.
Use the exact design system defined earlier.

### 2. Marketplace

Design the Marketplace screen — the main browse view, inside the app shell with the
sidebar.

Top of the page: the title "Marketplace" with the subtitle "Every strategy here is
hash-locked and runs inside a verified enclave."

A sticky filter bar directly under it, on the card surface with a 1px border, containing
in one row:
- A wide search input with a magnifier icon, placeholder "Search strategies by name,
  creator, or ticker…" — designed as a fuzzy search, so show a variant of the dropdown
  results where the matched letters inside each result are highlighted in `#6C8CFF` even
  when they're non-contiguous.
- A multi-select "Strategy type" dropdown with checkbox options: Momentum, Mean
  reversion, Arbitrage, Market making, Trend following, Volatility, Yield.
- A "Risk" segmented control: All / Low / Medium / High.
- A "Sort by" dropdown: APY, Total return, AUM, Newest, Investors.
- On the right, a ghost "Clear filters" button.

Under the bar, show the active filters as removable pills with an × on each, plus the
result count in muted text: "24 strategies".

Then a responsive grid of strategy cards, 3 per row on desktop, 2 on tablet, 1 on mobile.
Each card contains:
- A row with the strategy name in 16px/600, and on the right a status pill.
- The creator on the next line as a small avatar circle plus `@username` in 12px muted.
- Two or three type tags as small outlined pills, e.g. "Momentum", "Perps".
- A large APY figure — "18.4%" in 32px monospace green — with the label "APY (30D)" in
  12px uppercase muted underneath.
- A 60px-tall sparkline area chart of the strategy's performance, green line with a faint
  green fill, no axes.
- A three-column metrics row separated by 1px dividers: AUM "$1.24M", Max drawdown
  "-6.2%" in red, Investors "312".
- At the bottom, the TEE-verified badge with the truncated hash.
- The whole card lifts its border to `#333941` on hover.

Include one card in the grid showing a negative APY so I can see the red treatment, and
include the empty state variant: "No strategies match those filters."

Use the exact design system defined earlier.

### 3. Strategy detail — not yet invested

Design the strategy detail page for a visitor who has **not** invested in it yet.

A back link "← Marketplace" at the top. Then a header block: the strategy name in 24px/600
with a Live pill beside it, the creator row with avatar and `@username` and a "Follow"
ghost button, the type tags, and on the far right of the header a primary button "Invest
USDC" plus the TEE-verified badge underneath it.

Below the header, a row of four metric tiles on the card surface: **APY (30D)** 18.4%
green, **Total return** +42.1% green, **Max drawdown** -6.2% red, **AUM** $1.24M. Each
tile is the big monospace number over a 12px uppercase muted label.

Then a large performance chart card, roughly 360px tall, titled "Strategy performance"
with a right-aligned time-range segmented control: 24H / 7D / 30D / 90D / ALL. The chart
is a green area line with a faint fill, a subtle dotted horizontal gridline set, monospace
axis labels, and a hover tooltip showing a date and a value.

Below the chart, a two-column layout. The wide left column has:
- An "About this strategy" card with three or four paragraphs of body text describing the
  approach, plus a "Read more" toggle.
- A "Verification" card: a small vertical stepper with green check marks reading "Source
  published", "Binary hash matches", "Running in AWS Nitro enclave, us-west-2", "Reports
  signed inside the enclave". Under it, two monospace rows labeled "Workflow ID" and
  "Binary hash" with full hashes truncated in the middle and a copy icon on each, and a
  ghost button "View source".
- A "Recent trades" table with the columns Time, Pair, Side (a green BUY or red SELL
  pill), Size, Price, PnL. Six rows, monospace figures, zebra-free with 1px row dividers.

The narrower right column is a sticky "Invest" card: the label "Amount", an input with a
"USDC" suffix and "Balance: 2,500.00 USDC · Max" above it, quick-amount pills 25% / 50% /
75% / Max, a summary block of label-value rows (Est. fee, You'll receive, Lock-up "None"),
and a full-width primary "Invest USDC" button. Beneath it, 12px muted text: "Funds move to
this strategy's policy-capped Agent Wallet. You can withdraw anytime."

Use the exact design system defined earlier.

### 4. Strategy detail — invested

Design a variant of the strategy detail page for an investor who **already holds a
position** in this strategy.

Everything from the previous screen stays, with these changes:
- Insert a "Your position" card directly under the header metric tiles, spanning full
  width and visually distinguished by a 1px `#6C8CFF` border at 40% opacity. It contains
  four metrics in a row — **Invested** $5,000.00, **Current value** $5,842.30, **Unrealised
  PnL** +$842.30 green with "+16.8%" beside it, **First allocated** "12 Aug 2026" — and on
  the right two buttons side by side: primary "Add funds" and secondary "Withdraw".
- Add a toggle above the main chart with two options, "Your value" and "Strategy", with
  "Your value" selected. In this state the chart plots **the investor's own money over
  time** in `#6C8CFF` with a faint blue fill, starting at their first deposit rather than
  at strategy inception. Show small circular markers on the line where deposits and
  withdrawals happened, with a tooltip on one reading "+$2,000.00 deposit · 3 Sep 2026".
  Add a dashed horizontal reference line at the cost basis labeled "Cost basis $5,000.00"
  in muted monospace.
- Replace the right-hand Invest card with a "Manage position" card holding the same
  amount input but with a Deposit / Withdraw segmented control at the top, and a
  full-width primary button whose label follows the selected tab.

Use the exact design system defined earlier.

### 5. Portfolio

Design the Portfolio page — the signed-in user's own holdings.

Page title "Portfolio" with the subtitle "@satoshi". Under it a summary band of four large
metric tiles: **Total value** $18,420.55, **Total invested** $16,000.00, **All-time PnL**
+$2,420.55 green with "+15.1%" beneath, **Available USDC** $2,500.00 with a small ghost
"Add funds" button inside the tile.

Then a full-width portfolio chart card, about 320px tall, titled "Portfolio value" with
the 24H / 7D / 30D / 90D / ALL range control, plotted in `#6C8CFF` with a faint fill.

Then two tabs: **Investments** and **My strategies**.

The Investments tab shows the holdings as a table with the columns Strategy (name in
primary text over `@creator` in muted, with a small type tag), Allocated, Current value,
PnL (dollar amount over a colored percentage), APY, Allocation (a thin horizontal
proportion bar with a percentage), and a right-aligned actions cell with a ghost "Withdraw"
button and a "⋯" overflow menu. Five rows. Include one row in loss so I can see the red
treatment.

The My strategies tab shows strategies this user has **created**, as a table with the
columns Strategy, Status (a Live / Simulating / Draft pill), Investors, AUM, APY, Fees
earned, and a "Manage" ghost button. Include one Simulating row and one Draft row. Add the
empty state for this tab: "You haven't published a strategy yet." with a primary button
"Create strategy".

Also design a **Withdraw modal** on the elevated surface: title "Withdraw from Momentum
Alpha", the position value shown as a label-value row, an amount input with Max, a summary
of label-value rows (You'll receive, Est. network fee, Arrives in), a secondary "Cancel"
and a primary "Withdraw USDC" button.

Use the exact design system defined earlier.

### 6. Create strategy

Design the "Create strategy" flow as a single page with a three-step progress header:
**1 Code → 2 Private parameters → 3 Review & publish**, with completed steps in green,
the current step in `#6C8CFF`, and upcoming steps muted.

Show **step 1, Code**, as the main state:
- Two large selectable option cards at the top: "Write in the browser" (selected, with a
  code-brackets icon) and "Upload a .ts file" (a drag-and-drop target with an upload icon
  and the caption "Drop your strategy.ts here, or browse").
- Below that, a full-width code editor panel about 460px tall: a dark `#0B0C0E` gutter with
  muted monospace line numbers, syntax-highlighted TypeScript, a tab bar at the top of the
  panel showing `strategy.ts`, and a small toolbar on the right of the tab bar with
  "Reset to template" and "Format" ghost buttons.
- Anchored to the right of the editor, a narrow 280px "Required exports" checklist card
  listing monospace entries — `describe()`, `onTick()`, `balanceOf(investor)`,
  `totalAssets()`, `onDeposit()`, `onWithdraw()` — each with a green check when present or
  a muted circle when missing, and one shown in the missing state with a red 12px hint
  "Not exported yet". Under the checklist, a muted paragraph: "Every strategy implements
  the same interface so the marketplace can read balances and process withdrawals."
- A fields row above the editor for the listing metadata: "Strategy name", "Strategy type"
  (the same multi-select as the marketplace), "Risk level" segmented control, and a
  "Description" textarea with a character counter.
- A footer bar pinned to the bottom of the content with a ghost "Save draft" on the left
  and a primary "Continue" on the right.

Then design **step 2, Private parameters**, as a second screen state:
- A prominent info banner on `#131518` with a `#3DDC97` lock icon: "These values are
  encrypted in your browser before they're sent. attesta relays ciphertext and cannot read
  them — only the enclave running your strategy can."
- A repeatable key-value row list: a "Key" input (monospace, placeholder `API_TOKEN`), a
  "Value" input masked as password dots with an eye toggle, and a trash icon to remove the
  row. Three rows plus a ghost "+ Add parameter" button.
- A small card beneath: "How your strategy reads these" with a monospace snippet
  `runtime.getSecret({ id: 'API_TOKEN' })`.
- Same footer bar, with "Back" and "Continue".

Then design **step 3, Review & publish**:
- A "Pre-flight checks" card with a vertical checklist: "TypeScript compiles" green check,
  "Required exports present" green check, "No forbidden imports" green check, "Simulation
  run" amber with a spinner and the caption "Running…". One item shown in the failed state
  — red ×, "Simulation run", with a red-tinted expandable detail row containing monospace
  error text.
- A "Simulation output" console panel: `#0B0C0E`, monospace 12px log lines with muted
  timestamps, one line highlighted green reading `USER LOG: verdict=APPROVE`, and a
  copy-log icon in the corner.
- A "Listing preview" card that renders the marketplace card exactly as it will appear.
- A "Workflow identity" card with monospace label-value rows for Binary hash and Config
  hash, and the muted note "This hash becomes your strategy's permanent identity. Changing
  the code publishes a new strategy."
- The footer bar with "Back" and a primary "Publish to marketplace" button, shown once in
  its disabled state with the tooltip "Waiting for simulation to pass."

Use the exact design system defined earlier.
