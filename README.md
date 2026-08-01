# Oído — Agendamiento por voz (voz → FHIR/EDI → EHR)

Voice-first medical intake for a hackathon. A patient talks to a Deepgram voice
agent; the conversation becomes clinical documentation (MedPlum FHIR), coverage
is checked (Stedi 270/271), history is grounded (Moss RAG), and the appointment
is loaded into the Treelan EHR by an already-built RPA widget — **stopping right
before "Aceptar".**

The full architecture and data contract live in
[`docs/HANDOFF-NUEVO-REPO.md`](docs/HANDOFF-NUEVO-REPO.md). Read that first.

## Layout

```
backend/   Node + TypeScript. Deepgram voice-agent config, function handlers,
           vendor clients (MedPlum / Stedi / Moss), WS "pull" transport to the widget.
widget/    the already-built Chrome extension RPA.
panel/     the call UI (mic + live function-call log).
app/       Vite + React SPA — the Stedi eligibility bench, used to develop and
           eyeball the 270/271 flow outside the voice loop.
docs/      the handoff spec.
vendor/    Medplum monorepo, vendored (see vendor/README.md).
```

| Path | What it is |
| --- | --- |
| `backend/src/clients/stedi.ts` | Eligibility 270/271 — payer-name → mock fixture, test mode only |
| `backend/src/clients/moss.ts` | Semantic retrieval over indexed context |
| `backend/src/clients/medplum.ts` | FHIR read (patient context) + write (`Appointment`, `Communication`) |
| `app/src/stedi/mock-requests.ts` | All 34 Stedi mock requests, extracted from their docs and verified live |
| `app/src/stedi/to-fhir.ts` | 271 response → `Patient` / `Coverage` / `CoverageEligibilityResponse` |
| `scripts/stedi-eligibility.mjs` | Run any mock eligibility request from the CLI |
| `scripts/medplum-project-init.mjs` | Provision a Medplum project via `Project/$init` |
| `medplum-link` | Relative symlink to `vendor/medplum` — the layout Medplum recommends for AI assistants |

## Quickstart — talk to the agent

```bash
cp .env.example .env       # DEEPGRAM_API_KEY required; vendors optional
cd backend && npm install && npm run dev
```

Then open **http://localhost:8787/** and click **Iniciar llamada**. Use
**headphones** (otherwise the mic hears the agent's own voice). The agent greets
you in Argentine Spanish and runs the receptionist script; its function calls
show in the right panel.

- Voice pipeline: browser mic → backend → Deepgram Voice Agent (`nova-3` es STT +
  `gpt-4o-mini` LLM + `aura-2-antonia-es` TTS) → back to the browser.
- Sanity-check the Deepgram connection alone: `npx tsx src/scripts/dgtest.ts`.

The server boots without the other keys and reports which vendors are
unconfigured, so you wire them one at a time. Per-vendor steps: [`SETUP.md`](SETUP.md).

## Vendor status

| Vendor | Function it backs | State |
| --- | --- | --- |
| Deepgram | the conversation itself | wired |
| Stedi | `verificar_cobertura` | wired — test mode, 34/34 fixtures verified live |
| Moss | `investigar_problema`, `obtener_contexto_paciente` | wired — ~1 ms queries |
| MedPlum | `obtener_contexto_paciente`, post-call write | wired — read + write |

### Stedi — test mode only

Everything Stedi-side is **test mode**: synthetic payers and patients, no PHI/PII,
nothing reaches a real payer, no charges. The backend refuses to start a check with a
key that doesn't begin with `test_`.

Stedi is a US clearinghouse and this is an Argentine clinic, so
`backend/src/clients/stedi.ts` maps a local payer name (OSDE, Swiss Medical, …) onto a
Stedi mock fixture. That keeps the 270/271 round-trip real while the payer identity is
stand-in. `STEDI_TEST_PAYER_ID` sets the fallback for unmapped names.

Subscriber and dependent values must match Stedi's fixtures **exactly** — any other
name, DOB, or member ID returns an AAA error. Provider name and NPI are free-form
(the NPI just has to pass check-digit validation).

```bash
npm run stedi -- --list          # all 34 fixtures
npm run stedi -- aetna           # active coverage, copays, deductibles
npm run stedi -- aaa-73 --raw    # a payer rejection, full response
```

| Category | Count | Examples |
| --- | --- | --- |
| `medical-active-subscriber` | 13 | `aetna`, `cigna`, `humana`, `kaiser-ncal`, `cms`, `unitedhealthcare` |
| `medical-active-dependent` | 6 | `aetna-dependent`, `bcbstx-dependent`, `oscar-health-dependent` |
| `dental` | 6 | `ameritas-dental`, `metlife-dental`, `cigna-dental-procedure-code` |
| `aaa-error` | 6 | `aaa-42`, `aaa-43`, `aaa-72`, `aaa-73`, `aaa-75`, `aaa-79` |
| `medical-inactive` | 1 | `unitedhealthcare-inactive` |
| `mbi-lookup` | 1 | `cms-mbi-lookup` |
| `stedi-agent` | 1 | `stedi-agent` (designed to fail with AAA 73) |

### MedPlum

Project **test** (`71bf21cb-c741-4290-b2f0-fef2b53e121e`), from **Admin → Project →
Details** at [app.medplum.com](https://app.medplum.com).

The backend authenticates headlessly with **client credentials**, so it needs
`MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` from **Admin → Project → Clients**. (The
`app/` SPA is different — it uses `<SignInForm projectId>` email/password login and needs
no client ID at all.)

`@medplum/cli` is a repo-root devDependency:

```bash
npx medplum login                 # once — opens a browser, stores creds in ~/.medplum
npx medplum project list
npm run project:init -- "Oído"    # provision a new project via Project/$init
```

There is no `medplum init` command — `medplum project` only has `list`, `current`,
`switch`, `invite`. Provisioning is the `$init` operation.

### Moss

`@moss-dev/moss` depends on `@moss-dev/moss-core`, which ships **native Node addons**,
not browser WASM — so it only runs server-side. `loadIndex()` pulls the index into memory
and queries then run locally in ~1 ms instead of a cloud round-trip.

## The eligibility bench (`app/`)

A React SPA for developing the 270/271 flow without going through the voice loop: pick a
fixture, run the check, read the benefits table, semantic-search the response, and persist
it as FHIR.

```bash
cd app && npm install && npm run dev
```

Its `vite.config.ts` carries dev-only `/api/stedi/*` and `/api/moss/*` middleware so the
keys stay server-side. That's a development convenience — the voice path goes through
`backend/`, not through Vite.

## Order of build (from the handoff §10)

1. Widget RPA with a hand-pasted payload — the safety net (already done).
2. Deepgram voice agent + browser mic → `preparar_turno` → widget. (done)
3. Moss + MedPlum **read** to personalize the conversation. (done)
4. Stedi coverage badge before touching `turno_deudor`. (done)
5. MedPlum **write** (`Appointment` + `Communication`) after the fill. (done)
6. (stretch) per-field streaming so the form fills as the patient speaks.

## Notes / limits

- The Stedi account is a **sandbox**: test claims and the Stedi MCP server need a
  production account. Real-time eligibility checks work fully.
- `build.cssMinify` is off in `app/` to work around an unresolved
  `$mantine-breakpoint-xs` variable in `@medplum/react@5.1.27`'s shipped CSS.
