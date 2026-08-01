/**
 * Deepgram Voice Agent configuration — sent as the `Settings` message when the
 * browser opens the WS. The "agent" is not created in a dashboard; it lives here.
 * See handoff §3.
 */

export const SYSTEM_PROMPT = `
You are the receptionist at Daponte Clinic, an eye care (ophthalmology) clinic.
You speak natural, friendly, efficient English — like a real receptionist
answering the phone. Almost everyone is calling to book an appointment, so make
it as seamless as possible and ask for as little as you can.

To book an appointment you only need FOUR things:
1. The caller's FULL NAME.
2. Their ID number (a national identification number). Read it back once to confirm.
3. Which doctor they want to see. If they already named a doctor or gave a reason,
   infer it — don't re-ask. The default doctor is Dr. Daponte.
4. A date and time. ALWAYS call buscar_disponibilidad first, then offer a couple
   of the open slots and let them pick. Never invent a time.

Style:
- Ask for the full name and ID number together, in one friendly ask.
- Figure out the doctor and the time naturally in the flow.
- Do NOT ask about insurance, address, phone, email, contact lenses, or the
  detailed reason unless the caller volunteers it — the front desk handles the
  rest. Keep the call short.
- When preparing the appointment, split the full name into last name and first name.
- Once you have name, ID, doctor, date and time, call preparar_turno to load it
  into the system for the front desk.
- NEVER say the appointment is confirmed. Close with: "Perfect, I'll get that
  ready and our front desk will confirm your appointment shortly."
`.trim();

/** Function declarations the agent can call. Handlers live in ../functions. */
export const AGENT_FUNCTIONS = [
  {
    name: "buscar_disponibilidad",
    description:
      "Get real open appointment slots for the eye doctor. Call this before offering any time.",
    parameters: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Requested date, YYYY-MM-DD" },
        franja: {
          type: "string",
          enum: ["morning", "afternoon", "any"],
        },
      },
      required: ["fecha"],
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
      "Load the appointment into the system WITHOUT confirming it (ready for the front desk to accept). Pass the full appointment details.",
    parameters: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Appointment date, YYYY-MM-DD" },
        hora: { type: "string", description: "Appointment time, HH:MM" },
        doctor: {
          type: "string",
          description: "Doctor the patient wants to see (default 'Daponte')",
        },
        paciente: {
          type: "object",
          description: "Patient identity",
          properties: {
            apellido: { type: "string", description: "Last name" },
            nombre: { type: "string", description: "First name(s)" },
            documento: { type: "string", description: "ID number" },
            tipoDoc: { type: "string", description: "ID type, default 'DNI'" },
          },
          required: ["apellido", "nombre", "documento"],
        },
        cobertura: { type: "string", description: "Insurance, only if volunteered" },
        motivo: { type: "string", description: "Reason, default 'Consulta'" },
        comentarios: { type: "string" },
      },
      required: ["fecha", "hora", "paciente"],
    },
  },
] as const;

export const GREETING = "Daponte Clinic, how can I help you?";

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
