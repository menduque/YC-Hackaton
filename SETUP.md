# Vendor setup — first steps (do these, bring back the values)

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

## 2. MedPlum — FHIR record

1. https://app.medplum.com → sign in, create/confirm a **Project**.
2. **Project Admin → Clients → New Client** (a `ClientApplication`) → copy
   **Client ID** and **Client Secret**.
3. Grab your **Project ID** (Project Admin → Details).
4. Base URL is `https://api.medplum.com/` unless self-hosted.
5. Before the demo: create one demo `Patient` with a `Condition` and a
   `MedicationStatement` (warfarin) so "full context of your history" is real —
   I can script this once the client creds are in.

→ `MEDPLUM_BASE_URL=` `MEDPLUM_CLIENT_ID=` `MEDPLUM_CLIENT_SECRET=` `MEDPLUM_PROJECT_ID=`

---

## 3. Stedi — eligibility (270/271)

1. https://www.stedi.com → sign in → **Healthcare / Eligibility**.
2. Create a **sandbox/test API key**.
3. Note a **test payer id** and its **expected response** (so the ELIGIBLE badge
   is deterministic on stage). US-centric: "OSDE" is mapped to a test payer.

→ `STEDI_API_KEY=` `STEDI_TEST_PAYER_ID=`

---

## 4. Moss — RAG context / deep research

1. https://portal.usemoss.dev → sign in, create a **Project**.
2. Copy **Project ID** and **Project Key**.
3. Before the demo we must **index** something real: the demo patient's history +
   a small medical KB (warfarin/anticoagulation notes). I'll write the indexer
   once the keys are in.

→ `MOSS_PROJECT_ID=` `MOSS_PROJECT_KEY=`

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

## Hard rule (non-negotiable, from the handoff §9.12)

The demo **never** clicks `Aceptar`. The form is filled and stopped. Get Daponte's
written OK before any real booking.
