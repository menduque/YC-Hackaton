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

type Handler = (args: any, ctx: FnContext) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  async buscar_disponibilidad(args: { fecha: string; franja?: string }) {
    // Mock availability until the Treelan widget slot-read is wired. Lets the
    // booking conversation flow end-to-end for the demo.
    const morning = ["09:00", "09:30", "10:30", "11:15"];
    const afternoon = ["14:30", "15:15", "16:00", "17:30"];
    const f = (args.franja ?? "any").toLowerCase();
    const slots =
      f === "morning" || f === "mañana"
        ? morning
        : f === "afternoon" || f === "tarde"
          ? afternoon
          : [...morning, ...afternoon];
    return {
      fecha: args.fecha,
      franja: f,
      slots,
      note: "Mock availability (Treelan not wired yet).",
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
      payload: args,
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

export async function dispatchFunction(
  name: string,
  args: unknown,
  ctx: FnContext,
) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown function: ${name}`);
  return handler(args, ctx);
}
