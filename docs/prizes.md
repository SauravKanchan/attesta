# Integrations

The three partner technologies the platform is built on, what each one does for us, and
the constraints each imposes on the build.

| Layer | Technology | Responsibility |
|---|---|---|
| Compute | Chainlink CRE Confidential Workflows | Strategy logic executes inside a hardware-isolated TEE |
| Distribution | Privy | Investor onboarding, funding, allocation, withdrawal |

Settlement runs on plain USDC vaults on a local chain. **Circle Agent Wallets on Arc are
out of scope** — the design is written up below because the settlement layer was shaped
around it, but none of it is built, and nothing in the submission should imply otherwise.

## Chainlink — CRE Confidential Workflows

Sensitive parts of a CRE workflow execute inside a hardware-isolated TEE rather than on
the node. This is the compute layer: the strategy *is* a confidential workflow.

**What we build**

- A confidential handler declaring which TEE types and regions the workflow accepts.
  When the trigger fires, the Workflow DON hands execution to an enclave instead of
  running the callback locally.
- Strategy parameters and venue credentials stored as Vault DON secrets, fetched inside
  the enclave. They never appear on a node.
- Risk guardrails — position limits, stop-loss thresholds — evaluated in the enclave, so
  the rules stay private while remaining verifiably applied.
- Trade and performance data emitted as signed reports, forming the performance record.

**Constraints**

- Workflows are TypeScript, compiled and registered on-chain. CRE does not run arbitrary
  containers, which is why strategies are not Docker images.
- Do not log inside enclave execution logic.
- Multiple workflows may share an enclave; dedicated isolation is planned, not current.
- Confidential Workflows is in private beta and needs enrollment through a Chainlink
  account team. Local simulation does not wait on that — build against the simulator and
  request access in parallel.
- The confidential HTTP client governs outbound calls, with secrets injected via
  templates. This is the egress mechanism for market data and venue APIs.

**Unresolved**

- Whether a confidential handler can sign venue transactions directly, or whether signing
  must cross back to the DON for a consensus-verified report. This determines how trade
  execution is wired.
- Execution time and memory limits for a workflow that polls a venue on an interval.

## Circle — Agent Wallets on Arc (NOT IMPLEMENTED)

Nothing in this section exists in the code. It records the intended production shape of
the settlement layer. Today a strategy's operator is an ordinary EOA on a local chain and
the vault contract is what bounds it.

Arc is Circle's stablecoin-native chain. Agent Wallets are programmable USDC wallets
built for autonomous agents, which is what a running strategy is.

**What we build**

- One Agent Wallet per strategy instance, provisioned at listing time.
- A spending policy per wallet: global limits, per-service caps, contract allowlists,
  chain allowlists, and time-bounded sessions. This bounds what a strategy can do with
  capital regardless of what its code attempts.
- The wallet's control credential held as a Vault DON secret, so only the attested
  workflow can direct it.
- USDC as the denomination for deposits, positions, and withdrawals.

**Available on Arc testnet**

- Uniswap V2 is deployed — Router and Factory addresses are usable directly.
- Circle's App Kit SDK exposes a Swap capability.
- Tower Exchange aggregates across the chain's liquidity sources.
- Faucet at `faucet.circle.com` — USDC, EURC, cirBTC; 1 USDC per day.

**Constraints**

- Agent Wallets support Arc testnet today; Arc mainnet is listed as coming soon. Build
  against testnet, keep the mainnet config ready.
- Wallets are Circle-managed, not enclave-generated. Circle is therefore in the custody
  trust set — see the honest-limit note in
  [project-overview.md](project-overview.md#an-honest-limit).

**Unresolved**

- Which venue to route through: Uniswap V2 directly, App Kit Swap, or Tower as
  aggregator.

## Privy — investor wallets

Embedded wallets with social login and no seed phrase. This is the whole investor-facing
surface.

**What we build**

```
Privy embedded wallet (social login)
  -> fund with USDC
  -> allocate            [USDC transfer to the strategy's Arc Agent Wallet]
  -> strategy trades     [inside the Chainlink enclave]
  -> withdraw grown balance back to the Privy wallet
```

The allocate and withdraw transfers are ordinary supported wallet actions on Arc.

**Constraints**

- Arc testnet is not in `viem/chains`. Configure it with `defineChain`: name, chain ID,
  native currency, RPC URLs, block explorer URL.
- Privy's fiat onramp routes through MoonPay, which will not support Arc testnet. The
  card-to-USDC step is mocked; the on-chain transfers are real. Do not build the
  onboarding demo around the onramp.
- A development app, not a production one. Production app IDs set their cookies only on
  a verified domain, so a session cannot persist on localhost. Privy has no dev/prod
  toggle — the two are separate apps, and an app ID is a development one by being the one
  you use in development. Allowed Origins may be left empty for it.
- Login methods are dashboard toggles, not env vars or code. `config.loginMethods` picks
  from what is already enabled under Configuration -> Login methods; it cannot enable
  anything. Google runs on Privy's own OAuth credentials, so no Google Cloud project is
  needed — your own credentials are a production nicety, not a prerequisite.
- Only `NEXT_PUBLIC_PRIVY_APP_ID` belongs in the frontend. It is an identifier, not a
  secret. The app secret is a real secret and belongs to the backend, if anywhere.

**Verifying a Privy token, if the backend ever needs to**

It does not today: the backend verifies a signature over a nonce it issued, not a Privy
JWT, so it holds no Privy credentials at all. What follows applies the day identity moves
from the wallet address to the Privy DID.

Privy publishes a JWKS endpoint per app:

```
https://auth.privy.io/api/v1/apps/<app-id>/jwks.json
```

Tokens are ES256, issuer `privy.io`, audience the app ID. Verify with `jose` —
`createRemoteJWKSet` plus `jwtVerify` — and the backend needs no app secret and no
`@privy-io/node`, because the app ID is public and the keys are public. `payload.sub` is
the user's DID.

Prefer that endpoint over the PEM verification key in the dashboard. The endpoint serves
several keys, each with a `kid`, so rotation is handled; a single pinned PEM starts
rejecting valid tokens the moment Privy rotates.

Two findings below were established by probing the endpoint, not read from the docs:

- The keys are **EC P-256 / ES256**. Privy's own documentation describes the verification
  key as Ed25519 in at least one place. That is wrong, and a verifier built on it will not
  work.
- The endpoint doubles as an app-ID validator. A valid ID returns 200; an invalid one
  returns 400 `{"code":"missing_or_invalid_privy_app_id"}`. Reach for this first when
  sign-in fails inexplicably — a whitespace or copy-paste artifact in the app ID presents
  as a broken integration, not as a bad value.

Holding the DID is not the same as knowing the wallet address: a JWKS-verified token
carries `sub` only. Fetching the address server-side means calling Privy's API, which is
what the app secret is for.

## Why two wallet systems

Investors get Privy wallets; strategies get Circle Agent Wallets. This is deliberate, not
redundant. Investors are humans who need consumer onboarding — social login, recovery, no
key management. Strategies are autonomous agents that need programmatic, policy-capped
wallets with no human in the loop. Different actors, different trust models, different
wallet infrastructure.

## Possible addition: The Graph

Not currently in scope. If added, strategies would read signals from indexed mainnet
subgraphs and execute on Arc — which means it does not depend on The Graph indexing Arc.
The marketplace's own performance record could also be served from a subgraph rather than
from CRE signed reports, though the reports are the stronger source since they are
enclave-signed.
