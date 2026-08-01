# Vendor setup

Status: **Deepgram, MedPlum, Stedi and Moss are all wired and verified.**
Check any time with:

```bash
cd backend && npm run vendortest    # exercises every handler the agent calls
```

Every value lives in the **repo-root `.env`** (`backend/.env` also works and
takes precedence). Sections below are kept for reference / re-provisioning.

Everything you gather here goes into `backend/.env` (template: `backend/.env.example`).
The backend boots without them and tells you what's still missing, so tackle them
in any order. Bring me the values as you get them and I'll wire each one.

---

## 1. Deepgram — the voice agent (do this first)

1. https://console.deepgram.com → sign in.
2. **API Keys → Create a New API Key** (Member role is fine). Copy it once.
3. That's it — the "agent" is configured in code, not in a dashboard.

→ `DEEPGRAM_API_KEY=`

Decision to confirm: **Voice Agent API** (STT+LLM+TTS+function-calling over one
WebSocket — recommended) vs. STT `nova-3` + our own Claude LLM + `aura-2` TTS.
Default to Voice Agent API unless you want more control.

---

## 2. MedPlum — FHIR record ✅ DONE

Project **test** (`71bf21cb-c741-4290-b2f0-fef2b53e121e`), and the backend
authenticates with the project's auto-created **"test Default Client"**
(Admin → Project → Clients). Medplum makes one per project — no need to create
another. All four `MEDPLUM_*` values are in the repo-root `.env`.

Wired in `backend/src/clients/medplum.ts`:

- `getPatientContext(documento)` — searches `Patient` by identifier, pulls
  `Condition` + active `MedicationRequest`, returns a speakable summary.
- `writeAppointmentAndCommunication()` — writes the `Appointment` with status
  **`proposed`** (never `booked` — the front desk still has to press Aceptar) plus
  a `Communication` carrying the agent's clinical summary.

Still to do before the demo: seed a demo `Patient` with `Condition` +
`MedicationRequest` matching DNI 30111222, so `getPatientContext` returns
history instead of "paciente nuevo". Moss already has that patient's narrative.

---

## 3. Stedi — eligibility (270/271) ✅ DONE

Account **Oido AI**, test-mode key in the repo-root `.env`. Test mode means
synthetic patients, nothing reaching a real payer, and no charges; the client
refuses to run with a key that isn't `test_`-prefixed.

All 34 of Stedi's documented mock requests are in
`shared/stedi/mock-requests.ts`, each verified against the live test API.
`backend/src/clients/stedi.ts` maps the payer the patient names onto one of them:

| Spoken | Fixture | Result on stage |
| --- | --- | --- |
| OSDE | `aetna` | active, $25 consultation copay |
| Swiss Medical | `cigna` | active |
| Galeno | `unitedhealthcare` | active |
| Omint | `humana` | active |
| PAMI | `cms` | active |
| Particular / ninguna | `unitedhealthcare-inactive` | **inactive** — good for showing the unhappy path |
| anything else | `STEDI_TEST_PAYER_ID` (default `aetna`) | active |

Deterministic by construction — same fixture, same answer, every time.

→ `STEDI_API_KEY=` `STEDI_TEST_PAYER_ID=` (both set)

---

## 4. Moss — RAG context / deep research ✅ DONE

Keys are in the repo-root `.env`, and the index is built:

```bash
cd backend && npm run moss:index
```

That seeds `oido-clinical` with a triage/scheduling KB (cefalea, chest pain →
emergencias, fasting, pediatría, documentation, cancellations) plus a synthetic
demo history for DNI 30111222. Re-run any time — it drops and rebuilds.

`retrieve()` calls `loadIndex()` once and then queries locally in ~1 ms. That
matters inside a live call, where a 300 ms retrieval is an audible pause.

Note `@moss-dev/moss` ships native Node addons, not browser WASM — it only runs
server-side.

→ `MOSS_PROJECT_ID=` `MOSS_PROJECT_KEY=` (both set)

---

## 5. The widget (already built — port it in)

Copy the `oido-turnos-widget/` extension from the old repo into `widget/` here.
Load it unpacked in the consulting-room Chrome (`chrome://extensions` → Developer
mode → Load unpacked). Nothing to buy. Transport choice: **C — WS pull** (the
content script opens a WS to our backend, localhost-friendly) is recommended for
the hackathon.

---

## 6. Backend host (optional for now)

Local (`npm run dev`) is enough for the demo. If you want it reachable by a real
domain (for `externally_connectable` transport A) deploy to Vercel/Railway/ngrok.

→ `PORT=` `PUBLIC_BASE_URL=`

---

## 7. Dr. Daponte's agenda (hardcoded)

`backend/src/agenda/daponte.ts` is the only place the voice agent gets dates and
times from. It holds **Dr. Franco Daponte's** identity (Treelan professional
`e3244abc-…`, sede Montañeses) and his slot grid for the demo window:
**September 26, 27, 28 and 29 — always 2026**. Whatever year the caller or the
LLM says is coerced to 2026.

- `buscar_disponibilidad` only ever returns times from this table. A day that
  isn't in it comes back with the days that are, so the agent can't invent a slot
  the Treelan RPA would choke on.
- `preparar_turno` re-validates the slot before pushing anything to the widget: a
  time that's taken, blocked or simply not in the grid is refused with the free
  list, and the agent re-offers while the caller is still on the line.

Refresh it against the live grid (~30s): with `turno.php` open for that day, run
`copy(JSON.stringify(OidoRpa.leerSlots().map(s => ({hora:s.hora, estado:s.estado}))))`
in the console, then

```bash
curl -X POST localhost:8787/v1/agenda/2026-09-28 \
  -H 'content-type: application/json' -d '{"slots": <paste>}'
```

`GET /v1/agenda` prints the whole table. The override is in memory — paste it
into `daponte.ts` to make it permanent.

---

## Hard rule (non-negotiable, from the handoff §9.12)

The demo **never** clicks `Aceptar`. The form is filled and stopped. Get Daponte's
written OK before any real booking.
