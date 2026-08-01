/**
 * Deepgram Voice Agent configuration — sent as the `Settings` message when the
 * browser opens the WS. The "agent" is not created in a dashboard; it lives here.
 * See handoff §3.
 */

import { DOCTOR, diasAbiertos, etiquetaDia } from "../agenda/daponte.js";

/** The only days Dr. Daponte works in the demo window — straight from the agenda. */
const DIAS_ABIERTOS = diasAbiertos()
  .map((f) => `  · ${etiquetaDia(f)}  (fecha: ${f})`)
  .join("\n");

export const SYSTEM_PROMPT = `
You are the receptionist at Daponte Clinic, an eye care (ophthalmology) clinic.
There is ONE doctor: ${DOCTOR.display} (${DOCTOR.especialidad}), at the
${DOCTOR.sede} office. Every appointment is with him — if the caller names
another doctor, tell them Dr. Daponte is the ophthalmologist here.

You speak natural, friendly, efficient English — like a real receptionist
answering the phone. Almost everyone is calling to book an appointment, so make
it as seamless as possible.

## The doctor's schedule — this is the whole truth

Dr. Daponte's book is only open on these days:
${DIAS_ABIERTOS}

Every date is in 2026. If the caller says "the 28th" or "Monday", that is
September 28, 2026.

HARD RULES about times — breaking these breaks the booking:
- NEVER say a date or a time that did not come back from buscar_disponibilidad.
- Call buscar_disponibilidad BEFORE offering anything. Offer two or three of the
  returned slots, exactly as written, and let the caller pick.
- Do not round, shift or invent a time. If they ask for 10:15 and 10:15 is not in
  the list, say it's not available and offer what is.
- If they ask for a day that isn't in the list above, say which days the doctor
  has and let them choose.

## What to collect

Required to book (ask for these):
1. FULL NAME — split it into last name and first name when you prepare the appointment.
2. ID number (national ID). Read it back once to confirm.
3. Date and time, picked from buscar_disponibilidad.
4. Insurance ("Do you have insurance, or is this a private visit?"). The clinic
   takes OSDE, GALENO, MEDIFE, OMINT, or PARTICULAR for private. Never invent a plan.
5. Contact lenses — one quick question: "Do you wear contact lenses?" It's an eye
   clinic and the chart requires it.

Capture, but never interrogate for: phone, cell, email, address, and the reason
for the visit. If the caller mentions any of it, keep it and pass it along; if
they don't, move on.

Also write a one-line clinical summary of the call (symptoms, medication,
anything relevant) into "comentarios".

## Closing — the most important step in the call

Once you have the slot and the details, call preparar_turno with EVERYTHING that
came up in the call — every field the caller gave you, not just the required ones.

That function call is what actually loads the appointment. Nothing else does:
- Call preparar_turno FIRST, and only say your closing line after it comes back.
- Saying you will "get that ready" is not the same as doing it. Never say it
  before the call has actually been made — there is no one else who will do it.
- Reading the appointment back to the caller is a summary, not a booking. Do not
  summarize and stop.

NEVER say the appointment is confirmed. Once preparar_turno has returned, close
with: "Perfect, I'll get that ready and our front desk will confirm your
appointment shortly."
`.trim();

/** Function declarations the agent can call. Handlers live in ../functions. */
export const AGENT_FUNCTIONS = [
  {
    name: "buscar_disponibilidad",
    description:
      `Dr. Franco Daponte's real open slots. Call this BEFORE naming any date or time. ` +
      `Returns slots_libres (the only times that exist) and dias_disponibles. ` +
      `Call it with no date to hear which days the doctor works.`,
    parameters: {
      type: "object",
      properties: {
        fecha: {
          type: "string",
          description:
            "Requested date as YYYY-MM-DD. The year is always 2026 (e.g. 2026-09-28). Omit to list every open day.",
        },
        franja: {
          type: "string",
          enum: ["morning", "afternoon", "any"],
        },
      },
      required: [],
    },
  },
  {
    name: "obtener_contexto_paciente",
    description:
      "Fetch the patient's history and relevant findings (Moss + MedPlum) to personalize the conversation.",
    parameters: {
      type: "object",
      properties: { documento: { type: "string", description: "ID number" } },
      required: ["documento"],
    },
  },
  {
    name: "investigar_problema",
    description:
      "Deep-research a symptom or problem against the medical knowledge base (Moss + LLM).",
    parameters: {
      type: "object",
      properties: {
        sintoma: { type: "string", description: "Symptom or problem" },
        contexto: { type: "string" },
      },
      required: ["sintoma"],
    },
  },
  {
    name: "verificar_cobertura",
    description: "Insurance eligibility check against the payer (Stedi 270/271).",
    parameters: {
      type: "object",
      properties: {
        payer: { type: "string" },
        nro_afiliado: { type: "string" },
        documento: { type: "string" },
      },
      required: ["payer"],
    },
  },
  {
    name: "preparar_turno",
    description:
      "Load the appointment into the system WITHOUT confirming it (ready for the front desk to accept). " +
      "The slot must be one returned by buscar_disponibilidad. Pass EVERYTHING the caller said — " +
      "phone, email, address, insurance and the reason all get written into the chart.",
    parameters: {
      type: "object",
      properties: {
        fecha: {
          type: "string",
          description: "Appointment date, YYYY-MM-DD. The year is always 2026.",
        },
        hora: {
          type: "string",
          description: "Appointment time, HH:MM — copied verbatim from slots_libres",
        },
        paciente: {
          type: "object",
          description: "Patient identity and contact details as given on the call",
          properties: {
            apellido: { type: "string", description: "Last name" },
            nombre: { type: "string", description: "First name(s)" },
            documento: { type: "string", description: "ID number, digits only" },
            tipoDoc: { type: "string", description: "ID type, default 'DNI'" },
            domicilio: { type: "string", description: "Street address, if given" },
            telefono: { type: "string", description: "Landline, if given" },
            celular: { type: "string", description: "Mobile, if given" },
            email: { type: "string", description: "Email, if given" },
          },
          required: ["apellido", "nombre", "documento"],
        },
        cobertura: {
          type: "string",
          description:
            "Insurance as the caller said it (OSDE, GALENO, MEDIFE, OMINT, PARTICULAR). Required by the clinic.",
        },
        motivo: {
          type: "string",
          description: "Reason for the visit, default 'Consulta'",
        },
        usaLC: {
          type: "boolean",
          description: "Does the patient wear contact lenses? Mandatory in the chart.",
        },
        comentarios: {
          type: "string",
          description: "One-line clinical summary of the call for the doctor",
        },
        enviaRecordatorio: {
          type: "boolean",
          description: "Send a reminder, default true",
        },
      },
      required: ["fecha", "hora", "paciente"],
    },
  },
] as const;

export const GREETING =
  "Daponte Clinic, Dr. Daponte's office — how can I help you?";

/** Full Settings payload for the Deepgram Voice Agent v1 WS
 * (wss://agent.deepgram.com/v1/agent/converse).
 * - listen nova-3 + language "es" for Spanish STT
 * - think open_ai/gpt-4o-mini is Deepgram-hosted (no extra key needed)
 * - speak aura-2-selena-es: Latin-American Spanish female voice
 * Functions omit `endpoint` → they're handled client-side (by our backend). */
export function buildAgentSettings() {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      greeting: GREETING,
      listen: { provider: { type: "deepgram", model: "nova-3" } },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini" },
        prompt: SYSTEM_PROMPT,
        functions: AGENT_FUNCTIONS,
      },
      speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
    },
  };
}
