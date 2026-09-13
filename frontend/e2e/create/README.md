# Creator-flow browser tests

Journeys A–G over the create screen: sign in, write a strategy, watch the required-exports
checklist, fill the listing, encrypt private parameters, run the nine pre-flight checks,
publish, and be refused when the source imports a forbidden module.

The load-bearing test is journey D. `POST /submissions/:id/secrets` is read off the wire
and searched for the plaintext that was typed into the form; if the plaintext is in there,
the product's central claim is false and the suite says so rather than passing.

## Running

The suite drives a stack that is already up; it starts nothing itself.

```sh
# backend, on its own port, its own copy of the seeded database and its own workspace
cd backend
cp data/seed-template.db data/e2e-create.db && rm -f data/e2e-create.db-wal data/e2e-create.db-shm
PORT=4186 DATABASE_URL=./data/e2e-create.db CORS_ORIGIN=http://localhost:3186 \
  SCHEDULER_ENABLED=false STRATEGY_WORKSPACE_DIR=./data/workflows-create \
  ORACLE_URL=http://127.0.0.1:4186/api/oracle/prices \
  node --env-file-if-exists=.env --import tsx src/index.ts

# frontend, built once so a concurrent editor cannot recompile it mid-run
cd frontend
NEXT_DIST_DIR=.next-e2e-create NEXT_PUBLIC_API_URL=http://localhost:4186 npx next build
NEXT_DIST_DIR=.next-e2e-create NEXT_PUBLIC_API_URL=http://localhost:4186 npx next start -p 3186

# the suite
cd frontend
E2E_BASE_URL=http://localhost:3186 E2E_API_URL=http://localhost:4186 \
  npx playwright test -c e2e/create/create.config.ts
```

Screenshots land in `docs/screenshots/` as `create-*.png`. Traces, the saved sign-in state
and `timings.json` go to `logs/e2e-create/`, outside the Next project — written inside it
they trip the dev server's watcher and reload the page mid-journey.

`STRATEGY_WORKSPACE_DIR` must be a directory no other agent is using: publishing generates
a CRE workflow there and runs a real `cre workflow build` against it.

## What the timings are for

`logs/e2e-create/timings.json` records when every check started and settled, because dead
air is the create flow's real risk on camera. Measured on this machine over five runs:

| Phase | Warm workspace | First run in a fresh `STRATEGY_WORKSPACE_DIR` |
|---|---|---|
| `parses` … `no-side-effects` (one analysis pass, streamed together) | 0.3s | 0.3s |
| `typechecks` | 0–4s | 4s |
| `describe-valid`, `deterministic` | <0.1s | <0.1s |
| `cre-build` | 4–17s | 55s |
| `cre-simulate` | 14–44s | 15s |
| **nine checks, end to end** | **22–56s** | **74s** |
| publish — deploy the vault, fund the reserve, register on-chain | ~20s | ~20s |

So the whole run is under a minute warm, and all but a second of it is the two `cre`
steps — which are the last two rows of the list and sit below the fold on a 900px-tall
window. The header names the check that is running for that reason.

## Conventions

- Specs are `*.pw.ts`, not `*.spec.ts`. A sibling suite in `frontend/e2e/` runs with
  `testDir: '.'` and the default `*.spec.ts` glob; this keeps the two from colliding.
- `01` signs in and saves the storage state; `02` and `03` reuse it.
- Journeys B–F are one test because they are one submission: the draft lives in the
  flow's own state, so splitting it across page loads would test a different product.
- Every journey asserts the browser console is clean, that no API call was rejected, and
  that no page claims something this system cannot do. The guards are in
  `support/fixtures.ts`.
- Ports default to 3186/4186 and are overridable, because several agents drive this repo
  at once and no two may share a port, a database or a workflow workspace.
