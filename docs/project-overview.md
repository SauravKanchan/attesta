# Project Overview

A TEE-powered marketplace for verifiable automated trading strategies.

Strategy creators upload trading scripts — packaged in Docker, written in any supported
language — together with a description of how the strategy works. The platform runs each
strategy inside a Trusted Execution Environment (TEE), which executes it in an isolated,
tamper-resistant environment and lets it trade through an assigned wallet.

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

## Actors

### Strategy creator

- Packages a strategy as a Docker image.
- Publishes it to the marketplace with a human-readable description of the approach.
- Earns from investor allocations (fee model TBD).
- Never has custody of investor funds and cannot alter a running strategy in place.

### Investor

- Browses listed strategies and their descriptions.
- Reviews verified performance metrics: returns, APY, drawdown, trade history.
- Allocates funds to chosen strategies, and withdraws.
- Trusts the numbers because they are attested, not because they trust the creator.

### Platform

- Runs the TEE infrastructure and schedules strategy containers.
- Assigns and manages a wallet per strategy instance.
- Publishes attestations and the performance record.
- Is itself untrusted with respect to reported numbers — attestation is what backs them.

## How it works

1. **Upload** — The creator submits a Docker image plus a strategy description.
2. **Measure** — The platform records a cryptographic measurement (image digest) of the
   submitted artifact. This measurement is the strategy's identity.
3. **Run in TEE** — The image is launched inside a TEE. The enclave produces an
   attestation binding the running code measurement to the enclave's identity.
4. **Wallet assignment** — A trading wallet is provisioned for the strategy instance.
   Its keys are generated inside and never leave the enclave, so only the attested code
   can sign trades.
5. **Trade** — The strategy trades through that wallet against the supported venue(s).
6. **Record** — Trades and resulting performance are recorded and signed from inside the
   enclave, so the performance record is anchored to the attested measurement.
7. **Browse and allocate** — Investors see the strategy, its description, and its
   verified metrics, and allocate capital.

## Verifiability model

The chain a verifier can check end to end:

```
uploaded image  ->  image digest (measurement)
                      |
                      v
              TEE attestation  ->  enclave-held wallet key
                      |
                      v
        signed trade + performance records  ->  reported returns / APY / drawdown
```

If any link is broken — a different image, a different enclave, an unsigned record — the
performance claim does not verify.

## Phase 1 scope

Phase 1 deliberately skips formal code audits of uploaded strategies. The focus is:

- Strategies actually run inside the TEE.
- Attestation is produced, stored, and independently checkable.
- Performance data is cryptographically verifiable and traceable to the attested
  measurement.

Explicitly **out of scope for phase 1**: auditing strategy code for quality, safety, or
malicious behaviour. A verified strategy means "this exact code produced these results",
not "this code is good or safe".

## Open questions

- Chain / venue support and the execution path for trades.
- Fee and revenue-sharing model between creator and platform.
- Capital pooling model: per-investor wallet vs. pooled strategy vault, and how
  deposits and withdrawals are accounted mid-strategy.
- TEE vendor and attestation flow (e.g. AWS Nitro, Intel TDX, SGX) and how attestation
  documents are published for third-party verification.
- Egress policy for strategy containers — which external endpoints (market data, RPC) a
  strategy may reach without weakening the isolation guarantee.
- Handling of strategy updates: new version as a new measurement and a fresh track
  record, vs. continuity of history.
