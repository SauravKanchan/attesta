# Live status — hackathon submission

Written 2026-09-13 ~19:25 UTC+5:30. Delete once submitted.

## Only remaining task

**Record the video.** GitHub is linked and the logo, cover and screenshots are uploaded to
ETHGlobal. Nothing else is gated on anyone but the user.

Script: [demo.md](demo.md) section 4 — six beats, 3–4 minutes.

## Running right now

| Workflow | Agents | Purpose |
|---|---|---|
| `wf_13ce2f5a-5fc` | `privy`, `reseed`, then `final-check` | Privy as a second signer; clean single-scheduler reseed |
| `wf_c97c5dab-55b` | fix wave | Defects from the browser passes |

Stopped deliberately: the screenshot workflow. The images are already uploaded.

## Ports in use

- `:3000` / `:4000` — the demo stack the user records from. **Do not kill these.**
- `:3184–3186`, `:4184–4186` — browser test agents
- `:4196` Privy agent, `:4197` reseed agent, `:4198`/`:3198` final check
- anvil `:8545`

## The two things that could still change the pitch

1. **Privy** — not integrated as of the last check. If it lands, submit to Chainlink and
   Privy. If not, submit to **Chainlink only** and do not tick the Privy box; one honest
   track beats two where one is empty.
2. **Reseed** — before it, all three strategies read negative because six schedulers were
   double-settling the same vaults. After it, at least one should be up. If everything is
   still negative on a clean run that is a real finding about the price series, not
   something to tune away.

## Say this out loud on camera

- The vault settles on chain but **does not trade** — the market is simulated. `README.md`
  and `demo.md` already say so.
- APY reads unavailable by design: annualising a twenty-minute track record is an artefact,
  so the card leads with return since inception. That is the answer to "anyone can claim
  40% APY".
- The strategy operator is a local key, not a Circle Agent Wallet. Circle is designed for
  and **not built** — every doc says so, and the ETHGlobal submission and Canva deck were
  corrected to match.

## What is genuinely real

Real `cre workflow build` and `cre workflow simulate` in an AWS Nitro enclave, reading a
Vault DON secret and returning a signed decision. Binary hash anchored on chain in
`StrategyRegistry`. Deposits and withdrawals signed in the browser and verified from the
receipt. Creator secrets encrypted with WebCrypto before they leave the page. 47 contract
tests, 116 backend tests, 67 toolkit tests.
