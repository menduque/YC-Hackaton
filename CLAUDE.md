# Hackathon Rules for Agent

This is a YC hackathon project (`porto-novo`, repo `menduque/YC-Hackaton`). Time is the
scarce resource. These rules exist so future sessions don't re-litigate the same defaults
or block on clarifying questions that don't actually need to be asked.

## Bias to action

- Default to the fastest, lightest-weight reasonable interpretation of a request and
  proceed. State the assumption you made in one line and keep moving — don't stop and
  wait for confirmation on it.
- Only pause to ask before acting when the action is genuinely destructive or hard to
  reverse (force-push, deleting data, dropping infra, spending real money, provisioning
  production-grade infra). Standard setup work — installing deps, scaffolding a project,
  cloning a starter template, adding a hosted/cloud integration — does not need a check-in.
- If a decision is close to irreversible, still bias toward the interpretation that keeps
  the most optionality open, note it, and continue rather than blocking.

## Infra preferences

- Prefer hosted/cloud services over self-hosting infrastructure. E.g. use Medplum's
  hosted cloud (app.medplum.com) rather than vendoring their server monorepo and running
  Postgres/Redis/CDR locally, unless explicitly told this needs to be self-hosted.
- Prefer adding SDKs/packages as dependencies in an app scaffolded in this repo over
  cloning a large external monorepo into it.

## Stack in this repo

See `README.md` for setup. Short version:

- `app/` — Vite + React + Mantine SPA on Medplum's **hosted** FHIR cloud
  (`https://api.medplum.com/`). No local Postgres/Redis/CDR.
- Stedi real-time eligibility (X12 270/271) in **test mode**.
- Moss (`@moss-dev/moss`) for in-browser semantic search.

### Medplum

- The Medplum monorepo is **vendored** at `vendor/medplum` (Apache-2.0, pinned to
  `59c344c`, ~219 MB / 5193 files — see `vendor/README.md`). `medplum-link/` is a relative
  symlink to it, which is the setup Medplum recommends in
  [Building with AI coding assistants](https://www.medplum.com/docs/building-with-ai-coding-assistants):
  read real code from `medplum-link/packages/` and `medplum-link/examples/` rather than
  guessing at APIs. `medplum-link/examples/medplum-eligibility-demo` is the closest
  reference for the eligibility workflow.
- It's committed, so it works offline and travels with the checkout. Don't edit anything
  under `vendor/` — re-vendoring overwrites it. See `vendor/README.md` to refresh.
- Never run `npm install` inside `vendor/medplum` — it pulls ~2 GB. `.gitignore` blocks
  `node_modules/`, `dist/` and `.turbo/` under there as a backstop.
- `@medplum/cli` is a repo-root devDependency: `npx medplum login | whoami | project list |
  get | post | bot ...`. Creds land in `~/.medplum/<profile>.json`; `npx medplum token`
  prints a bare access token, which is how `scripts/medplum-project-init.mjs` authenticates.
- There is **no `medplum init` command.** `medplum project` only has `list`, `current`,
  `switch`, `invite`. To provision a project use the `Project/$init` FHIR operation
  (`POST /fhir/R4/Project/$init`), wrapped by `npm run project:init -- "<name>"`. It
  creates Project + ClientApplication + ProjectMembership and returns only the Project.
- Target FHIR R4. Prefer the resources Medplum already models for this workflow:
  `Patient`, `Coverage`, `CoverageEligibilityRequest`, `CoverageEligibilityResponse`.
- Use `@medplum/fhirtypes` for typing — the FHIR types are strict (e.g. `Money.currency`
  is a closed union, `CoverageEligibilityResponseInsurance.coverage` is required).
- Project **test** = `71bf21cb-c741-4290-b2f0-fef2b53e121e`. **No Client ID needed** —
  `<SignInForm projectId>` does project-scoped email/password login, and the server only
  resolves a `ClientApplication` when `clientId` is present. Only create one if you move
  to an OAuth/SMART flow.

### Moss

- `@moss-dev/moss` depends on `@moss-dev/moss-core`, which ships **native Node addons**
  (`.node`) — despite what moss.dev's README implies, this package does **not** run in the
  browser. It lives in the dev server (`/api/moss/index`, `/api/moss/query` in
  `app/vite.config.ts`) and reads `MOSS_*` from the repo-root `.env`.
- Import it with a non-literal specifier. Its published types reference a `tsconfig.json`
  that isn't in the tarball, which makes `tsc` fail with TS5083 under `module: nodenext`.
- `createIndex` throws if the name already exists — `deleteIndex().catch(() => {})` first.
- Call `loadIndex()` before `query()`; that's what makes queries local (~1ms) instead of a
  cloud round-trip.

### Stedi

- **Test mode only.** The account (`Oido AI`) is a sandbox, so test claims and Stedi's
  MCP server are unavailable — those need a production account. Real-time eligibility
  checks work fully.
- Endpoint: `POST https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3`
  with header `Authorization: Key <test_api_key>`.
- `app/src/stedi/mock-requests.ts` holds all 34 mock requests, extracted from Stedi's docs
  and verified against the live test API. **Subscriber/dependent values must match exactly**
  or the payer returns an AAA error. Dependents use `individualRelationshipCode`, not
  `relationshipToSubscriber`.
- The API key must never reach the browser bundle. It lives in the repo-root `.env`
  (`STEDI_API_KEY`) and is read only by Node: the dev proxy in `app/vite.config.ts` and
  `scripts/stedi-eligibility.mjs`. Anything in `app/.env` is `VITE_`-prefixed and public.
- Quick check from the CLI: `node scripts/stedi-eligibility.mjs --list`.

## Tools already available in this environment

- **gstack** (garrytan/gstack) is installed globally and its skills are already loaded —
  don't reinstall it, just use its skills directly.
- **gbrain** is fully set up (see GBrain Configuration below) — use it directly, no need
  to run setup again.

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-08-01
- MCP registered: yes (user scope)
- Embedding: deferred — no provider key set (OPENAI_API_KEY / VOYAGE_API_KEY /
  ZEROENTROPY_API_KEY). Keyword search works now; run `gbrain embed --stale` after
  adding a key to enable semantic search.
- Artifacts sync: off
- Current repo policy: read-write
