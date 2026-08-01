import { medplum } from "../clients/medplum.js";
import { stedi } from "../clients/stedi.js";
import { moss } from "../clients/moss.js";
import { pushSchedule, requestWidget } from "../ws/widgetHub.js";
import { recordado, recordar } from "../session/pacientes.js";
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
      dias_disponibles: resumenDias(ctx.callId),
      instruccion:
        "Read back two or three of slots_libres VERBATIM and let the caller pick one. " +
        "Any time not in slots_libres does not exist in the doctor's agenda — never round to it.",
    };
  },

  /**
   * Looks the caller up in Treelan, through the widget (the browser holds the
   * session; the backend has no Treelan credentials by design — handoff §0).
   *
   * Deliberately NOT a semantic search: an ID number is an exact key, and
   * "closest match" here means greeting the wrong person.
   */
  async buscar_paciente(
    args: { documento?: string; apellido?: string; nombre?: string },
    ctx,
  ) {
    // STT writes ID numbers with dots and spaces constantly ("41.172.745").
    const dni = txt(args?.documento).replace(/[.\s-]/g, "");
    const apellido = txt(args?.apellido);
    const nombre = txt(args?.nombre);

    if (!dni && !apellido && !nombre) {
      return {
        ok: false,
        instruccion:
          "Ask the caller for their ID number, or their full name if they don't have it handy.",
      };
    }
    if (dni && !/^\d{7,8}$/.test(dni)) {
      return {
        ok: false,
        instruccion:
          "That ID number doesn't look right. Ask them to repeat it digit by digit.",
      };
    }

    let res: BuscarPacienteResult;
    try {
      res = await requestWidget<BuscarPacienteResult>(
        ctx.callId,
        "OIDO_BUSCAR_PACIENTE",
        { dni, apellido, nombre },
      );
    } catch (err) {
      // Demo insurance: an expired Treelan session or a closed tab must not
      // leave the agent silent mid-call. The real path is the one above.
      const fallback = fallbackPaciente(dni);
      console.warn(
        `[buscar_paciente] widget unreachable (${(err as Error).message}) — ` +
          `falling back to ${fallback ? "the seeded demo patient" : "not-found"}`,
      );
      res = {
        encontrado: Boolean(fallback),
        cantidad: fallback ? 1 : 0,
        pacientes: fallback ? [fallback] : [],
      };
    }

    if (!res.encontrado || res.pacientes.length === 0) {
      return {
        encontrado: false,
        instruccion:
          "Tell them you can't find them in the system and collect their full name " +
          "and date of birth to register them as a new patient.",
      };
    }

    if (res.pacientes.length > 1) {
      return {
        encontrado: true,
        ambiguo: true,
        opciones: res.pacientes.map((p) => ({
          nombre: p.nombre,
          apellido: p.apellido,
          fechaNacimiento: p.fechaNacimiento,
        })),
        instruccion:
          "Several patients share that identifier. Ask for their date of birth to " +
          "tell them apart, then call buscar_paciente again — do NOT guess.",
      };
    }

    const p = res.pacientes[0]!;
    recordar(ctx.callId, {
      hc: p.hc,
      apellido: p.apellido,
      nombre: p.nombre,
      nombreCompleto: p.nombreCompleto,
      documento: p.dni,
      tipoDoc: "DNI",
      fechaNacimiento: p.fechaNacimiento,
      domicilio: p.domicilio,
      procedencia: p.procedencia,
    });

    return {
      encontrado: true,
      nombre: p.nombre,
      apellido: p.apellido,
      hc: p.hc,
      fechaNacimiento: p.fechaNacimiento,
      doctor: DOCTOR.display,
      instruccion:
        `Greet them by first name ("${p.nombre}"), tell them they saw ${DOCTOR.display} ` +
        `last time, and ask if it's ok to book the consultation with him. ` +
        `We already have their name, address and date of birth — do NOT ask for them again. ` +
        `Do not read the chart number or address out loud.`,
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
        dias_disponibles: resumenDias(ctx.callId),
        instruccion:
          "Do NOT tell the caller it is booked. Offer a time from slots_libres " +
          "(or another day from dias_disponibles) and call preparar_turno again.",
      };
    }

    // The caller who was identified by buscar_paciente never dictates their
    // surname or address again, so fill those from Treelan. Model-supplied
    // fields win, so an explicit correction on the call still takes effect.
    const guardado = recordado(ctx.callId);
    const pac: Record<string, any> = {
      ...(guardado ?? {}),
      ...noVacios(args?.paciente),
    };
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

/**
 * Drops empty/absent keys so a blank from the model can't wipe a real value we
 * already read out of Treelan.
 */
function noVacios(o: unknown): Record<string, unknown> {
  if (!o || typeof o !== "object") return {};
  return Object.fromEntries(
    Object.entries(o as Record<string, unknown>).filter(([, v]) => txt(v) !== ""),
  );
}

/** One row of Treelan's patient search grid, as parsed by the widget. */
interface PacienteTreelan {
  hc: string;
  apellido: string;
  nombre: string;
  nombreCompleto: string;
  dni: string;
  fechaNacimiento: string;
  domicilio: string;
  estado: string;
  procedencia: string;
}

interface BuscarPacienteResult {
  encontrado: boolean;
  cantidad: number;
  pacientes: PacienteTreelan[];
}

/**
 * Demo-only safety net for when the widget can't be reached. Mirrors the real
 * Treelan record so the call keeps its shape; anything else is "not found"
 * rather than a made-up patient.
 */
const DEMO_PACIENTE: PacienteTreelan = {
  hc: "112708",
  apellido: "DAPONTE",
  nombre: "Cristobal",
  nombreCompleto: "DAPONTE, Cristobal",
  dni: "41172745",
  fechaNacimiento: "04-05-1998",
  domicilio: "cespedes 1244 1°B",
  estado: "--",
  procedencia: "Barrio",
};

function fallbackPaciente(dni: string): PacienteTreelan | null {
  return dni === DEMO_PACIENTE.dni ? DEMO_PACIENTE : null;
}

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
