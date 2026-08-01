# YC Hackathon — Stedi × Medplum × Moss

A working eligibility-check demo: run an X12 270/271 real-time eligibility check
through [Stedi](https://www.stedi.com) test mode, render the benefits, and persist
the result as FHIR in [Medplum](https://www.medplum.com)'s hosted cloud.

Everything Stedi-side runs in **test mode**: synthetic payers and patients, no PHI/PII,
nothing reaches a real payer, and no charges.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | Vite + React + Mantine SPA, wired to Medplum's hosted FHIR API |
| `app/src/stedi/mock-requests.ts` | All 34 Stedi mock requests, extracted from their docs and verified live |
| `app/src/stedi/client.ts` | Browser-side eligibility client (talks to the dev proxy) |
| `app/src/stedi/to-fhir.ts` | 271 response → FHIR `Patient` / `Coverage` / `CoverageEligibilityResponse` |
| `app/src/moss/client.ts` | Benefits → Moss documents, plus the browser-side search calls |
| `app/vite.config.ts` | Dev-only server: Stedi proxy (keeps the key off the client) + Moss endpoints |
| `scripts/stedi-eligibility.mjs` | CLI runner for any mock request |
| `scripts/medplum-project-init.mjs` | Provisions a Medplum project via the `Project/$init` operation |
| `vendor/medplum` | The Medplum monorepo, vendored and committed (Apache-2.0, pinned to `59c344c`) |
| `medplum-link` | Relative symlink to `vendor/medplum` — the layout Medplum recommends for AI assistants |

## Setup

```bash
cp .env.example .env          # Stedi test key (server-side)
cp app/.env.example app/.env  # Medplum + Moss (public, VITE_-prefixed)
cd app && npm install
```

**Secrets rule:** the Stedi API key lives in the repo-root `.env` and is only ever read by
Node (the Vite dev middleware and `scripts/`). Anything in `app/.env` is `VITE_`-prefixed
and ships to the browser — never put the Stedi key there.

### Stedi

A test API key is already generated for the `Oido AI` account. To make your own:
[API keys](https://portal.stedi.com/app/settings/developer/api-keys) → **Generate new API
Key** → Mode **Test**. Test keys only work with the mock requests in
`app/src/stedi/mock-requests.ts`.

### Medplum

Already configured: project **test** (`71bf21cb-c741-4290-b2f0-fef2b53e121e`), from
**Admin → Project → Details** at [app.medplum.com](https://app.medplum.com).

**No Client ID is needed.** `<SignInForm projectId={...}>` does project-scoped
email/password login; the server only looks up a `ClientApplication` when a `clientId` is
actually sent (`packages/server/src/auth/login.ts`). Create one under **Admin → Project →
Clients** only if you switch to an OAuth/SMART flow, and set `VITE_MEDPLUM_CLIENT_ID` then.

Sign in with your normal Medplum email and password. The eligibility demo runs without
signing in — Medplum only gates the "Save as FHIR" step.

#### Medplum CLI + provisioning projects

`@medplum/cli` is a repo-root devDependency, so `npx medplum ...` works from here.

```bash
npx medplum login                 # once — opens a browser, stores creds in ~/.medplum
npx medplum whoami
npx medplum project list
npx medplum get 'Patient?_count=5'
```

To provision a **new** project from code instead of the web UI, use the
[`Project/$init`](https://www.medplum.com/docs/api/fhir/operations/project-init) operation:

```bash
npm run project:init -- "Oido AI"              # create it
npm run project:init -- "Oido AI" --write-env  # ...and point app/.env at it
npx medplum project switch <projectId>         # move the CLI to it
```

`$init` creates the Project, a `ClientApplication`, and your `ProjectMembership` in one
call; it returns only the Project. Any authenticated user can call it, and the owner
defaults to the User on your access token.

Note there is no `medplum init` command — the CLI's `project` subcommands are
`list`, `current`, `switch`, and `invite`. Provisioning is the `$init` operation above.

### Moss

Already configured. Note that `@moss-dev/moss` depends on `@moss-dev/moss-core`, which
ships **native Node addons**, not browser WASM — so Moss runs in the dev server behind
`/api/moss/index` and `/api/moss/query`, reading `MOSS_*` from the repo-root `.env`.

In the demo: run a check, click **Index N benefit lines**, then ask questions in plain
English. A payer's 271 is hundreds of coded rows; each becomes one searchable sentence.
Queries come back in ~1 ms.

## Run

```bash
cd app && npm run dev
```

Or from the CLI, without the browser:

```bash
node scripts/stedi-eligibility.mjs --list
node scripts/stedi-eligibility.mjs aetna
node scripts/stedi-eligibility.mjs aaa-73 --raw
```

## Mock request catalogue

34 requests across seven categories, all verified against the live test API:

| Category | Count | Examples |
| --- | --- | --- |
| `medical-active-subscriber` | 13 | `aetna`, `cigna`, `humana`, `kaiser-ncal`, `cms`, `unitedhealthcare` |
| `medical-active-dependent` | 6 | `aetna-dependent`, `bcbstx-dependent`, `oscar-health-dependent` |
| `dental` | 6 | `ameritas-dental`, `metlife-dental`, `cigna-dental-procedure-code` |
| `aaa-error` | 6 | `aaa-42`, `aaa-43`, `aaa-72`, `aaa-73`, `aaa-75`, `aaa-79` |
| `medical-inactive` | 1 | `unitedhealthcare-inactive` |
| `mbi-lookup` | 1 | `cms-mbi-lookup` |
| `stedi-agent` | 1 | `stedi-agent` (designed to fail with AAA 73) |

Subscriber and dependent values must match Stedi's fixtures **exactly** — any other name,
DOB, or member ID returns an AAA error. Provider name and NPI are free-form (the NPI just
has to pass check-digit validation).

## Notes / limits

- The Stedi account is a **sandbox**, so test claims and the Stedi MCP server are
  unavailable (both need a production account). Real-time eligibility checks — what this
  demo uses — work fully.
- `app/vite.config.ts`'s proxy is dev-only. For production, move it behind a real backend
  or a [Medplum Bot](https://www.medplum.com/docs/bots).
- `build.cssMinify` is off to work around an unresolved `$mantine-breakpoint-xs` variable
  in `@medplum/react@5.1.27`'s shipped CSS. Remove once Medplum fixes it.
