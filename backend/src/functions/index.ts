import { medplum } from "../clients/medplum.js";
import { stedi } from "../clients/stedi.js";
import { moss } from "../clients/moss.js";
import { pushSchedule } from "../ws/widgetHub.js";
import type { TurnoPayload } from "../types.js";

/**
 * Handlers for the Deepgram agent functions (agentConfig.ts). Each returns a
 * plain object that gets sent back to the agent as the FunctionCallResponse.
 *
 * These are stubs wired to the vendor clients — they'll throw a clear message
 * until each vendor is implemented. `preparar_turno` already works end-to-end:
 * it just pushes the payload to the connected widget.
 */

export interface FnContext {
  callId: string;
}

/** The one slot known to exist in Daponte's real Treelan agenda — same
 * date/time as widget/payload.example.json. Keeps the mock availability the
 * agent offers in sync with what the RPA can actually click. */
const DEMO_SLOT = { fecha: "2026-09-29", hora: "12:00" };

type Handler = (args: any, ctx: FnContext) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  async buscar_disponibilidad(args: { fecha: string; franja?: string }) {
    // Mock availability until the Treelan slot-read is wired. The slots the
    // agent offers here are what the RPA later tries to click in the real
    // calendar, so an invented time makes the widget abort with "horario
    // ocupado o inexistente". DEMO_SLOT is the date/time shipped in
    // widget/payload.example.json — the one known to exist in Daponte's agenda.
    const morning = ["09:00", "09:30", "10:30", "11:15"];
    const afternoon = ["14:30", "15:15", "16:00", "17:30"];
    const f = (args.franja ?? "any").toLowerCase();
    let slots =
      f === "morning" || f === "mañana"
        ? morning
        : f === "afternoon" || f === "tarde"
          ? afternoon
          : [...morning, ...afternoon];

    if (args.fecha === DEMO_SLOT.fecha) {
      // Offer the known-good time first so the agent lands on it.
      slots = [DEMO_SLOT.hora, ...slots.filter((s) => s !== DEMO_SLOT.hora)];
    }

    return {
      fecha: args.fecha,
      franja: f,
      slots,
      note: "Mock availability (Treelan slot-read not wired yet).",
    };
  },

  async obtener_contexto_paciente(args: { documento: string }) {
    const [history, fhir] = await Promise.allSettled([
      moss.retrieve(`historia paciente documento ${args.documento}`),
      medplum.getPatientContext(args.documento),
    ]);
    return { history, fhir };
  },

  async investigar_problema(args: { sintoma: string; contexto?: string }) {
    const hits = await moss.retrieve(`${args.sintoma} ${args.contexto ?? ""}`);
    // TODO: synthesize with Claude grounded on `hits`.
    return { hits };
  },

  async verificar_cobertura(args: {
    payer: string;
    nro_afiliado?: string;
    documento?: string;
  }) {
    return stedi.checkEligibility({
      payer: args.payer,
      nroAfiliado: args.nro_afiliado,
      documento: args.documento,
    });
  },

  async preparar_turno(args: TurnoPayload, ctx) {
    const delivered = pushSchedule({
      type: "OIDO_SCHEDULE",
      callId: ctx.callId,
      payload: normalizeTurno(args),
    });
    // Demo-friendly: the appointment is "prepared" in the system regardless of
    // whether the Treelan widget is currently connected.
    return {
      ok: true,
      prepared: true,
      delivered,
      note:
        delivered > 0
          ? "Appointment loaded into the EHR — ready for the front desk to confirm."
          : "Appointment prepared in the system — the front desk will confirm it shortly.",
    };
  },
};

/**
 * The agent is told to keep the call short, so it never dictates the fields
 * Treelan still requires. Fill in the defaults the function schema already
 * documents (`tipoDoc`, `motivo`) plus `usaLC`, which the prompt explicitly
 * forbids asking about — without it the widget leaves the radio red and stalls
 * on "es obligatorio en Treelan". `cobertura` is deliberately NOT defaulted:
 * if the caller didn't volunteer an insurer, a red field is the honest state
 * for the front desk to resolve.
 */
function normalizeTurno(p: TurnoPayload): TurnoPayload {
  return {
    ...p,
    motivo: p.motivo ?? "Consulta",
    usaLC: typeof p.usaLC === "boolean" ? p.usaLC : false,
    paciente: { ...p.paciente, tipoDoc: p.paciente?.tipoDoc ?? "DNI" },
  };
}

export async function dispatchFunction(
  name: string,
  args: unknown,
  ctx: FnContext,
) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown function: ${name}`);
  return handler(args, ctx);
}
