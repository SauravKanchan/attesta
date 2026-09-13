# Build plan

The local, end-to-end implementation. Everything runs on one machine against a local
anvil chain — no testnet, no real funds.

## Layout

```
contracts/    Foundry — MockUSDC, StrategyVault, StrategyRegistry
backend/      Fastify + Drizzle + better-sqlite3 + viem
frontend/     Next.js 15 (App Router) + Tailwind v4
chainlink/    CRE workflows — the existing runner plus the creator template
shared/       types.ts, strategy-contract.ts — the contract all three build against
```

## The value loop

Nothing about a strategy's performance is set by hand. It falls out of the strategy's
own decisions applied to a price series:

```
price oracle (seeded walk, backend)
   -> GET /api/oracle/prices          [real HTTP call, made from inside the workflow]
   -> cre workflow simulate           [strategy's onTick() runs, returns target weights]
   -> backend prices the decision     [weights x price delta since last tick = pnl]
   -> vault.applyPnl(int256)          [real transaction on anvil]
   -> NAV snapshot                    [row in nav_snapshots]
   -> APY / total return / drawdown   [computed from the NAV series]
```

So APY is *derived*, never stored as an input. A strategy that picks badly shows a
negative APY because its weights lost money, not because a field says `-8.4`.

The oracle walk is seeded and deterministic, so a simulation is reproducible — which is
what makes the attested-decision story coherent.

## Contracts

**MockUSDC** — ERC20, 6 decimals, open `mint(address,uint256)` faucet.

**StrategyVault** — one per strategy.
- `deposit(uint256 assets)` / `withdraw(uint256 shares)` with ERC4626 share math.
- `applyPnl(int256 delta)` — operator only. Positive draws from the reserve into managed
  assets; negative returns to the reserve. This is how a tick's result lands on-chain.
- `recordTrade(...)` — operator only, emits the trade event the UI reads.
- Reserve: USDC held beyond `totalManagedAssets`, prefunded at deploy so gains are
  payable. Invariant: `usdc.balanceOf(vault) >= totalManagedAssets`.
- `operator` is the strategy's agent wallet — an anvil EOA standing in for a Circle
  Agent Wallet, which cannot run locally.

**StrategyRegistry** — `register(bytes32 strategyId, address vault, bytes32 binaryHash)`.
Puts the workflow measurement on-chain so the verifiability claim has a public anchor.

### Vault behaviours callers must handle

None of these are visible in the ABI, and each one is easy to hit from the scheduler.

| Behaviour | What reverts | What the caller must do |
|---|---|---|
| A gain with no depositors | `applyPnl(+x)` reverts `NoSharesOutstanding()` when `totalShares == 0` — a gain with no owner would sit in managed assets until the next depositor, who mints 1:1 against a zero supply and would redeem the whole stranded amount | Skip the settlement for that tick. The strategy still decides, still records its trades and still writes a NAV snapshot, so a strategy nobody has funded is visibly running rather than silently absent |
| A gain larger than the buffer | `applyPnl(+x)` reverts `ReserveExhausted(gain, reserve)` — the vault refuses to promise value it cannot pay | Prefund the reserve with `fundReserve` at publish time, and cap a tick's delta at the reserve rather than losing the whole tick to a revert |
| A loss larger than the book | `applyPnl(-x)` reverts `LossExceedsManagedAssets(loss, managed)` | Cap the loss at `totalManagedAssets` |
| Settling from the wrong account | `applyPnl` and `recordTrade` revert `NotOperator()` | Sign with the strategy's agent wallet, and top its gas up before the tick |
| An empty vault's share price | `navPerShare()` returns par (1e6) whenever `totalShares == 0`, rather than dividing by zero | Read NAV as a claim per share, not as evidence a strategy has capital; `totalShares` is what says whether it does |

`fundReserve` pulls the USDC, so the platform float has to hold the amount and have approved
the vault for it first.

### The strategy id on-chain

The registry keys on `bytes32` and a strategy's platform id is a uuid, so the id is hashed:
`keccak256(utf8Bytes(strategyId))`, in `backend/src/lib/strategy-id.ts` and nowhere else.
The chain layer takes that key already hashed — `ChainPort.registerStrategy` and
`isStrategyRegistered` both accept the bytes32 — because a client that hashed a raw id
internally would hash a second time whenever the caller had reasonably hashed it first, and
anchor the strategy under `keccak(keccak(id))`: a key nothing looks up, with nothing
anywhere to report it.

## Authentication and signing

The user's private key never reaches the server, and the backend never signs on a user's
behalf. This is deliberate: Privy's embedded wallet gives the browser a signer, so if the
backend held keys now, swapping Privy in later would mean rewriting the whole money path
rather than replacing one function.

**Sign in** proves control of an address:

```
browser                                     backend
  paste private key (or pick an anvil test account)
  derive address locally
  POST /auth/challenge {address}  ─────────▶  issue a nonce, store it
  sign the message with viem                  ◀─ {message, nonce}
  POST /auth/verify {address, signature} ──▶  recoverMessageAddress, compare, issue a session
```

Two details the client must match exactly, or recovery fails in a way that looks like a
bad key:

- **Sign `challenge.message` verbatim.** The server builds a multi-line SIWE-style string
  containing the nonce, Issued At and Expires At, and derives its domain line from
  `CORS_ORIGIN`. Reconstructing the message client-side will not recover to the same
  address.
- **Echo back `challenge.address`, not the casing you sent.** Addresses are normalised
  with `getAddress` and stored checksummed.

Nonces are single-use with a 5-minute TTL; a consumed nonce is refused.

The key is held in browser memory, persisted to `localStorage` only because this is a
local dev build, and the login screen says so plainly. Replacing it with Privy means
replacing where the signer comes from — the challenge/verify exchange is unchanged.

### Where chain configuration comes from

`GET /api/chain/config` is authoritative for chain id, RPC URL and **all contract
addresses**. Addresses must never live in env: anvil redeploys move them, and a stale
`.env` pointing at a dead address fails in a way that looks like a bug in the contract.

`NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_CHAIN_ID` exist in `frontend/.env` as a
**pre-hydration fallback only** — usable before the config fetch resolves, and overridden
by the fetched values the moment they arrive. When the two disagree, the fetched config
wins, every time. Nothing may read the env vars after hydration.

### Privy is the eventual signer

`frontend/src/lib/wallet.ts` exposes a signer interface with a local-private-key
implementation behind it. Privy replaces the implementation, not the interface:

```ts
const provider = await wallet.getEthereumProvider()   // from Privy's useWallets()
createWalletClient({ transport: custom(provider) })
```

`signMessage({ message })` still produces a `personal_sign` signature that
`recoverMessageAddress` verifies, so the challenge/verify exchange is unchanged. Keep the
signer source swappable and nothing else has to move.

**Investing and withdrawing** are signed in the browser too:

```
browser: usdc.approve(vault, amount) -> wait receipt
browser: vault.deposit(amount)       -> wait receipt
browser: POST /strategies/:slug/invest {txHash}
backend: fetch the receipt, parse the Deposited event, verify it came from the caller's
         address and targets this strategy's vault, then record the position
```

The backend records what the chain says happened rather than what the client claims, so a
forged or replayed hash records nothing. The same shape applies to withdrawal.

Gas: anvil accounts are pre-funded. A wallet created by pasting an unfunded key is topped
up from the deployer account through `POST /wallet/faucet`, which also mints USDC.

## API

Base `/api`. Session via `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/challenge` | `{address}` -> `LoginChallenge`. Never accepts a private key. |
| POST | `/auth/verify` | `{address, signature}` -> `Session` |
| GET | `/auth/me` | `User` |
| GET | `/strategies` | `ListStrategiesQuery` -> `ListStrategiesResponse`. Fuzzy search, filters, sort. |
| GET | `/strategies/:slug` | `StrategyDetail` (includes caller's position when held) |
| GET | `/strategies/:slug/series?range=` | `TimeseriesPoint[]` — strategy NAV per share |
| GET | `/strategies/:slug/position-series?range=` | `PositionSeries` — the caller's own money |
| GET | `/strategies/:slug/trades` | `Trade[]` |
| GET | `/strategies/:slug/executions` | `Execution[]` |
| GET | `/strategies/:slug/source` | raw TypeScript |
| POST | `/strategies/:slug/invest` | `{txHash}` -> verify the receipt on chain, record the `Position` |
| POST | `/strategies/:slug/withdraw` | `{txHash}` -> verify the receipt on chain, update the `Position` |
| GET | `/portfolio` | `Portfolio` |
| POST | `/wallet/faucet` | mint MockUSDC and top up gas for the caller |
| GET | `/chain/config` | contract addresses, chain id and RPC URL, so the browser can build transactions |
| POST | `/submissions` | create a `SubmissionDraft` |
| PATCH | `/submissions/:id` | update code and metadata |
| POST | `/submissions/:id/secrets` | `EncryptedSecret[]` — ciphertext only |
| POST | `/submissions/:id/check` | run the sanity pipeline, stream results |
| GET | `/submissions/:id` | `SubmissionDraft` with current check state |
| POST | `/submissions/:id/publish` | deploy vault, register, go live |
| GET | `/oracle/prices` | current price snapshot — called by the workflow inside the enclave |
| GET | `/health` | liveness |

## Sanity pipeline

Run in order on submit; a failure stops the rest.

1. `parses` — TypeScript parses.
2. `required-exports` — all six of `REQUIRED_EXPORTS` are exported.
3. `forbidden-imports` — none of `FORBIDDEN_IMPORTS`, no dynamic `import()`.
4. `no-side-effects` — no `FORBIDDEN_GLOBALS`, no top-level statements beyond
   imports, declarations and exports.
5. `typechecks` — `tsc --noEmit` against the strategy contract.
6. `describe-valid` — `describe()` returns valid metadata and declares its assets.
7. `deterministic` — `onTick()` twice with identical context gives identical output.
8. `cre-build` — `cre workflow build` succeeds; capture the binary hash.
9. `cre-simulate` — `cre workflow simulate` succeeds and yields a parseable decision.

Only after 9 may a submission publish. That mirrors "in simulation mode it lists once
simulation is successful".

## Scheduler

One tick loop per live strategy, default 60s. Each tick: refresh the oracle, run
`cre workflow simulate` for that strategy, parse the decision, price it, send
`applyPnl` and `recordTrade`, snapshot NAV, write an `Execution` row.

`backend/src/services.ts` is the composition root: it builds the one `ChainPort` (over
`backend/src/chain/`) and the one `OraclePort`, hands both to the scheduler, and is called
from the entry point after `listen` — the enclave fetches prices over HTTP from this same
process, so the oracle route has to be answering before the first tick can complete. The
loop starts unless `SCHEDULER_ENABLED=false`. One tick can be driven by hand with
`npm run tick -- <slug>`, and the whole loop — publish, deposit, four ticks, metrics — is
proved end to end by `npm run verify:loop`.

`cre workflow simulate` fires a cron trigger once and exits — the CLI has no scheduled
mode and rejects `--listen` for cron — so the scheduler owns the interval. Deployed CRE
workflows are scheduled by the DON instead; this is the local stand-in.

## Secrets

Phase 1 local: the browser encrypts with a dev scheme (`local-dev`) and the backend
stores ciphertext, keeping the shape of the real flow. The production path — TDH2 to
the Vault DON's threshold key — is specified in
[project-overview.md](project-overview.md#secrets--encrypted-in-the-browser-unreadable-by-the-platform)
and swaps in at the same seam: `EncryptedSecret.scheme`.

## Out of scope locally

Circle Agent Wallets (no local runtime), Privy (a pasted key supplies the browser's
signer in its place, behind the same challenge/verify exchange), live CRE
deployment (blocked by a platform regression — see [chainlink/SETUP.md](../chainlink/SETUP.md)).
