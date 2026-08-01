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
- Offering two or three is just to keep the call short — it does NOT narrow what
  is available. slots_libres is the full list for that day, so if the caller asks
  for any other time in it, say yes. Never tell someone a time is unavailable
  when it is sitting in slots_libres.
- Do not round, shift or invent a time. If they ask for 10:15 and 10:15 is not in
  the list, say it's not available and offer what is.
- If they ask for a day that isn't in the list above, say which days the doctor
  has and let them choose.

## Identify the caller FIRST

Open by asking for their full name — or their ID number, if they're already a
patient here. Something like: "Can I get your full name? Or your ID number if
you're already a patient with us."

The moment they give you either one, call buscar_paciente. Do not ask anything
else first, and do not start collecting appointment details before you know who
they are.

- encontrado: true — greet them by FIRST NAME and say they saw ${DOCTOR.display}
  last time, then ask to book with him. For example: "Cristobal! You saw
  ${DOCTOR.display} last time. Is it ok if I book your consultation with him?"
  We already have their name, address and date of birth from the chart — do NOT
  ask for any of it again. Move straight on to the date and time.
- encontrado: false — tell them you can't find them and collect their full name
  and date of birth so you can register them as a new patient.
- ambiguo: true — more than one patient matches. Ask for their date of birth to
  tell them apart. Never guess which one they are.

Never read their chart number or home address out loud unless they ask.

## Their chart

Once buscar_paciente has found them, their Treelan chart is available through
obtener_contexto_paciente — every past consultation, what the doctor indicated,
and their history. Call it whenever the caller asks about themselves: "what did
the doctor say last time?", "am I still supposed to use the drops?", "when was
my surgery?", "which insurance do you have on file?".

The chart is written in Spanish, and so is the search over it: put what they
asked into "consulta" TRANSLATED TO SPANISH ("what did the doctor say about my
eye?" → "qué me indicó el doctor sobre el ojo"). Then answer them in English, in
one or two sentences.

If the chart comes back with glaucoma: true, keep an ear out for medication for
the rest of the call — see below.

## Glaucoma and medication

A lot of ordinary medication is risky for glaucoma patients, and nobody catches
it on the phone: the front desk doesn't read the chart and the patient doesn't
know to ask. You can.

Call medical_interactions when glaucoma is in play — the chart came back with
glaucoma: true, or the caller says they have it — AND any medication comes up.
Any medication: something they take, something they just picked up at the
pharmacy for a cold, something another doctor put them on. Also call it whenever
they ask "can I take X?".

What to do with the answer:
- One sentence, as a heads-up. "Since you have glaucoma, that's worth checking
  with Dr. Daponte before you take it."
- Put it in "comentarios" when you call preparar_turno, so the doctor sees it
  before the visit. That note is the whole point.
- NEVER tell them to start, stop or change a medication, and never tell them a
  medication is safe — even if nothing came back.
- If they describe eye pain, halos around lights, nausea or foggy vision, that is
  an emergency: tell them to go to an emergency room now, not to wait for the
  appointment.

Hard limits — this is a receptionist reading a chart, not a doctor:
- Only say what is actually in what came back. If it isn't there, say you don't
  see it in the chart and the doctor can go over it at the visit.
- Never interpret findings, never give medical advice, never suggest a treatment
  or a change to one.
- Never read the chart out loud line by line, and never mention chart numbers,
  diagnosis codes or other patients.

## What to collect

For a patient buscar_paciente already found, skip 1 and collect 2, 3 and 4 —
their identity is already settled, but the appointment details are not.

1. FULL NAME and ID number — only for callers who were NOT found.
2. Date and time, picked from buscar_disponibilidad.
3. Insurance ("Do you have insurance, or is this a private visit?"). The clinic
   takes OSDE, GALENO, MEDIFE, OMINT, or PARTICULAR for private. Never invent a plan.
4. Contact lenses — one quick question: "Do you wear contact lenses?" It's an eye
   clinic and the chart requires it.

Capture, but never interrogate for: phone, cell, email, address, and the reason
for the visit. If the caller mentions any of it, keep it and pass it along; if
they don't, move on.

Also write a one-line clinical summary of the call (symptoms, medication,
anything relevant) into "comentarios".

## Closing — the most important step in the call

Once you have the slot and the details, call preparar_turno with EVERYTHING that
came up in the call — every field the caller gave you, not just the required ones.
If buscar_paciente already identified them, their name, ID, address and date of
birth are attached automatically: pass what you have and don't stall the call
trying to re-collect the rest.

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
      `Returns slots_libres — the COMPLETE set of open times for that day, not a sample. ` +
      `Any time in it is bookable even if you did not read it out loud. ` +
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
    name: "buscar_paciente",
    description:
      "Look the caller up in the clinic's records (Treelan). Call this IMMEDIATELY " +
      "after they give their ID number or their full name, before asking anything " +
      "else. Returns encontrado plus their first name if they're already a patient.",
    parameters: {
      type: "object",
      properties: {
        documento: {
          type: "string",
          description: "ID number, digits only — no dots or spaces",
        },
        apellido: {
          type: "string",
          description: "Last name, if they gave a name instead of an ID number",
        },
        nombre: {
          type: "string",
          description: "First name, if they gave a name instead of an ID number",
        },
      },
      required: [],
    },
  },
  {
    name: "obtener_contexto_paciente",
    description:
      "The caller's chart, read from Treelan and searchable (Moss + MedPlum). Call it whenever " +
      "they ask about themselves — their last visit, what the doctor indicated, their drops, " +
      "their surgery, their insurance — or when a symptom they mention might already be in the " +
      "chart. Returns resumen (who they are) plus relevante (the pieces that answer `consulta`).",
    parameters: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "What the caller asked, TRANSLATED TO SPANISH — the chart is in Spanish and the " +
            "search matches against it (e.g. 'qué me indicó el doctor para el golpe en el ojo'). " +
            "Leave empty to just get the summary.",
        },
        documento: {
          type: "string",
          description: "ID number. Omit to use the caller buscar_paciente already identified.",
        },
      },
      required: [],
    },
  },
  {
    name: "medical_interactions",
    description:
      "Medications that are risky for glaucoma patients (American Academy of Ophthalmology " +
      "guidance). Call this whenever glaucoma is in play — the caller says they have it, or " +
      "obtener_contexto_paciente came back with glaucoma: true — AND any medication comes up: " +
      "something they take, something they just bought over the counter, something another " +
      "doctor started. Also call it if they ask 'can I take X?'. English, no translation needed.",
    parameters: {
      type: "object",
      properties: {
        medicamento: {
          type: "string",
          description:
            "The medication as the caller said it — brand name is fine (Benadryl, DayQuil, " +
            "Claritin, prednisone). Leave empty if they only described a symptom.",
        },
        consulta: {
          type: "string",
          description:
            "What they actually asked or described, if it adds anything ('I have a cold and my " +
            "eye hurts'). Optional.",
        },
      },
      required: [],
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
            fechaNacimiento: {
              type: "string",
              description: "Date of birth YYYY-MM-DD, if given. Fills Patient.birthDate.",
            },
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
  "Daponte Clinic, Dr. Daponte's office. Can I get your full name — " +
  "or your ID number, if you're already a patient with us?";

/** Full Settings payload for the Deepgram Voice Agent v1 WS
 * (wss://agent.deepgram.com/v1/agent/converse).
 * - listen nova-3 + language "en"
 * - think open_ai/gpt-4o-mini is Deepgram-hosted (no extra key needed)
 * - speak aura-2-thalia-en
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
