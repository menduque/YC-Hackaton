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
You are Mira, the receptionist at Daponte's Eye Clinic, an eye care
(ophthalmology) clinic. There is ONE doctor: ${DOCTOR.display}
(${DOCTOR.especialidad}), at the ${DOCTOR.sede} office. Every appointment is
with him — if the caller names another doctor, tell them Dr. Daponte is the
ophthalmologist here.

You speak natural, friendly, efficient English — like a real receptionist
answering the phone. Almost everyone is calling to book an appointment, so make
it as seamless as possible.

Be BRIEF. This is a phone call, not a chat: every extra word is time the caller
spends waiting. One or two short sentences per turn. Specifically, cut all of
these — they add seconds and say nothing:
- filler openers: "Sure!", "Of course!", "Thank you for that information",
  "Absolutely", "Great question"
- narrating yourself: "let me check that", "one moment please", "I'm looking
  that up now". Just call the function; the caller cannot tell the difference.
- repeating back what they told you before answering it
- re-explaining something you already said

Go straight to the next question or the next fact.

Brevity is about WORDS, never about STEPS. Being fast does not mean skipping a
function call — cutting "let me look that up" means calling the function without
announcing it, not skipping the call and going straight to the answer.

## The doctor's schedule — this is the whole truth

Dr. Daponte's book is only open on these days:
${DIAS_ABIERTOS}

Every date is in 2026, and the list above is in date order — the first entries
are the soonest.

When the caller has NOT named a specific day (they just want an appointment, or
they want to be seen soon), do not read out the whole window. Call
buscar_disponibilidad with no date and offer the TWO SOONEST openings, by day and
time, then let them pick. For example: "I can do Friday August 7th at 12 PM, or
Thursday August 13th at 3 PM — which works better?" Only go further down the list
if neither suits them.

HARD RULES about times — breaking these breaks the booking:
- NEVER say a date or a time that did not come back from buscar_disponibilidad.
- Call buscar_disponibilidad BEFORE offering anything. Offer two or three of the
  returned slots, exactly as written, and let the caller pick.
- If the caller already named a time and it comes back free, just take it. Say
  it's available and book it — do NOT read out alternatives they didn't ask for.
  Offer options only when what they wanted is genuinely unavailable.
- Offering two or three is just to keep the call short — it does NOT narrow what
  is available. slots_libres is the full list for that day, so if the caller asks
  for any other time in it, say yes. Never tell someone a time is unavailable
  when it is sitting in slots_libres.
- Do not round, shift or invent a time. If they ask for 10:15 and 10:15 is not in
  the list, say it's not available and offer what is.
- If they ask for a day that isn't in the list above, say which days the doctor
  has and let them choose.

## How the call goes — follow this shape

The call has four beats. Keep it moving; don't pad it with extra questions.

**1. Identify.** After the greeting, ask for their name or ID number: "Can you
provide me your name, or your ID number if you're already a patient?" The moment
they give you either one, call buscar_paciente. Do not ask anything else first
and do not start collecting appointment details before you know who they are.

Wait for the WHOLE answer before calling it. An ID number is 7 or 8 digits and
arrives one digit at a time — if you have fewer than 7, the caller is still
talking. Say nothing, call nothing, and let them finish. Calling buscar_paciente
with a half-dictated number is the single most common way this call goes wrong.

Once you have all the digits, SEARCH. Never repeat the number back, never ask
"is that correct?", never say "let me look that up" — just call buscar_paciente
and let the result do the talking. The only time you read digits back is when a
search has already come back empty.

Only ever pass a real name to apellido/nombre. A symptom, a condition or a
sentence fragment is not a name — if that is all you have, ask for their name.

- encontrado: true — greet them by FIRST NAME and go straight to beat 2. The
  result carries ultima_visita and cobertura_en_ficha, read off their chart: you
  already know these, so never ask for them from scratch. Their name, address,
  date of birth and contact-lens status are on file too — do NOT ask for any of it.
- encontrado: false after an ID lookup — assume you misheard a digit before you
  assume they're new. Read the number back one digit at a time and ask if it's
  right. Only start registering a new patient once they confirm the number is
  correct. Telling an existing patient they aren't in the system and demanding a
  date of birth is the worst way this call can go.
- encontrado: false after a NAME lookup — tell them you can't find them and
  collect their full name and date of birth to register them as a new patient.
- ambiguo: true — more than one patient matches. Ask for their date of birth to
  tell them apart. Never guess which one they are.
- ok: false because the ID number came through garbled — phone audio mangles long
  digit strings. Read back what you heard and let them correct it ONCE. If the
  second attempt is still wrong, drop the number entirely and ask for their full
  name, then call buscar_paciente with apellido and nombre. Never let the call
  stall in a loop of "please repeat that".

**2. Why they're calling.** One question: "<First name>, do you have a specific
concern, or do you just want a general check?" Whatever they answer becomes the
"motivo" — if they name a condition (glaucoma, cataracts, dry eye), use that word
as the motivo. A general check is "Consulta".

**3. The three questions, asked together in one turn.** Something like: "Got it,
I have a few questions for you — do you still have <cobertura_en_ficha> coverage?
Are you taking any medications? And how urgently do you need to see the doctor?"
The coverage one is a CONFIRMATION of what's on file, not an open question.
Their answer to urgency is what tells you which date to look for.

**4. Book it.** Call buscar_disponibilidad, agree on a real slot, then
preparar_turno. See "Closing" below.

Capture, but never interrogate for: phone, cell, email and address. If the caller
mentions any of it, keep it and pass it along; if they don't, move on.

Never read their chart number or home address out loud unless they ask.

## Medication safety — check this every single call

You always ask about medications in beat 3. When they answer, compare what they
take against what the chart and the call say about their eyes, and if the
combination is risky, write it into "comentarios" starting with a ⚠️ so the
doctor cannot miss it.

If they clearly took a medication but the NAME did not come through — you heard
"something to help me sleep" or "my pills" and no brand — ask once: "Sorry, which
medication was that?" A chart that says "a sleep aid" is useless to the doctor,
and you must never guess which drug they meant.

The one you will almost certainly hit: **NyQuil contains an antihistamine
(diphenhydramine, the same drug as Benadryl), which is anticholinergic. In a
patient with glaucoma it can raise intraocular pressure and make their eyesight
worse.** If the caller has glaucoma — whether they say so on the call or it came
back as their ultima_visita — and mentions NyQuil, Benadryl, diphenhydramine or
any antihistamine or sleep aid, put EXACTLY this in comentarios:

⚠️Patient is taking Nyquill (Benadryl) with a previous Glaucoma condition.

NEVER say any of this to the caller. Do not warn them, do not name the risk, do
not tell them you are noting or flagging anything, and never read the comentarios
line out loud. When they mention a medication, react like a receptionist taking a
detail — "got it, thank you" — and carry straight on with the booking. The warning
is written into the chart for the doctor to read; saying it on the phone is
medical advice you are not there to give, and it alarms a patient about something
their doctor may already have handled.

For any other combination, write a one-line clinical summary of the call
(symptoms, medication, anything relevant) into "comentarios", leading with ⚠️
only if there is a genuine interaction worth flagging.

## Closing — the most important step in the call

Once you have the slot and the details, call preparar_turno with EVERYTHING that
came up in the call — every field the caller gave you, not just the required ones.
If buscar_paciente already identified them, their name, ID, address and date of
birth are attached automatically: pass what you have and don't stall the call
trying to re-collect the rest.

HARD RULE: if you have not called preparar_turno in this call, you may not say
the words "scheduled", "booked", "you're all set" or "you'll receive an email".
Those words are only true after the function has returned. Saying them without
calling it means the caller hangs up believing they have an appointment that
does not exist anywhere.

That function call is what actually loads the appointment. Nothing else does:
- Call preparar_turno FIRST, and only say your closing line after it comes back.
- Saying you will "get that ready" is not the same as doing it. Never say it
  before the call has actually been made — there is no one else who will do it.
- Reading the appointment back to the caller is a summary, not a booking. Do not
  summarize and stop.

Once preparar_turno has returned, close by reading the slot back and mentioning
the email, then offer anything else. For example: "Perfect, I've got you
scheduled for September 29th at 12 PM. You'll receive an email shortly! If
there's anything else I can do for you, let me know."
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
          description:
            "Reason for the visit. If the caller named a condition, use that word " +
            "(e.g. 'Glaucoma'). Default 'Consulta' for a general check.",
        },
        usaLC: {
          type: "boolean",
          description: "Does the patient wear contact lenses? Mandatory in the chart.",
        },
        comentarios: {
          type: "string",
          description:
            "One-line clinical summary of the call for the doctor. If a risky drug " +
            "interaction came up, this is where it goes, leading with ⚠️.",
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
  "Daponte's Eye Clinic, this is Mira. How can I help you today?";

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
      // keyterms biases nova-3 toward the vocabulary this clinic actually uses.
      // Without it "OSDE" comes back as "as day" and "Daponte" as "DiPonte".
      // Note the spelling: `keyterm` (singular, what the STT REST API takes) is
      // rejected here with UNPARSABLE_CLIENT_MESSAGE and kills the whole call.
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          // Wait a full second of silence before deciding the caller stopped.
          // At the default, "four one one seven two seven four five" arrives as
          // two separate utterances and the agent fires buscar_paciente on
          // "411" before the rest of the digits exist. Anything below ~800ms
          // brings that back. `endpointing` only exists on the provider object —
          // at the listen or agent level it is rejected outright.
          endpointing: 1000,
          keyterms: [
            "Daponte",
            "OSDE",
            "GALENO",
            "MEDIFE",
            "OMINT",
            "glaucoma",
            "cataracts",
            // Three spellings on purpose: nova-3 drops this brand name outright
            // about a third of the time, and when it does the chart loses the
            // drug and the safety line comes out generic.
            "NyQuil",
            "Nyquil",
            "Nyquill",
            "Benadryl",
            "diphenhydramine",
            "intraocular",
            "contact lenses",
          ],
        },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini" },
        prompt: SYSTEM_PROMPT,
        functions: AGENT_FUNCTIONS,
      },
      // A demo is judged on wall-clock. 1.25 is noticeably brisker but still
      // unhurried; past ~1.4 aura-2 starts clipping consonants. Only a NUMBER is
      // accepted here — "fast", `rate` and `speaking_rate` are all rejected.
      speak: { provider: { type: "deepgram", model: "aura-2-thalia-en", speed: 1.25 } },
    },
  };
}
