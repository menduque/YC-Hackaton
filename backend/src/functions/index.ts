import { medplum } from "../clients/medplum.js";
import { stedi } from "../clients/stedi.js";
import { moss } from "../clients/moss.js";
import { pushSchedule, requestWidget } from "../ws/widgetHub.js";
import { recordado, recordar, recordarPatientId } from "../session/pacientes.js";
import {
  consultarHistoria,
  guardarHistoria,
  hayHistoria,
  historiaDe,
  normalizarDoc,
  resumenHistoria,
} from "../session/historias.js";
import type { HistoriaTreelan } from "../session/historias.js";
import { FUENTE, buscarInteracciones, mencionaGlaucoma } from "../kb/glaucoma.js";
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
      // A number and nothing else: a dropped digit still looks like a valid ID,
      // so "not found" here is far more often a mishearing than a genuinely new
      // patient. Confirm the digits before sending them down the registration
      // path — that dead end is where the call stalls, demanding a date of birth
      // from someone who is already on file. No surname yet means there is also
      // nothing to open a chart with, so there is nothing to register.
      if (dni && !apellido) {
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
      // They gave a surname too, so this is a real miss rather than a misheard
      // digit — and that makes them exactly the caller who most needs a chart.
      // What they just dictated is enough to open one, so file it now rather
      // than at booking time.
      if (dni && apellido) {
        recordar(ctx.callId, { apellido, nombre, documento: dni, tipoDoc: "DNI" });
        registrarPacienteEnMedplum(ctx.callId, {
          apellido,
          nombre,
          tipoDoc: "DNI",
          documento: dni,
        });
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
      ultimaVisita: FICHA.ultimaVisita,
      cobertura: FICHA.cobertura,
      usaLC: FICHA.usaLC,
      fichaUrl: p.fichaUrl,
    });
    // Best data we'll ever have on this caller — surname, given name, DOB and
    // address straight off the chart rather than out of a speech transcript.
    registrarPacienteEnMedplum(
      ctx.callId,
      {
        apellido: p.apellido,
        nombre: p.nombre,
        tipoDoc: "DNI",
        documento: p.dni,
        ...opt("fechaNacimiento", p.fechaNacimiento),
        ...opt("domicilio", p.domicilio),
      },
      p.hc,
    );

    // La ficha completa (70 consultas) tarda ~1s en leerse e indexarse. Se
    // dispara acá y no se espera: para cuando el paciente pregunte algo de su
    // historia ya va a estar en Moss, y mientras tanto el agente saluda.
    void precargarHistoria(ctx.callId, p);

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

  /**
   * La historia clinica del que llama, leida de su ficha de Treelan e indexada
   * en Moss (session/historias.ts).
   *
   * Devuelve dos cosas distintas a propósito: `resumen` es quién es el paciente
   * — sale sin consultar nada — y `relevante` son los pedazos de la historia que
   * contestan lo que preguntó. Sin `consulta` no hay retrieval: si el agente
   * solo quiere orientarse, no hace falta pagar una búsqueda.
   */
  async obtener_contexto_paciente(
    args: { documento?: string; consulta?: string },
    ctx,
  ) {
    const guardado = recordado(ctx.callId);
    const documento = normalizarDoc(args?.documento) || guardado?.documento || "";
    if (!documento) {
      return {
        ok: false,
        instruccion:
          "You don't know who this is yet. Ask for their ID number and call buscar_paciente first.",
      };
    }

    // Si la precarga todavía no terminó (o el paciente se identificó antes de
    // que hubiera widget), leer la ficha ahora: es la última chance de tener
    // historia para esta pregunta.
    if (!hayHistoria(documento) && guardado?.fichaUrl) {
      await precargarHistoria(ctx.callId, {
        dni: documento,
        fichaUrl: guardado.fichaUrl,
        nombreCompleto: guardado.nombreCompleto,
      });
    }

    const historia = historiaDe(documento);
    const consulta = txt(args?.consulta);
    const [relevante, fhir] = await Promise.allSettled([
      consulta ? consultarHistoria(documento, consulta) : Promise.resolve([]),
      medplum.getPatientContext(documento),
    ]);

    // El agente no puede "detectar" glaucoma en un antecedente que nunca vio.
    // Si esta en la ficha, se lo decimos explicitamente junto con que hacer.
    const glaucoma = glaucomaEnHistoria(historia);

    return {
      ok: true,
      encontrado: Boolean(historia),
      glaucoma,
      resumen: historia ? resumenHistoria(historia) : null,
      relevante: relevante.status === "fulfilled" ? relevante.value : [],
      fhir: fhir.status === "fulfilled" ? fhir.value : null,
      instruccion: !historia
        ? "No chart loaded for this caller. Don't invent history — just book the appointment."
        : "The chart is in Spanish — answer the caller in English. Use it to sound like you " +
          "know them (their last visit, what the doctor indicated), one or two sentences max. " +
          "Never read the chart out loud, never quote chart numbers, and never give medical " +
          "advice or interpret findings: that is what the visit with Dr. Daponte is for." +
          (glaucoma
            ? " This patient HAS GLAUCOMA on their chart. If any medication comes up at all — " +
              "something they take, something they just bought over the counter, something " +
              "another doctor started them on — call medical_interactions with it."
            : ""),
    };
  },

  /**
   * Medicaciones riesgosas en glaucoma (kb/glaucoma.ts, indexado en Moss).
   *
   * Un glaucoma en la ficha mas un antihistaminico que el paciente menciona al
   * pasar es exactamente el cruce que nadie hace por telefono: la recepcion no
   * lee la historia y el paciente no sabe que preguntar. Esto NO le dice al
   * paciente que hacer con su medicacion — lo marca para el medico y lo deja
   * escrito en la ficha.
   */
  async medical_interactions(
    args: { medicamento?: string; consulta?: string },
    ctx,
  ) {
    const medicamento = txt(args?.medicamento);
    const consulta = [medicamento, txt(args?.consulta)].filter(Boolean).join(" ");
    if (!consulta) {
      return {
        ok: false,
        instruccion:
          "Ask which medication they mean — the brand name is fine (Benadryl, DayQuil, Claritin) — " +
          "and call this again.",
      };
    }

    const documento = recordado(ctx.callId)?.documento ?? "";
    const enHistoria = glaucomaEnHistoria(documento ? historiaDe(documento) : undefined);
    const hits = await buscarInteracciones(consulta, 4);

    return {
      ok: true,
      medicamento: medicamento || null,
      glaucoma_en_historia: enHistoria,
      hallazgos: hits,
      fuente: FUENTE,
      instruccion: !hits.length
        ? "Nothing on that one in the guidance. Say you don't have anything on it and that " +
          "Dr. Daponte can check it at the visit. Do NOT tell them it's safe."
        : "Say NOTHING about this to the caller — no heads-up, no mention that you are noting " +
          "it, nothing. Acknowledge the medication like any other detail ('got it, thank you') " +
          "and carry on with the booking. Put it in 'comentarios' when you call preparar_turno " +
          "so the doctor reads it before the visit — that note is the entire point, and it is " +
          "for the chart, not for the phone. NEVER tell them to start, stop or change a " +
          "medication, and never tell them a medication is safe. " +
          "The ONE exception, which they do need to hear: if the answer mentions warning signs " +
          "of an angle-closure attack (eye pain, halos, nausea, foggy vision) and the caller " +
          "has any of them, tell them to go to an emergency room now instead of waiting.",
    };
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
      motivo: MOTIVO,
      ...(typeof args.usaLC === "boolean"
        ? { usaLC: args.usaLC }
        : typeof guardado?.usaLC === "boolean"
          ? { usaLC: guardado.usaLC }
          : {}),
      ...opt("comentarios", avisoCanonico(txt(args.comentarios))),
      enviaRecordatorio: args.enviaRecordatorio !== false,
    };

    reservar(fecha, hora, ctx.callId);

    // MedPlum first, RPA second. The Patient, Appointment and Task are written
    // before the widget is handed anything, and the payload it fills into Treelan
    // is projected back out of the saved Patient — so the EHR form and the
    // clinical record cannot drift apart.
    //
    // That does put a FHIR round-trip in front of a live booking, so it's
    // bounded: if the write overruns (or MedPlum is down, or unconfigured) we
    // push the locally built payload and let the write finish in the background.
    // A vendor outage must never cost the caller their appointment.
    const fhir = await withTimeout(bookInMedplum(payload, ctx.callId), MEDPLUM_BOOKING_BUDGET_MS);

    const delivered = pushSchedule({
      type: "OIDO_SCHEDULE",
      callId: ctx.callId,
      payload: fhir.ok && fhir.paciente ? { ...payload, paciente: fhir.paciente } : payload,
      ...(fhir.ok
        ? {
            medplum: {
              patientId: fhir.patientId,
              appointmentId: fhir.appointmentId,
              taskId: fhir.taskId,
            },
          }
        : {}),
    });

    // Demo-friendly: the appointment is "prepared" in the system regardless of
    // whether the Treelan widget is currently connected.
    return {
      ok: true,
      prepared: true,
      delivered,
      // Ids only: the projected patient object goes to the widget, not into the
      // agent's context window where it's just tokens it might read out loud.
      medplum: fhir.ok
        ? {
            ok: true,
            patientId: fhir.patientId,
            appointmentId: fhir.appointmentId,
            taskId: fhir.taskId,
          }
        : fhir,
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
 * Does the chart say glaucoma? Looks at the antecedentes and at the diagnoses in
 * the recent consultations — Treelan writes it in either place.
 */
function glaucomaEnHistoria(historia?: HistoriaTreelan): boolean {
  if (!historia) return false;
  return (
    (historia.antecedentes ?? []).some((a) => mencionaGlaucoma(a.texto)) ||
    (historia.consultas ?? []).slice(0, 10).some((c) => mencionaGlaucoma(c.texto))
  );
}

/**
 * Reads the caller's chart out of Treelan and indexes it, so the voice agent can
 * retrieve from it mid-call. The browser does the reading — same as the patient
 * lookup, the Treelan session lives there and the backend has no credentials.
 *
 * Never throws: a chart that fails to load costs the agent some context, not the
 * call. Returns whether it landed, for the callers that want to know.
 */
async function precargarHistoria(
  callId: string,
  p: { dni: string; fichaUrl?: string; nombreCompleto?: string },
): Promise<boolean> {
  if (!p.fichaUrl) return false;
  try {
    // 20s: the chart is ~35k characters of ISO-8859-1 HTML and Treelan is not fast.
    const historia = await requestWidget<HistoriaTreelan>(
      callId,
      "OIDO_LEER_HISTORIA",
      { url: p.fichaUrl },
      20000,
    );
    const res = await guardarHistoria({
      ...historia,
      documento: normalizarDoc(historia?.documento) || p.dni,
    });
    console.log(
      `[historia] ${res.paciente || p.nombreCompleto} — ${res.consultas} consultas, ` +
        `${res.docs} docs → ${res.index}${res.moss ? " (Moss)" : " (sin Moss)"}`,
    );
    return true;
  } catch (err) {
    console.warn(`[historia] no se pudo cargar la ficha: ${(err as Error).message}`);
    return false;
  }
}

/**
 * How long preparar_turno will wait on MedPlum before handing the RPA the
 * locally built payload instead. Deliberately tight: by this point the Patient
 * already exists (Stage A, below), so this is an update against a known id plus
 * two creates — if that hasn't landed in 2.5s something is wrong with the vendor
 * and the caller shouldn't pay for it.
 */
const MEDPLUM_BOOKING_BUDGET_MS = 2500;

type BookingWrite =
  | {
      ok: true;
      patientId?: string;
      appointmentId?: string;
      taskId?: string;
      /** The Treelan payload rebuilt from what actually landed in MedPlum. */
      paciente?: TurnoPayload["paciente"];
    }
  | { ok: false; reason: string };

/**
 * Serializes the Patient writes belonging to one call.
 *
 * Stage A is fire-and-forget, so a caller who re-identifies just before booking
 * can still have that upsert in flight when preparar_turno starts its own. Both
 * would read the same version and the later write would silently drop whatever
 * the other added — a mobile number given on the call, say. Chaining per callId
 * costs nothing (in practice these are seconds apart) and closes the window.
 */
const cadenaPorLlamada = new Map<string, Promise<unknown>>();

function enCola<T>(callId: string, fn: () => Promise<T>): Promise<T> {
  // `previa` is always already-caught, so a failed write never blocks the next.
  const previa = cadenaPorLlamada.get(callId) ?? Promise.resolve();
  const siguiente = previa.then(fn);
  const marca = siguiente.catch(() => undefined);
  cadenaPorLlamada.set(callId, marca);
  // Don't let the map grow for the life of the process.
  void marca.then(() => {
    if (cadenaPorLlamada.get(callId) === marca) cadenaPorLlamada.delete(callId);
  });
  return siguiente;
}

/**
 * Stage A — file the caller in MedPlum the moment we know who they are, rather
 * than waiting for them to pick a slot.
 *
 * Fire-and-forget on purpose: the agent's next sentence must not wait on a FHIR
 * round-trip. Two payoffs. A caller who hangs up after giving their ID number
 * still leaves a Patient behind, which is the whole point. And preparar_turno
 * then updates a known id instead of searching for one, which is what keeps
 * MedPlum off the RPA's critical path.
 */
function registrarPacienteEnMedplum(
  callId: string,
  paciente: TurnoPayload["paciente"],
  hc?: string,
) {
  if (!medplum.isConfigured) return;
  // A bare ID number with no surname isn't a person yet — let preparar_turno
  // file them once the call has produced a name.
  if (!paciente.documento || !paciente.apellido) return;

  void enCola(callId, () =>
    medplum.upsertPatient(paciente, { patientId: recordado(callId)?.patientId, hc }),
  )
    .then((p) => {
      if (p.id) recordarPatientId(callId, p.id);
      console.log(`[medplum] Patient/${p.id} filed mid-call (doc ${paciente.documento})`);
    })
    .catch((err) =>
      console.error("[medplum] mid-call upsert failed:", (err as Error).message),
    );
}

/**
 * Stage B — Patient → Appointment → Task, in that order, before the RPA sees
 * anything. Never throws: a vendor outage must not take down a live call, so
 * failures are logged and reported back to the agent as `{ ok: false }`.
 */
async function bookInMedplum(turno: TurnoPayload, callId: string): Promise<BookingWrite> {
  if (!medplum.isConfigured) return { ok: false, reason: "MedPlum not configured" };
  try {
    // Queued behind any Stage A upsert still in flight, and reading the session
    // inside the closure so it picks up the patientId that one just filed.
    const patient = await enCola(callId, () =>
      medplum.upsertPatient(turno.paciente, {
        patientId: recordado(callId)?.patientId,
        hc: recordado(callId)?.hc,
      }),
    );
    if (patient.id) recordarPatientId(callId, patient.id);
    console.log(
      `[medplum] Patient/${patient.id} ${turno.paciente.apellido}, ${turno.paciente.nombre} (doc ${turno.paciente.documento})`,
    );

    const appointment = await medplum.createAppointment({
      turno,
      patientId: patient.id,
      callId,
    });
    console.log(`[medplum] Appointment/${appointment.id} status=proposed`);

    const task = await medplum.createBookingTask({
      turno,
      appointmentId: appointment.id as string,
      patientId: patient.id,
      callId,
    });
    console.log(`[medplum] Task/${task.id} status=requested`);

    // The clinical summary isn't needed to fill the Treelan form, so it stays off
    // the critical path where it can't eat into the booking budget.
    void medplum
      .createCommunication({
        turno,
        patientId: patient.id,
        appointmentId: appointment.id,
        callId,
      })
      .catch((err) =>
        console.error("[medplum] Communication failed:", (err as Error).message),
      );

    return {
      ok: true,
      patientId: patient.id,
      appointmentId: appointment.id,
      taskId: task.id,
      paciente: medplum.fhirPatientToTurno(patient, turno.paciente),
    };
  } catch (err) {
    console.error("[medplum] booking write failed:", (err as Error).message);
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

/**
 * DEMO: the motivo is hardcoded. Mira no longer asks "do you have a specific
 * concern?", so nothing in the call reliably produces one — the model kept
 * falling back to a generic "Consulta". Pinning it means the Treelan form always
 * reads the same, whatever the caller says.
 *
 * This IGNORES what the caller actually came in for. Read `comentarios` for
 * that. Wire it back to the conversation before this is in front of a patient.
 */
const MOTIVO = "Glaucoma";

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
  /** `paciente.php?p_id=…&id=…`, sacada del onclick de la fila. Puede faltar. */
  fichaUrl?: string;
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
  fichaUrl: "paciente.php?p_id=3338b906-1c64-11e6-9f15-94de80a26d48&id=112708",
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
