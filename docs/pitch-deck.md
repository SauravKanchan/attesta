# Pitch deck — 6 slides

Round one. Bullets only, short enough to survive a very large font.
Doubles as the spine of the 2–4 min demo video.

Every claim on these slides is one the build actually supports. Chainlink CRE and Privy
are the targeted integrations; Circle Agent Wallets on Arc shaped the settlement design
but are **not built**, so they are not on slide 5 and must not be added back. See
[prizes.md](prizes.md).

---

## 1 — Title

# attesta

### Trading strategies whose track record is attested, not claimed.

---

## 2 — The Problem

- Anyone can claim 40% APY
- The number is published by whoever profits from it
- Strategies with a real edge won't reveal their code
- You trust the claim, or you walk away

---

## 3 — How It Works

- Creator uploads a TypeScript strategy
- It runs in an AWS Nitro enclave — Chainlink CRE
- The hash of the compiled binary is its identity
- Trades and returns leave the enclave signed
- Investors allocate USDC from a Privy wallet

---

## 4 — Why The Numbers Hold

- Swap the script, and the hash changes
- The enclave signs the results, not us
- Parameters encrypted in the creator's browser
- Returns derived from on-chain vault history
- Recompute the hash yourself and check it

---

## 5 — Built On

- **Chainlink CRE** — confidential compute in a Nitro enclave
- **Privy** — social login, no seed phrase
- **USDC vaults on chain** — ERC4626 share accounting

---

## 6 — Thank You

# Thank you

---

## Canva prompt

Paste into "Describe your ideal design", then Generate:

```
A 6-slide dark modern fintech pitch deck with very large bold text and short bullet
points, no paragraphs. Slide 1 title "attesta", subtitle "Trading strategies whose track
record is attested, not claimed." Slide 2 "The Problem": anyone can claim 40% APY; the
number is published by whoever profits from it; strategies with a real edge won't reveal
their code; you trust the claim or you walk away. Slide 3 "How It Works": creator uploads
a TypeScript strategy; it runs in an AWS Nitro enclave on Chainlink CRE; the hash of the
compiled binary is its identity; trades and returns leave the enclave signed; investors allocate USDC from a
Privy wallet. Slide 4 "Why The Numbers Hold": swap the script and the hash changes; we
don't sign the results, the enclave does; parameters encrypted in the creator's browser;
returns derived from on-chain vault history; recompute the hash yourself and check it. Slide 5 "Built On": Chainlink CRE for confidential
compute in a Nitro enclave; Privy for social login with no seed phrase; USDC vaults on
chain with ERC4626 share accounting. Slide 6 "Thank You".
```
