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
    // Speech-to-text duplicates digits in long spoken numbers surprisingly often
    // ("4 1 1 7 2 7 4 5" has come back as 411727445 and 4117272745). Bouncing the
    // caller more than once over it is worse than just taking their name.
    if (dni && !/^\d{7,8}$/.test(dni)) {
      return {
        ok: false,
        digitos_recibidos: dni.length,
        instruccion:
          `You heard ${dni.length} digits and an ID number has 7 or 8, so it was probably ` +
          "misheard. Read back what you have digit by digit and ask them to correct it. " +
          "If the next attempt is still wrong, stop asking for the number — ask for their " +
          "full name instead and call buscar_paciente with apellido and nombre.",
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
      // A dropped digit still looks like a valid ID, so "not found" is far more
      // often a mishearing than a genuinely new patient. Confirm the number
      // before sending them down the registration path — that dead end is where
      // the call stalls, demanding a date of birth from someone already on file.
      if (dni) {
        return {
          encontrado: false,
          documento_buscado: dni,
          instruccion:
            `Nothing matched ${dni}. Do NOT say they aren't in the system yet and do ` +
            `NOT start registering them. Read the number back one digit at a time — ` +
            `"${dni.split("").join(" ")}" — and ask if that's right. If they correct it, ` +
            `call buscar_paciente again with the corrected number. Only if they confirm ` +
            `it IS correct should you collect their full name and date of birth as a new patient.`,
        };
      }
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
      cobertura: FICHA.cobertura,
      usaLC: FICHA.usaLC,
    });

    return {
      encontrado: true,
      nombre: p.nombre,
      apellido: p.apellido,
      hc: p.hc,
      fechaNacimiento: p.fechaNacimiento,
      doctor: DOCTOR.display,
      // Read off the chart the widget just opened. The caller confirms these
      // rather than dictating them, which is what keeps the call short.
      ultima_visita: FICHA.ultimaVisita,
      cobertura_en_ficha: FICHA.cobertura,
      instruccion:
        `Greet them by FIRST NAME ("${p.nombre}") and go straight to why they're calling: ` +
        `ask whether they have a specific concern or just want a general check. ` +
        `Their last visit was for ${FICHA.ultimaVisita} and the chart has ${FICHA.cobertura} ` +
        `on file — confirm the coverage later ("do you still have ${FICHA.cobertura}?"), ` +
        `never ask for it from scratch. We already have their name, address, date of birth ` +
        `and contact-lens status — do NOT ask for any of it. ` +
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
        otros_dias: resumenDias(ctx.callId).filter((d) => d.fecha !== fecha),
        instruccion:
          "Do NOT tell the caller it is booked. slots_libres is the complete list " +
          `of open times on ${etiquetaDia(fecha)} — offer any of them (or a day from ` +
          "otros_dias) and call preparar_turno again.",
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
      // Chart values are the fallback, never the override: if the caller
      // corrected their coverage on the call, what they said wins.
      ...opt("cobertura", args.cobertura || guardado?.cobertura),
      motivo: txt(args.motivo) || "Consulta",
      ...(typeof args.usaLC === "boolean"
        ? { usaLC: args.usaLC }
        : typeof guardado?.usaLC === "boolean"
          ? { usaLC: guardado.usaLC }
          : {}),
      ...opt("comentarios", avisoCanonico(txt(args.comentarios))),
      enviaRecordatorio: args.enviaRecordatorio !== false,
    };

    reservar(fecha, hora, ctx.callId);

    const delivered = pushSchedule({
      type: "OIDO_SCHEDULE",
      callId: ctx.callId,
      payload,
    });

    // Record the caller in MedPlum: the Patient first (that's what shows up in
    // the Patients tab), then the Appointment hanging off it — `proposed`, never
    // `booked`. Bounded so a slow FHIR write can't stall the conversation; if it
    // overruns, the write still lands, we just stop waiting on it.
    const fhir = await withTimeout(recordInMedplum(payload, ctx.callId), 6000);

    // Demo-friendly: the appointment is "prepared" in the system regardless of
    // whether the Treelan widget is currently connected.
    return {
      ok: true,
      prepared: true,
      delivered,
      medplum: fhir,
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

/**
 * Patient + Appointment (+ Communication) in MedPlum. Never throws — a vendor
 * outage must not take down a live call, so failures are logged and reported
 * back to the agent as `{ ok: false }`.
 */
async function recordInMedplum(turno: TurnoPayload, callId: string) {
  if (!medplum.isConfigured) return { ok: false, reason: "MedPlum not configured" };
  try {
    const patient = await medplum.upsertPatient(turno.paciente);
    console.log(
      `[medplum] Patient/${patient.id} ${turno.paciente.apellido}, ${turno.paciente.nombre} (doc ${turno.paciente.documento})`,
    );

    const { appointmentId } = await medplum.writeAppointmentAndCommunication({
      turno,
      patientId: patient.id,
      callId,
    });
    console.log(`[medplum] Appointment/${appointmentId} status=proposed`);

    return { ok: true, patientId: patient.id, appointmentId };
  } catch (err) {
    console.error("[medplum] write failed:", (err as Error).message);
    return { ok: false, reason: (err as Error).message };
  }
}

/** Resolve with a marker instead of hanging the agent's function call forever. */
function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([
    p,
    new Promise<{ ok: false; reason: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, reason: "still writing" }), ms).unref(),
    ),
  ]);
}

/**
 * The interaction warning is a specified string, but the model paraphrases it
 * every run ("NyQuil" vs "Nyquill", a stray space after the emoji, sometimes a
 * whole extra sentence). When what it wrote is about this combination, pin it to
 * the exact wording the chart is supposed to carry. Anything else is left alone.
 */
const AVISO_NYQUIL_GLAUCOMA =
  "⚠️Patient is taking Nyquill (Benadryl) with a previous Glaucoma condition.";

function avisoCanonico(comentarios: string): string {
  if (!comentarios) return comentarios;
  const s = comentarios.toLowerCase();
  const droga = /nyquil|nyquill|benadryl|diphenhydramine|antihistamine/.test(s);
  return droga && s.includes("glaucoma") ? AVISO_NYQUIL_GLAUCOMA : comentarios;
}

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
/**
 * What the medical record says once the widget opens it. Hardcoded for the demo
 * — Treelan's chart page isn't parsed yet, so this is the one place to change
 * when it is. Everything the agent claims to already know comes from here.
 */
const FICHA = {
  ultimaVisita: "Glaucoma",
  cobertura: "OSDE",
  usaLC: false,
} as const;

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
