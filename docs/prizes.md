# Integrations

The three partner technologies the platform is built on, what each one does for us, and
the constraints each imposes on the build.

| Layer | Technology | Responsibility |
|---|---|---|
| Compute | Chainlink CRE Confidential Workflows | Strategy logic executes inside a hardware-isolated TEE |
| Settlement | Circle Agent Wallets on Arc | Policy-capped USDC wallet per strategy instance |
| Distribution | Privy | Investor onboarding, funding, allocation, withdrawal |

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

## Circle — Agent Wallets on Arc

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
