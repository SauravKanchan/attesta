# @attesta/strategy-toolkit

Everything the platform does to a creator's TypeScript between "submitted" and
"live". Standalone — no dependency on `backend/`, so the backend imports it.

```ts
import { runPipeline, runBacktest, loadStrategy } from '@attesta/strategy-toolkit'
```

| Export | Does |
|---|---|
| `analyse(source)` | `SanityCheck[]` — `parses`, `required-exports`, `forbidden-imports`, `no-side-effects`, over the TypeScript AST |
| `typecheck(source)` | `SanityCheck` — real `tsc --noEmit` in a temp dir against the strategy contract |
| `loadStrategy(source)` | `StrategyModule` — transpiled and evaluated in an isolated `node:vm` context |
| `checkDescribe(mod)` / `checkDeterminism(mod)` | the `describe-valid` and `deterministic` checks |
| `buildWorkflow(source, opts)` | generates a CRE workflow directory and runs `cre workflow build` |
| `simulateWorkflow(source, opts)` | same, then `cre workflow simulate`, with the decision parsed out |
| `runPipeline(source, opts)` | all nine checks in order, stopping at the first failure |
| `runBacktest(mod, priceSeries, opts)` | the NAV curve every listed metric is derived from |

`loadStrategy` is a lint that executes, not containment — `src/load.ts` documents
exactly what it does and does not isolate.

## Generated CRE workflows

`generateWorkflow()` writes `chainlink/strategy-toolkit/.workflows/<name>/`: the
creator's `strategy.ts`, a copy of the contract, and the `workflow.ts` in
`src/cre-workflow/` that registers a cron handler with
`cre.handlerInTee(..., [{ tee: 'nitro', regions: ['us-west-2'] }])`, GETs prices
from `oracleUrl` inside the enclave, reads secrets through the Vault DON, calls
`onTick`, and prints the decision behind `attesta-decision:`.

`node_modules` is symlinked to `strategy-runner/node_modules` — the dependency
set is pinned and identical, and a per-strategy `bun install` would put an npm
fetch in the middle of the submission pipeline.

`cre workflow simulate` fires a cron trigger **once** and exits. The schedule is
validated but not honoured and `--listen` is rejected for cron, so the platform
scheduler owns the interval and calls `simulateWorkflow()` once per tick.

## Secrets

Creators name their own secret ids. `secretAliases` maps those onto the ids
actually provisioned in the Vault, so `{ TARGET_WEIGHT_BPS: 'API_TOKEN' }` runs
the real Vault path locally without the creator knowing the platform's ids.

## Tests

```bash
npm install && npm test
```

The `cre CLI` block skips itself when the `cre` binary or `chainlink/.env` is
missing, since `.env` is gitignored.
