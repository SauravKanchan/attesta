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

## API

Base `/api`. Session via `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | `{username}` -> `Session`. Creates the user and funds an anvil wallet on first sight. |
| GET | `/auth/me` | `User` |
| GET | `/strategies` | `ListStrategiesQuery` -> `ListStrategiesResponse`. Fuzzy search, filters, sort. |
| GET | `/strategies/:slug` | `StrategyDetail` (includes caller's position when held) |
| GET | `/strategies/:slug/series?range=` | `TimeseriesPoint[]` — strategy NAV per share |
| GET | `/strategies/:slug/position-series?range=` | `PositionSeries` — the caller's own money |
| GET | `/strategies/:slug/trades` | `Trade[]` |
| GET | `/strategies/:slug/executions` | `Execution[]` |
| GET | `/strategies/:slug/source` | raw TypeScript |
| POST | `/strategies/:slug/invest` | `{amount}` -> approve + `vault.deposit`, returns `Position` |
| POST | `/strategies/:slug/withdraw` | `{shares}` -> `vault.withdraw`, returns `Position` |
| GET | `/portfolio` | `Portfolio` |
| POST | `/wallet/faucet` | mint MockUSDC to the caller |
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

Circle Agent Wallets (no local runtime), Privy (username auth stands in), live CRE
deployment (blocked by a platform regression — see [chainlink/SETUP.md](../chainlink/SETUP.md)).
