# ETHGlobal submission

Event: **ETHOnline 2026**, track "Building from Scratch". Project created on the dashboard
as **attesta / DeFi / 🔏**.

This file is the source of truth for the submission copy — if the dashboard form loses
state, retype from here.

## Status

| Tab | State |
|---|---|
| Project details | Name, category, emoji, demo link, short description, description, how it's made — all typed. **Not saved**: the form refuses to save until a GitHub repo is selected. |
| Images | Not started — needs screenshots |
| Tech stack | Not started |
| Select prizes | Not started — **Chainlink and Privy only**. Circle is not built; see below. |
| Video | Not started — needs a 2–4 min, 720p+, clear-audio recording |
| Future | Not started |
| Final | Blocked on the above |

**Blocking:** no GitHub account is linked to the ETHGlobal profile (the repo dropdown offers
only "Add GitHub Account"), and `github.com/SauravKanchan/attesta` returns 404 because it is
private. Link the account, make the repo public, then the details tab can save.

---

## Project name

```
attesta
```

## Tagline / short description

```
A marketplace for automated trading strategies whose track record is attested rather than
claimed. Strategies run as Chainlink CRE Confidential Workflows inside a TEE, so every
reported return is cryptographically bound to the exact code that produced it.
```

---

## Description — what it does

```
Anyone can claim 40% APY. Copy-trading desks, signal groups and DeFi vaults all ask you to
trust a number published by the same party that controls it. And the strategies with a real
edge won't show you their code, because publishing the parameters destroys the edge. You get
a choice between unverifiable claims and nothing at all.

attesta removes the choice.

A creator writes a trading strategy in TypeScript and uploads it. The platform compiles it
and registers it on-chain as a Chainlink CRE Confidential Workflow. From then on the
strategy runs inside a hardware-isolated TEE — an AWS Nitro enclave — and every trade and
performance figure it produces leaves that enclave signed.

The registered workflow's hash is its identity. A creator cannot build a track record on a
profitable script and quietly swap in another one; the hash would change. The platform
cannot inflate returns or alter allocations, because it does not sign the performance
record — the enclave does. An investor trusts the numbers without trusting either party.

The second half is privacy. The enclave keeps the strategy's *parameters* secret while
still proving they were applied. A creator publishes their source and their thresholds stay
private: the code is open, the tuning is not. Parameters are encrypted in the creator's own
browser to the Chainlink Vault DON's threshold key before they ever reach us, and there is
no read-back API — holding our own keys does not recover them.

For the investor it looks like a passive fund. Sign in with Privy — social login, no seed
phrase, an embedded wallet created for you. Browse strategies, read how each one works,
check its returns, APY and drawdown. Allocate USDC, watch the position move, withdraw. Each
strategy's capital sits in its own vault with ERC4626 share accounting, settled by the
strategy's own operator account. The vault's arithmetic is what bounds that operator: it
can apply a profit or loss and record a trade, but it cannot withdraw an investor's
capital. That is a property of the contract rather than a promise.

What makes it more than a dashboard is that nothing on the page is written down anywhere.
Return is not a field. It is derived from the vault's own settlement log on chain — every
`PnlApplied` event is a NAV observation dated by its block — and those settlements came
from pricing the strategy's own weight decisions against a deterministic price series. A
strategy that picks badly shows a negative return because it lost money, not because a
fixture says -8.4.

Annualised APY is reported as unavailable until there is enough history to annualise
honestly. Compounding a twenty-minute observation over a year is an artefact, not a
projection, so the card leads with return since inception instead — a fact at any span.

We are also explicit about the limits, because a verifiability claim is only worth what its
weakest link is. Settlement is the weakest: a strategy's operator key is platform-held
rather than born inside the enclave, so the attestation covers what was decided far better
than it covers who could move money. The vault contract bounds the damage rather than the
attestation doing it. Vault secrets are scoped to the platform owner rather than to a
single workflow, so isolation between creators rests on every deployed workflow being
enumerable and hash-checkable rather than on the Vault enforcing it. Phase 1 does not audit
strategy code — "verified" means "this exact code produced these results", not "this code is
safe". Spending policies bound the damage; they do not establish that a strategy is sound.
```

---

## How it's made

```
Five layers, each doing one job.

CONTRACTS — Foundry, deployed to a local anvil chain.
MockUSDC is a 6-decimal ERC20 with an open faucet. StrategyVault is one per strategy with
ERC4626 share math: deposit, withdraw, and applyPnl(int256) which is how a tick's result
lands on-chain. Gains draw from a prefunded reserve into managed assets, losses return to
it, and the invariant usdc.balanceOf(vault) >= totalManagedAssets means the vault never
promises value it cannot pay. StrategyRegistry anchors keccak256(strategyId) to the vault
address and the workflow binary hash, so the measurement has a public home.

The vault's revert surface is the part that took the longest and none of it is visible in
the ABI: a gain with no depositors reverts NoSharesOutstanding (a gain with no owner would
be redeemable in full by whoever deposits next); a gain larger than the buffer reverts
ReserveExhausted; a loss larger than the book reverts LossExceedsManagedAssets. The
scheduler caps and skips accordingly, so a strategy nobody has funded is visibly running
rather than silently absent.

CHAINLINK CRE — the compute layer.
A strategy is a TypeScript workflow with a confidential handler declaring which TEE types
and regions it accepts. When the trigger fires, the Workflow DON hands execution to an
enclave instead of running the callback on the node. Inside the enclave the workflow makes a
real HTTP call out to our price oracle through CRE's confidential HTTP client, runs the
strategy's onTick(), and returns target weights. Strategy parameters come from Vault DON
secrets, fetched inside the enclave, never present on a node.

BACKEND — Fastify, Drizzle, better-sqlite3, viem.
A scheduler runs one tick loop per live strategy. Each tick refreshes a seeded,
deterministic price walk, runs cre workflow simulate for that strategy, parses the decision,
prices the weights against the delta since the last tick, sends applyPnl and recordTrade
from the strategy's operator wallet, snapshots NAV and writes an execution row. Because the
walk is seeded, a simulation is reproducible — which is what makes the attested-decision
story coherent rather than decorative.

Submissions pass a nine-stage sanity pipeline before they can publish: parses, required
exports, forbidden imports, no side effects, typechecks against the strategy contract,
describe() returns valid metadata, onTick() is deterministic across two identical
invocations, cre workflow build succeeds and yields a binary hash, cre workflow simulate
succeeds and yields a parseable decision. Only after all nine may a strategy go live.

FRONTEND — Next.js 15 App Router, React 19, Tailwind v4, CodeMirror 6, Recharts, viem.
Creators write strategies in an in-browser editor. Investors get charts driven entirely by
NAV series the scheduler produced.

PRIVY — the investor-facing surface.
Investors are humans who need consumer onboarding: social login, recovery, no key
management. A strategy is an autonomous agent settling its own vault, which needs a
programmatic account rather than a consumer one. Different actors, different trust models,
so deliberately two wallet systems rather than one — though only the investor half is
integrated today.

--- The parts worth calling out ---

The server never accepts a private key. Sign-in is a challenge/verify exchange: the browser
asks for a nonce, signs the SIWE-style message the server built, and the server recovers the
address with recoverMessageAddress and issues a session. Nonces are single-use with a
five-minute TTL. This shape was chosen specifically so that swapping a pasted dev key for
Privy's embedded wallet replaces one function — where the browser's signer comes from — and
leaves the protocol untouched. Investing and withdrawing are signed in the browser too, and
the backend records what the chain says happened rather than what the client claims: it
fetches the receipt, parses the Deposited event, and checks it came from the caller's
address and targets this strategy's vault. A forged or replayed hash records nothing.

Creator secrets are encrypted in the browser before they leave it, and getting that working
against CRE meant two fixes. Chainlink's own JS TDH2 implementation exports an encrypt()
that hardcodes an empty label, but CRE requires the label to be the owner address
left-padded to 32 bytes — so we vendored tdh2.js and passed the correct label to the
internal tdh2Encrypt. And the CRE gateway returns no Access-Control-Allow-Origin header and
fails its OPTIONS preflight, so a browser cannot reach it directly and the backend relays
the ciphertext. Locally the cipher is a dev scheme, swapped at a single seam
(EncryptedSecret.scheme) — and the create screen says so on the page rather than glossing
it, because under the dev scheme the key never leaves the browser, which reproduces the
platform's ignorance of the plaintext but not the enclave's access to it.

Contract addresses are never in env. GET /api/chain/config is authoritative for chain id,
RPC URL and every address, because anvil redeploys move them and a stale .env pointing at a
dead address fails in a way that looks like a bug in the contract.

One honest note on CRE. Simulation passes end to end and the workflow is deployed to the
private registry on zone-a, but live confidential execution currently fails on Chainlink's
side with "cannot validate enclave config: DON members not set" plus a Vault relay quorum
failure. It is a platform-wide regression rather than anything in this repo — a plain
non-TEE workflow from the same owner on the same DON executes fine, and other teams in
#partner-chainlink reported the identical error appearing at 02:10 UTC on 13 Sep with no
change on their side, including a team whose production confidential workflow had been
running successfully until then. Evidence here is CRE CLI simulation.
```

---

## Links

| Field | Value |
|---|---|
| Source code | `https://github.com/SauravKanchan/attesta` **[NEEDS YOU — confirm the repo is public]** |
| Demo video | **[NEEDS YOU]** |
| Live demo | Runs locally via `./scripts/dev.sh` — **[NEEDS YOU: deploying anywhere?]** |

## Prize tracks

Submit to **two** tracks. Both are backed by working code.

- **Chainlink** — CRE Confidential Workflows. Evidence: real `cre workflow build` and
  `cre workflow simulate` runs reading a Vault DON secret inside the enclave and returning
  a signed decision, a deployed workflow on `zone-a`, and the nine-stage build/simulate
  pipeline every submitted strategy passes before it can be listed.
- **Privy** — embedded wallets, social login, the whole investor-facing surface.

**Do not enter the Circle track.** Agent Wallets on Arc shaped the settlement design and
none of it is built — a strategy's operator is an ordinary account and the vault contract
is what bounds it. A track entered with no implementation behind it reads worse to a judge
than not entering, and claiming a live integration that does not exist is a
disqualification risk. See [prizes.md](prizes.md), which marks that layer NOT IMPLEMENTED.

**[NEEDS YOU — confirm both are sponsors at this event and which tracks are open]**

## Team

**[NEEDS YOU — names / ETHGlobal usernames]**

## Screenshots

`docs/screenshots/login-signature-auth.png` exists. Still needed: marketplace list,
strategy detail with the NAV chart, the create/upload screen, portfolio.
