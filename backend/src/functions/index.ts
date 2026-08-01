import { medplum } from "../clients/medplum.js";
import { stedi } from "../clients/stedi.js";
import { moss } from "../clients/moss.js";
import { pushSchedule } from "../ws/widgetHub.js";
import {
  DOCTOR,
  diaDeAgenda,
  estadoDeSlot,
  etiquetaDia,
  normalizarFecha,
  normalizarFranja,
  normalizarHora,
  reservar,
  resumenDias,
  slotsLibres,
} from "../agenda/daponte.js";
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
  /**
   * Dr. Daponte's real open slots (agenda/daponte.ts). Never invents a time:
   * if the requested day has no agenda, it answers with the days that do.
   */
  async buscar_disponibilidad(
    args: { fecha?: string; franja?: string },
    ctx,
  ) {
    const franja = normalizarFranja(args.franja);
    const fecha = normalizarFecha(args.fecha);
    const base = {
      doctor: DOCTOR.display,
      sede: DOCTOR.sede,
      franja,
    };

    if (!fecha || !diaDeAgenda(fecha)) {
      return {
        ...base,
        fecha: fecha ?? null,
        atiende: false,
        motivo: fecha
          ? `Dr. Daponte has no agenda on ${etiquetaDia(fecha)}.`
          : "No date understood.",
        dias_disponibles: resumenDias(ctx.callId),
        instruccion:
          "Tell the caller which of these days work and let them pick one. " +
          "Do NOT offer any time for a day that is not in dias_disponibles.",
      };
    }

    const libres = slotsLibres(fecha, franja, ctx.callId);
    if (!libres.length) {
      const otras = slotsLibres(fecha, "any", ctx.callId);
      return {
        ...base,
        fecha,
        dia: etiquetaDia(fecha),
        atiende: true,
        slots_libres: [],
        motivo: otras.length
          ? `Nothing left in the ${franja} on ${etiquetaDia(fecha)}.`
          : `${etiquetaDia(fecha)} is fully booked.`,
        slots_libres_otra_franja: otras,
        dias_disponibles: resumenDias(ctx.callId),
        instruccion:
          "Offer slots_libres_otra_franja, or another day from dias_disponibles. Never invent a time.",
      };
    }

    return {
      ...base,
      fecha,
      dia: etiquetaDia(fecha),
      atiende: true,
      slots_libres: libres,
      // Only OTHER days: listing this one again with a 3-slot preview next to
      // the full list is what made the agent treat the preview as the whole
      // day and refuse real slots.
      otros_dias: resumenDias(ctx.callId).filter((d) => d.fecha !== fecha),
      instruccion:
        `slots_libres is the COMPLETE list of open times on ${etiquetaDia(fecha)} — ` +
        `all ${libres.length} of them. Read back two or three VERBATIM so the caller has ` +
        "a choice, but if they ask for any other time in slots_libres, accept it: " +
        "the two or three you happened to mention are not the only ones available. " +
        "Only a time absent from slots_libres does not exist — never round to it.",
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

  /**
   * Builds the payload the widget RPA fills into Treelan. The slot is validated
   * against Dr. Daponte's agenda first — the widget aborts on a bad slot anyway,
   * and it's much better to catch it here, while the caller is still on the line.
   */
  async preparar_turno(args: any, ctx) {
    const fecha = normalizarFecha(args?.fecha);
    const hora = normalizarHora(args?.hora);

    if (!fecha || !hora) {
      return {
        ok: false,
        error: "Date or time not understood.",
        dias_disponibles: resumenDias(ctx.callId),
        instruccion:
          "Call buscar_disponibilidad and confirm a real slot with the caller before retrying.",
      };
    }

    const estado = estadoDeSlot(fecha, hora, ctx.callId);
    if (estado !== "libre") {
      const motivo = {
        "sin-agenda": `Dr. Daponte has no agenda on ${etiquetaDia(fecha)}.`,
        inexistente: `${hora} is not a slot in the ${etiquetaDia(fecha)} grid.`,
        ocupado: `${hora} on ${etiquetaDia(fecha)} is already taken.`,
        bloqueado: `${hora} on ${etiquetaDia(fecha)} is blocked.`,
        tomado: `${hora} on ${etiquetaDia(fecha)} was just taken.`,
      }[estado];
      return {
        ok: false,
        prepared: false,
        error: motivo,
        slots_libres: slotsLibres(fecha, "any", ctx.callId),
        otros_dias: resumenDias(ctx.callId).filter((d) => d.fecha !== fecha),
        instruccion:
          "Do NOT tell the caller it is booked. slots_libres is the complete list " +
          `of open times on ${etiquetaDia(fecha)} — offer any of them (or a day from ` +
          "otros_dias) and call preparar_turno again.",
      };
    }

    const pac = args?.paciente ?? {};
    const payload: TurnoPayload = {
      fecha,
      hora,
      doctor: DOCTOR.label,
      profesionalId: DOCTOR.profesionalId,
      sede: DOCTOR.sede,
      paciente: {
        apellido: txt(pac.apellido),
        nombre: txt(pac.nombre),
        tipoDoc: txt(pac.tipoDoc) || "DNI",
        documento: txt(pac.documento).replace(/[.\s]/g, ""),
        ...opt("domicilio", pac.domicilio),
        ...opt("telefono", pac.telefono),
        ...opt("celular", pac.celular),
        ...opt("email", pac.email?.toString().toLowerCase()),
      },
      ...opt("cobertura", args.cobertura),
      motivo: txt(args.motivo) || "Consulta",
      ...(typeof args.usaLC === "boolean" ? { usaLC: args.usaLC } : {}),
      ...opt("comentarios", args.comentarios),
      enviaRecordatorio: args.enviaRecordatorio !== false,
    };

    reservar(fecha, hora, ctx.callId);

    const delivered = pushSchedule({
      type: "OIDO_SCHEDULE",
      callId: ctx.callId,
      payload,
    });
    // Demo-friendly: the appointment is "prepared" in the system regardless of
    // whether the Treelan widget is currently connected.
    return {
      ok: true,
      prepared: true,
      delivered,
      turno: {
        doctor: DOCTOR.display,
        sede: DOCTOR.sede,
        dia: etiquetaDia(fecha),
        fecha,
        hora,
      },
      faltantes: faltantes(payload),
      note:
        delivered > 0
          ? "Appointment loaded into the EHR — ready for the front desk to confirm."
          : "Appointment prepared in the system — the front desk will confirm it shortly.",
      instruccion:
        "Never say the appointment is confirmed. Close with the front-desk line.",
    };
  },
};

const txt = (v: unknown) => String(v ?? "").trim();
const opt = (k: string, v: unknown) => (txt(v) ? { [k]: txt(v) } : {});

/** Fields Treelan requires that the call didn't produce — surfaced to the agent. */
function faltantes(p: TurnoPayload): string[] {
  const out: string[] = [];
  if (!p.paciente.apellido) out.push("last name");
  if (!p.paciente.nombre) out.push("first name");
  if (!p.paciente.documento) out.push("ID number");
  if (!p.cobertura) out.push("insurance");
  if (typeof p.usaLC !== "boolean") out.push("contact lenses (yes/no)");
  return out;
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
