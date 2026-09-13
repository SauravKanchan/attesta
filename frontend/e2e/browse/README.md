# Browse-surface browser tests

Journeys A–G over the public landing page, sign-in, the marketplace grid and one
strategy end to end. Every expected figure is read from the API inside the test, so a
number written into a component fails the suite rather than passing quietly.

## Running

The suite drives a stack that is already up; it starts nothing itself.

```sh
# backend, on its own port and its own copy of the seeded database
cd backend
cp data/seed-template.db data/e2e-browse.db
PORT=4184 DATABASE_URL=./data/e2e-browse.db CORS_ORIGIN=http://localhost:3184 \
  SCHEDULER_ENABLED=false ORACLE_URL=http://127.0.0.1:4184/api/oracle/prices \
  node --env-file-if-exists=.env --import tsx src/index.ts

# frontend, built once so a concurrent editor cannot recompile it mid-run
cd frontend
NEXT_DIST_DIR=.next-e2e-browse NEXT_PUBLIC_API_URL=http://localhost:4184 npx next build
NEXT_DIST_DIR=.next-e2e-browse NEXT_PUBLIC_API_URL=http://localhost:4184 npx next start -p 3184

# the suite
cd frontend
E2E_BASE_URL=http://localhost:3184 E2E_API_URL=http://localhost:4184 \
  npx playwright test -c e2e/browse/browse.config.ts
```

Screenshots land in `docs/screenshots/` as `browse-*.png`. Traces and the saved sign-in
state go to `logs/e2e-browse/`, outside the Next project — written inside it they trip
the dev server's watcher and reload the page mid-journey.

## Conventions

- Specs are `*.pw.ts`, not `*.spec.ts`. A sibling suite in `frontend/e2e/` runs with
  `testDir: '.'` and the default `*.spec.ts` glob; this keeps the two from colliding.
- `01` is public, `02` signs in and saves the storage state, `03` and `04` reuse it.
- Every journey asserts the browser console is clean and that no API call was rejected.
  Both guards are in `support/fixtures.ts`, along with the sweep for cryptographic
  claims this system cannot make.
- Ports default to 3184/4184 and are overridable, because several agents drive this repo
  at once and no two may share a port or a database.
