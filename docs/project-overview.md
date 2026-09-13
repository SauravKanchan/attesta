# Project Overview

A TEE-powered marketplace for verifiable automated trading strategies.

Strategy creators upload trading scripts — written in TypeScript and deployed as
Chainlink CRE workflows — together with a description of how the strategy works. The
platform runs each strategy inside a Trusted Execution Environment (TEE), which executes
it in an isolated, tamper-resistant environment and lets it trade through an assigned
wallet.

Investors browse these strategies, review their descriptions and verified performance
metrics (returns, APY, drawdown), then allocate funds to the strategies they prefer —
similar to investing in passive funds, but with transparent, programmatic trading logic.

## Why a TEE

The TEE is what makes execution and performance **verifiable**. It proves that the exact
uploaded script was the one running when the reported returns were generated.

Concretely, it removes the need to trust either party:

- A creator cannot swap in a different script after building a track record on a
  profitable one.
- The platform cannot alter investment amounts or manipulate reported profits.
- Every trade and every performance number is tied to an attested code measurement.

The result is a trustworthy, cryptographically backed record of a strategy, its trades,
and its performance.

A second benefit: the enclave keeps the strategy's *parameters* private. A creator can
publish a verifiable track record without revealing the thresholds and signals that
produce it.

## Architecture

Three layers, each with a single owner:

| Layer | Technology | Responsibility |
|---|---|---|
| **Compute** | Chainlink CRE Confidential Workflows | Strategy logic and risk guardrails execute inside a hardware-isolated TEE. Secrets come from the Vault DON. Signed reports leave the enclave. |
| **Settlement** | Circle Agent Wallets on Arc | One policy-capped USDC wallet per strategy instance. Holds capital, executes trades, enforces spend limits and allowlists. |
| **Distribution** | Privy | Investor onboarding: social login, embedded wallet, funding, allocation, withdrawal. |

See [prizes.md](prizes.md) for what we build with each and the constraints each
imposes.

## Actors

### Strategy creator

- Writes a strategy as a TypeScript CRE workflow.
- Publishes it to the marketplace with a human-readable description of the approach.
- Supplies strategy parameters as secrets, encrypted in their own browser. The platform
  never sees them in plaintext — see [Creator submission flow](#creator-submission-flow).
- Earns from investor allocations (fee model TBD).
- Never has custody of investor funds and cannot alter a running strategy in place.

### Investor

- Signs in with Privy — social login, no seed phrase — and gets an embedded wallet.
- Browses listed strategies and their descriptions.
- Reviews verified performance metrics: returns, APY, drawdown, trade history.
- Allocates USDC to chosen strategies, and withdraws.
- Trusts the numbers because they are attested, not because they trust the creator.

### Platform

- Registers strategy workflows and schedules their execution.
- Provisions and configures an Agent Wallet per strategy instance, with its spending
  policy.
- Publishes attestations and the performance record.
- Compiles and deploys creator strategies, but never holds their secret parameters in
  plaintext.
- Is itself untrusted with respect to reported numbers — attestation is what backs them.

## How it works

1. **Upload** — The creator submits a TypeScript CRE workflow plus a strategy
   description. Strategy parameters are supplied separately as secrets, encrypted in the
   creator's browser. See [Creator submission flow](#creator-submission-flow).
2. **Measure** — The workflow is registered on-chain with CRE. The registered workflow
   binary's identity is the strategy's identity; it cannot change without re-registering.
3. **Run in TEE** — A confidential handler declares which TEE types and regions the
   workflow accepts. When the trigger fires, the Workflow DON hands execution to an
   enclave rather than running the callback on the node.
4. **Wallet assignment** — A Circle Agent Wallet is provisioned on Arc for the strategy
   instance, with a spending policy: global limits, per-service caps, and contract and
   chain allowlists. Its control credential is held as a Vault DON secret, retrievable
   only inside the enclave, so only the attested workflow can move funds.
5. **Trade** — The strategy trades USDC through venues on Arc.
6. **Record** — Trades and resulting performance are emitted as reports signed from
   inside the enclave, so the performance record is anchored to the attested workflow.
7. **Browse and allocate** — Investors see the strategy, its description, and its
   verified metrics, and allocate capital from their Privy wallet.

## Creator submission flow

A creator submits two things from the frontend: the strategy's **TypeScript** and its
**secret parameters**. They are handled differently, because only one of them can safely
pass through the platform in the clear.

### Code — the platform compiles and deploys it

The creator writes TypeScript in the frontend and submits it. The platform compiles it to
WASM and deploys it as a CRE workflow under the *platform's* CRE owner identity. Creators
need no CRE account, no linked owner key, and no deploy access of their own.

This is safe to centralise because the deployed workflow's identity is a hash anyone can
recompute:

```
binary hash + config hash  ->  workflow hash  ->  registered workflow identity
```

The creator publishes their source; a verifier recompiles it and checks the hash matches
what is registered. The platform cannot substitute different code without changing the
hash.

Two consequences worth stating plainly:

- **Strategy code is not confidential.** The workflow binary is supplied to the enclave by
  the Workflow DON and is not protected from node operators. This suits a marketplace
  where the strategy's approach is published — the *code* is open, the *parameters* are
  not.
- **The build is the attack surface, not the run.** Compiling creator-supplied TypeScript
  means running an untrusted dependency tree; a package's install script executes with the
  builder's privileges. Strategy builds run in a sandboxed, network-restricted builder
  against a vendored dependency set, not arbitrary npm.

Note that the workflow **config file is not a secret**. It is uploaded to Chainlink's
artifact storage — not world-readable, but plainly readable by Chainlink and by every DON
node. Creator parameters never go in config; they go in the Vault.

### Secrets — encrypted in the browser, unreadable by the platform

The creator's parameters are encrypted **in their browser**, to the Chainlink Vault DON's
threshold public key, before they ever leave the machine. The platform relays ciphertext.

```
creator's browser                     platform backend                Chainlink
  fetch vault public key ───────────────(relay)──────────────────────────▶
  encrypt(params, label = platform owner address)
  ciphertext ───────────────────────▶  allowlist request digest
                                       POST secrets.create ─────────────▶ Vault DON
                                         (sees ciphertext only)            └─ released only
                                                                              into an attested
                                                                              enclave
```

The platform cannot decrypt what it relays. This is not a promise not to look — it holds
no key that opens the blob. Decryption requires a threshold of Vault DON nodes, and they
release plaintext only into an attested enclave. There is also **no read-back API at all**:
`cre secrets` offers create, update, delete and list, and `list` returns identifiers, not
values. Holding the owner's private key does not recover a secret.

The backend authorises the request by digest, computed over the ciphertext — so
authorisation never requires the plaintext. Creators need no CRE org membership.

#### Implementation notes

| Piece | Detail |
|---|---|
| Vault public key | `vault.publicKey.get` on `https://01.gateway.zone-a.cre.chain.link`, unauthenticated. Returns a P256 TDH2 key. |
| Browser encryption | Chainlink's own JS TDH2, `src/tdh2.js` in `@chainlink/functions-toolkit`. P256, pure JS. |
| Envelope | Identical to the Go implementation — AES-256-GCM with the key TDH2-wrapped. Go emits `{tdh2Ctxt, symCtxt, nonce}`, JS `{TDH2Ctxt, SymCtxt, Nonce}`. |
| Required change | The toolkit's exported `encrypt()` hardcodes an empty label. CRE requires the label to be the owner address left-padded to 32 bytes (12 zero bytes + 20-byte address). Vendor `tdh2.js` and pass that label to the internal `tdh2Encrypt`. |
| Why a relay | The gateway returns no `Access-Control-Allow-Origin` header and its OPTIONS preflight fails, so a browser cannot POST to it directly. |

#### Who holds what

| Item | Platform sees | Backed by |
|---|---|---|
| Strategy TypeScript | Yes — it compiles and publishes it | Public by design |
| Strategy parameters | **No** — ciphertext only | TDH2 threshold encryption; no read-back API |
| Agent Wallet credential | **Yes, at provisioning** — the platform creates the wallet, then stores the credential as a Vault secret | Only the attested workflow can *direct* the wallet; see [An honest limit](#an-honest-limit) |
| Reported performance | Cannot forge it | Reports signed inside the enclave |

#### The residual risk

Vault secrets are scoped to the **owner**, not to an individual workflow. Any workflow
deployed under the platform's owner can read them, so a dishonest platform could deploy a
second workflow that reads a creator's parameters and sends them out from inside the
enclave.

What bounds this is the same primitive the rest of the design rests on: every workflow
under the owner is enumerable (`cre workflow list`) and each one's hash is verifiable
against its published source. A hidden exfiltrating workflow cannot exist unobserved. The
guarantee is therefore "check the hashes", not "trust the operator" — weaker than
per-workflow secret scoping, which CRE does not currently offer, and stronger than handing
the platform plaintext.

## Investor flow

```
Privy embedded wallet (social login, no seed phrase)
  -> fund with USDC
  -> allocate            [USDC transfer to the strategy's Arc Agent Wallet]
  -> strategy trades     [inside the Chainlink enclave]
  -> withdraw grown balance back to the Privy wallet
```

The allocate and withdraw transfers are ordinary supported wallet actions on Arc. Fiat
onramp is mocked — see [prizes.md](prizes.md) for why.

## Verifiability model

The chain a verifier can check end to end:

```
TypeScript workflow  ->  registered workflow identity (measurement)
                            |
                            v
                    TEE attestation  ->  enclave-held wallet credential
                            |                        |
                            v                        v
                   signed reports          policy-capped Agent Wallet
                            |
                            v
        trade + performance record  ->  reported returns / APY / drawdown
```

If any link is broken — a different workflow, a different enclave, an unsigned record —
the performance claim does not verify.

### An honest limit

The wallet credential is held inside the enclave, but the Agent Wallet itself is
Circle-managed rather than enclave-generated. That is a weaker claim than "the private
key was born inside the enclave and never existed anywhere else": it means Circle is in
the trust set for custody, even though only the attested workflow can *direct* the
wallet.

A second, narrower limit is that Vault secrets are owner-scoped rather than
workflow-scoped — see [The residual risk](#the-residual-risk).

The spending policy is what compensates. Global limits, per-service caps, and contract
and chain allowlists bound what a strategy can do with capital regardless of what its
code attempts — which also mitigates the phase 1 gap below, where strategy code is
unaudited.

## Phase 1 scope

Phase 1 deliberately skips formal code audits of uploaded strategies. The focus is:

- Strategies actually run inside the TEE.
- Attestation is produced, stored, and independently checkable.
- Performance data is cryptographically verifiable and traceable to the attested
  measurement.

Explicitly **out of scope for phase 1**: auditing strategy code for quality, safety, or
malicious behaviour. A verified strategy means "this exact code produced these results",
not "this code is good or safe". Spending policies bound the damage; they do not
establish that a strategy is sound.

## Phase 2

- **Arbitrary containers.** The Docker-image model — any language, packaged by the
  creator, measured by image digest — is deferred. CRE runs registered workflows, not
  arbitrary containers, so phase 1 is TypeScript-only. Supporting Docker means running
  our own enclaves (AWS Nitro, Intel TDX) and doing attestation ourselves.
- **Enclave-generated wallet keys**, removing Circle from the custody trust set.
- **Per-workflow secret scoping**, if CRE gains it — today secrets bind to the owner, so
  isolation between creators rests on hash verification rather than on the Vault.
- **Strategy code review** before listing.

## Open questions

- Fee and revenue-sharing model between creator and platform.
- Capital pooling model: per-investor accounting vs. pooled strategy vault, and how
  deposits and withdrawals are accounted mid-strategy.
- Handling of strategy updates: new registration as a new measurement and a fresh track
  record, vs. continuity of history.
- Whether a confidential handler can sign venue transactions directly, or whether signing
  must cross back to the DON for a consensus-verified report — this determines how step 5
  is wired.
- Enclave execution time and memory limits for a strategy that polls a venue on an
  interval.
- Which Arc venue to route through: Uniswap V2 (deployed on testnet), Circle's App Kit
  Swap SDK, or Tower Exchange as aggregator.

### Resolved

- ~~Chain / venue support~~ — Arc, USDC-denominated.
- ~~TEE vendor and attestation flow~~ — Chainlink CRE Confidential Workflows.
- ~~Whether the platform must hold creator secrets in plaintext~~ — no. Creators encrypt
  in the browser to the Vault DON's threshold key; the platform relays ciphertext.
- ~~Egress policy for strategy containers~~ — superseded: CRE's confidential HTTP client
  governs outbound calls, with secrets injected via templates inside the enclave.
