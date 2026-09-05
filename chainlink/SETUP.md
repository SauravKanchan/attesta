# CRE setup

Local setup for the Chainlink CRE confidential workflow. `README.md` in this directory
is the template's own documentation and explains the confidential-workflow model in
depth; this file covers only what is specific to our setup.

## Run it

```bash
cd chainlink
cre workflow simulate strategy-runner --target staging-settings -e .env
```

Expected output:

```
Trigger requested TEE Execution ... AWS Nitro in us-west-2
[USER LOG] Enclave computation complete. verdict=APPROVE
✓ Workflow Simulation Result:
"APPROVE (score: 803, secret reached API: true)"
```

`secret reached API: true` confirms the Vault DON secret was injected inside the enclave
and travelled with the outbound HTTP request.

## Versions

| Tool | Version | Notes |
|---|---|---|
| CRE CLI | v1.32.0 | installed to `~/.cre/cre`; `~/.cre/bin` added to `~/.zshrc` |
| bun | >= 1.2.21 | **hard requirement** — see the gotcha below |
| node | v22.16.0 | |
| `@chainlink/cre-sdk` | 1.18.0 | pinned by the template |
| Go | not installed | only needed for Go workflows |

### Gotcha: bun version

`@chainlink/cre-sdk` declares `engines: { bun: ">=1.2.21" }`. On an older bun the
workflow still *compiles*, then fails at engine start with an opaque error rather than a
version complaint:

```
Failed to create engine: failed to execute subscribe: error while executing at wasm backtrace
Caused by: wasm trap: wasm `unreachable` instruction executed
```

The toolchain compiles TypeScript to JavaScript to WASM through bun, so an old bun emits
a broken binary. If this trap appears, check `bun --version` first. Fix:

```bash
bun upgrade && rm -rf strategy-runner/node_modules && bun install --cwd ./strategy-runner
```

### Gotcha: pass `-e .env`

The CLI does not pick up `.env` automatically. Without it, simulation fails with
`environment variable SECRET_API_TOKEN for secret value not found` and silently falls
back to a default private key. Either pass `-e .env` or export the variables first.

## Environment

`.env` is gitignored (`*.env`); `.env.example` is committed as the template.

| Variable | Purpose |
|---|---|
| `CRE_ETH_PRIVATE_KEY` | Currently a throwaway dev key with no funds, for local simulation only. **Replace before any deployment.** |
| `CRE_TARGET` | Default target when `--target` is omitted |
| `SECRET_API_TOKEN` | Value behind the `API_TOKEN` secret in `secrets.yaml`; the enclave fetches it via `runtime.getSecret({ id })` |

## Layout

```
chainlink/
├── project.yaml               # RPC endpoints per target
├── secrets.yaml               # secret ID -> env var mapping
├── .env / .env.example
└── strategy-runner/
    ├── workflow.ts            # the confidential workflow
    ├── main.ts                # Runner entry point
    ├── config.staging.json    # schedule, url, secretId, scoreThreshold
    ├── config.production.json
    └── workflow.yaml          # per-target workflow settings
```

## The confidential path

`strategy-runner/workflow.ts` implements all five steps of the confidential-workflow
guide:

1. `cre.handlerInTee(trigger, fn, [{ tee: 'nitro', regions: ['us-west-2'] }])` — registers
   the handler to run in an enclave. AWS Nitro in `us-west-2` is currently the only
   registered TEE type and region.
2. `runtime.getSecret({ id })` — the Vault DON releases the secret only into an attested
   enclave. Nothing is declared upfront.
3. `new cre.capabilities.HTTPClient().sendRequest(runtime, ...)` — the `TeeRuntime`
   overload runs the request from inside the enclave, keeping request and response
   payloads confidential. Do **not** use `ConfidentialHTTPClient` here; it has no
   `TeeRuntime` overload.
4. `runtime.usingTheDons()` — crosses back to a normal `Runtime` for consensus. Anything
   passed across is no longer confidential, so only the verdict and score cross, never
   the secret or raw response body.
5. `donRuntime.report(...)` — produces the signed report.

The handler receives a `TeeRuntime`, not a `Runtime`.

### What is and is not confidential

The workflow **binary** — including the logic itself — is provided to the enclave by the
Workflow DON and is *not* confidential. What the enclave protects is the data that logic
computes over: Vault DON secrets, HTTP request and response payloads made from the
enclave, and intermediate values.

This matters for our design: a strategy's *code* is public, its *parameters* are not.
That is the right shape for the marketplace, where the strategy description is published
and the thresholds stay private.

### Logging

`runtime.log()` inside the enclave is for simulation only and must be removed before
deployment. In real execution these logs never leave the TEE.

## Status

- [x] CLI installed, authenticated (`cre whoami`)
- [x] Project scaffolded from `hello-confidential-workflows-ts`
- [x] Simulation passing end to end
- [ ] **Deploy access** — `Deploy Access: Not enabled`. Request with `cre account access`.
- [ ] **Confidential Workflows private beta** — enrollment via a Chainlink account team is
      required to deploy. Simulation does not need it.
- [ ] Replace the placeholder endpoint (`postman-echo.com/headers`) and scoring stub with
      real strategy logic.
- [ ] Deployment registry is `private` (Chainlink-hosted, off-chain, no gas).

## Useful commands

```bash
cre whoami                       # account and deploy-access status
cre account access               # request deployment access
cre registry list                # available deployment registries
cre templates list               # template catalogue
cre workflow simulate --help
```
