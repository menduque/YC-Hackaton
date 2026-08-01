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
widget/    (drop-in) the already-built Chrome extension RPA — port from the old repo.
docs/      the handoff spec.
```

## Quickstart — talk to the agent

```bash
cd backend
cp .env.example .env      # DEEPGRAM_API_KEY is already required; rest optional
npm install
npm run dev
```

Then open **http://localhost:8787/** and click **Iniciar llamada**. Use
**headphones** (otherwise the mic hears the agent's own voice). The agent greets
you in Argentine Spanish and runs the receptionist script; its function calls
show in the right panel.

- Voice pipeline: browser mic → backend → Deepgram Voice Agent (`nova-3` es STT +
  `gpt-4o-mini` LLM + `aura-2-selena-es` TTS) → back to the browser.
- Sanity-check the Deepgram connection alone: `npx tsx src/scripts/dgtest.ts`.

The server boots without the other keys and reports which vendors are
unconfigured, so you wire them one at a time. Per-vendor steps: [`SETUP.md`](SETUP.md).

## Order of build (from the handoff §10)

1. Widget RPA with a hand-pasted payload — the safety net (already done).
2. Deepgram voice agent + browser mic → `preparar_turno` → widget.
3. Moss + MedPlum **read** to personalize the conversation.
4. Stedi coverage badge before touching `turno_deudor`.
5. MedPlum **write** (`Appointment` + `Communication`) after the fill.
6. (stretch) per-field streaming so the form fills as the patient speaks.
