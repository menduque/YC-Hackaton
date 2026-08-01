import { MedplumClient } from "@medplum/core";
import type {
  Appointment,
  Communication,
  Condition,
  ContactPoint,
  Identifier,
  MedicationRequest,
  Patient,
  Task,
} from "@medplum/fhirtypes";
import { config } from "../config.js";
import type { TurnoPayload } from "../types.js";

/**
 * MedPlum FHIR client — the system of record between the call and the RPA.
 *
 * The caller becomes a `Patient` as soon as buscar_paciente identifies them, so
 * a call that never reaches a booking still leaves a record. At booking time the
 * Patient/Appointment/Task are written FIRST, and the payload the widget fills
 * into Treelan is projected back out of the saved Patient (fhirPatientToTurno) —
 * that's what keeps the EHR form and the clinical record from drifting apart.
 *
 * Auth is headless client-credentials, so this needs a ClientApplication:
 * app.medplum.com > Admin > Project > Clients. (The `app/` SPA is different —
 * it does email/password login and needs no client id.)
 */

let clientPromise: Promise<MedplumClient> | undefined;

async function getClient(): Promise<MedplumClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mp = new MedplumClient({ baseUrl: config.medplum.baseUrl });
      await mp.startClientLogin(config.medplum.clientId, config.medplum.clientSecret);
      return mp;
    })();
  }
  return clientPromise;
}

export interface PatientContext {
  found: boolean;
  patient?: { id: string; nombre: string; apellido: string; fechaNacimiento?: string };
  conditions: string[];
  medications: string[];
  /** Short, speakable line for the agent. */
  summary: string;
}

/** The identifier system we file the national id (DNI) under. */
const DOCUMENTO_SYSTEM = "https://oido.ai/documento";
/** Treelan's chart number (HC) — the join key back into the EHR. */
const TREELAN_HC_SYSTEM = "https://oido.ai/treelan-hc";
/** Tags a resource with the voice call it came out of. */
const CALL_ID_SYSTEM = "https://oido.ai/call-id";

export const medplum = {
  isConfigured: !!(config.medplum.clientId && config.medplum.clientSecret),

  /** Open the client-credentials session early so it isn't paid for mid-call. */
  async warmUp(): Promise<void> {
    if (!this.isConfigured) return;
    await getClient();
  },

  /**
   * Create the caller as a `Patient` — or top up the one that's already there.
   * This is what makes them show up in the Patients tab at app.medplum.com.
   *
   * Called TWICE per call: once the moment buscar_paciente identifies them, and
   * again at preparar_turno with whatever else the conversation produced. That
   * second call is why every field here merges instead of overwriting — the
   * early call carries only {documento, apellido, nombre}, and a naive spread
   * would wipe the address and phone numbers a previous call had filed.
   */
  async upsertPatient(
    paciente: TurnoPayload["paciente"],
    opts: { patientId?: string; hc?: string } = {},
  ): Promise<Patient> {
    ensure(this.isConfigured);
    const mp = await getClient();

    // Prefer the id we already resolved earlier in this same call — it skips the
    // search round-trip, which matters because this now sits in front of the RPA.
    let existing: Patient | undefined;
    if (opts.patientId) {
      existing = await mp.readResource("Patient", opts.patientId).catch(() => undefined);
    }
    if (!existing && paciente.documento) {
      // Search `system|value`, never the bare value: a bare search matches that
      // number filed under ANY system (a payer member id, a chart number), which
      // silently merges two different people.
      existing = await mp.searchOne("Patient", {
        identifier: `${DOCUMENTO_SYSTEM}|${paciente.documento}`,
      });
    }

    const draft: Patient = { ...existing, resourceType: "Patient", active: true };

    const family = txt(paciente.apellido) || existing?.name?.[0]?.family;
    const given = txt(paciente.nombre) || existing?.name?.[0]?.given?.join(" ");
    if (family || given) {
      draft.name = [
        {
          use: "official",
          ...(family ? { family } : {}),
          ...(given ? { given: [given] } : {}),
        },
      ];
    }

    // Treelan hands back dd-mm-yyyy; FHIR only accepts yyyy-mm-dd and rejects the
    // whole resource otherwise, so an unparseable date is dropped rather than sent.
    const birthDate = toFhirDate(paciente.fechaNacimiento);
    if (birthDate) draft.birthDate = birthDate;

    draft.identifier = mergeIdentifiers(existing?.identifier, [
      ...(paciente.documento
        ? [
            {
              system: DOCUMENTO_SYSTEM,
              value: paciente.documento,
              type: { text: paciente.tipoDoc || "DNI" },
            },
          ]
        : []),
      ...(opts.hc ? [{ system: TREELAN_HC_SYSTEM, value: opts.hc }] : []),
    ]);

    draft.telecom = mergeTelecom(existing?.telecom, paciente);
    // Don't file empty arrays — Medplum renders them as blank rows in the UI.
    if (!draft.telecom?.length) delete draft.telecom;
    if (!draft.identifier?.length) delete draft.identifier;

    // Only when we actually have one: `address: undefined` on an update wipes it.
    if (txt(paciente.domicilio)) draft.address = [{ text: paciente.domicilio as string }];

    return existing?.id
      ? mp.updateResource<Patient>({ ...draft, id: existing.id })
      : mp.createResource<Patient>(draft);
  },

  /**
   * Project a saved FHIR Patient back down to the shape the Treelan RPA fills.
   *
   * This is the step that makes MedPlum the source rather than a mirror: what
   * goes into the EHR form is what we just persisted, not the model's raw output.
   * `fallback` covers fields FHIR doesn't round-trip cleanly.
   */
  fhirPatientToTurno(
    patient: Patient,
    fallback: TurnoPayload["paciente"],
  ): TurnoPayload["paciente"] {
    const name = patient.name?.[0];
    const doc = patient.identifier?.find((i) => i.system === DOCUMENTO_SYSTEM);
    const tel = (system: string, use?: string) =>
      patient.telecom?.find((t) => t.system === system && (!use || t.use === use))?.value;

    return {
      apellido: name?.family || fallback.apellido,
      nombre: name?.given?.join(" ") || fallback.nombre,
      tipoDoc: doc?.type?.text || fallback.tipoDoc || "DNI",
      documento: doc?.value || fallback.documento,
      ...opt("fechaNacimiento", patient.birthDate || fallback.fechaNacimiento),
      ...opt("domicilio", patient.address?.[0]?.text || fallback.domicilio),
      ...opt("telefono", tel("phone", "home") || fallback.telefono),
      ...opt("celular", tel("phone", "mobile") || fallback.celular),
      ...opt("email", tel("email") || fallback.email),
    };
  },

  /**
   * Look a patient up by national id (DNI). Medplum stores it as a
   * Patient.identifier; we search on the value and take the first hit.
   */
  async getPatientContext(documento: string): Promise<PatientContext> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const patient = await mp.searchOne("Patient", {
      identifier: `${DOCUMENTO_SYSTEM}|${documento}`,
    });
    if (!patient) {
      return {
        found: false,
        conditions: [],
        medications: [],
        summary: "Paciente nuevo — no tengo historia previa en el sistema.",
      };
    }

    const ref = `Patient/${patient.id}`;
    const [conditions, medications] = await Promise.all([
      mp.searchResources("Condition", { patient: ref, _count: "20" }),
      mp.searchResources("MedicationRequest", { patient: ref, status: "active", _count: "20" }),
    ]);

    const conditionNames = conditions.map(describeCondition).filter(Boolean) as string[];
    const medicationNames = medications.map(describeMedication).filter(Boolean) as string[];

    return {
      found: true,
      patient: {
        id: patient.id as string,
        nombre: patient.name?.[0]?.given?.join(" ") ?? "",
        apellido: patient.name?.[0]?.family ?? "",
        fechaNacimiento: patient.birthDate,
      },
      conditions: conditionNames,
      medications: medicationNames,
      summary: buildSummary(patient, conditionNames, medicationNames),
    };
  },

  /**
   * The appointment the call produced.
   *
   * Status is `proposed`, not `booked` — the front desk still has to press
   * Aceptar in Treelan. Nothing here may imply the appointment is confirmed
   * (handoff §9.12).
   */
  async createAppointment(args: {
    turno: TurnoPayload;
    patientId?: string;
    callId?: string;
  }): Promise<Appointment> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const patientRef = args.patientId ? { reference: `Patient/${args.patientId}` } : undefined;
    const start = toInstant(args.turno.fecha, args.turno.hora);

    return mp.createResource<Appointment>({
      resourceType: "Appointment",
      status: "proposed",
      description: args.turno.motivo ?? "Consulta",
      start,
      end: start ? new Date(new Date(start).getTime() + 30 * 60_000).toISOString() : undefined,
      comment: args.turno.comentarios,
      ...(args.callId
        ? { identifier: [{ system: CALL_ID_SYSTEM, value: args.callId }] }
        : {}),
      participant: [
        {
          status: "needs-action",
          actor: patientRef ?? {
            display: `${args.turno.paciente.apellido}, ${args.turno.paciente.nombre}`,
          },
        },
        ...(args.turno.doctor
          ? [{ status: "needs-action" as const, actor: { display: args.turno.doctor } }]
          : []),
      ],
    });
  },

  /**
   * The RPA job itself, as a FHIR resource. This is the queue item the browser
   * extension works off: `requested` when we hand it over, then `completed` or
   * `failed` once the widget reports back what happened on the Treelan page.
   *
   * A Task still sitting at `requested` means nobody picked the job up — which
   * is exactly what you want to see when the Chrome tab was closed.
   */
  async createBookingTask(args: {
    turno: TurnoPayload;
    appointmentId: string;
    patientId?: string;
    callId?: string;
  }): Promise<Task> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const { apellido, nombre } = args.turno.paciente;
    return mp.createResource<Task>({
      resourceType: "Task",
      status: "requested",
      intent: "order",
      description:
        `Fill Treelan booking — ${apellido}, ${nombre} · ` +
        `${args.turno.fecha} ${args.turno.hora}`,
      focus: { reference: `Appointment/${args.appointmentId}` },
      ...(args.patientId ? { for: { reference: `Patient/${args.patientId}` } } : {}),
      authoredOn: new Date().toISOString(),
      ...(args.callId
        ? { identifier: [{ system: CALL_ID_SYSTEM, value: args.callId }] }
        : {}),
    });
  },

  /** Close the loop: what the RPA actually managed to do on the Treelan page. */
  async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    note?: string,
  ): Promise<Task> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const task = await mp.readResource("Task", taskId);
    const now = new Date().toISOString();
    return mp.updateResource<Task>({
      ...task,
      status,
      lastModified: now,
      ...(note ? { note: [...(task.note ?? []), { text: note, time: now }] } : {}),
    });
  },

  /** The one-line clinical summary the agent wrote during the call. */
  async createCommunication(args: {
    turno: TurnoPayload;
    patientId?: string;
    appointmentId?: string;
    callId?: string;
  }): Promise<Communication | undefined> {
    ensure(this.isConfigured);
    if (!args.turno.comentarios) return undefined;
    const mp = await getClient();

    return mp.createResource<Communication>({
      resourceType: "Communication",
      status: "completed",
      subject: args.patientId ? { reference: `Patient/${args.patientId}` } : undefined,
      about: args.appointmentId ? [{ reference: `Appointment/${args.appointmentId}` }] : undefined,
      sent: new Date().toISOString(),
      payload: [{ contentString: args.turno.comentarios }],
      ...(args.callId
        ? { identifier: [{ system: CALL_ID_SYSTEM, value: args.callId }] }
        : {}),
    });
  },

  /** Appointment + Communication in one go. Kept for the vendortest harness. */
  async writeAppointmentAndCommunication(args: {
    turno: TurnoPayload;
    patientId?: string;
    callId?: string;
  }): Promise<{ appointmentId: string; communicationId?: string }> {
    const appointment = await this.createAppointment(args);
    const communication = await this.createCommunication({
      ...args,
      appointmentId: appointment.id,
    });
    return { appointmentId: appointment.id as string, communicationId: communication?.id };
  },
};

/** Replace an identifier with the same system, keep every other one. */
function mergeIdentifiers(
  existing: Identifier[] | undefined,
  incoming: Identifier[],
): Identifier[] {
  const out = [...(existing ?? [])];
  for (const inc of incoming) {
    const i = out.findIndex((e) => e.system === inc.system);
    if (i >= 0) out[i] = { ...out[i], ...inc };
    else out.push(inc);
  }
  return out;
}

/** Same idea for contact points, keyed on (system, use). Blanks never clobber. */
function mergeTelecom(
  existing: ContactPoint[] | undefined,
  paciente: TurnoPayload["paciente"],
): ContactPoint[] {
  const out = [...(existing ?? [])];
  const put = (system: ContactPoint["system"], use: ContactPoint["use"], value?: string) => {
    if (!txt(value)) return;
    const i = out.findIndex((t) => t.system === system && t.use === use);
    const entry: ContactPoint = { system, value: txt(value), ...(use ? { use } : {}) };
    if (i >= 0) out[i] = entry;
    else out.push(entry);
  };
  put("phone", "home", paciente.telefono);
  put("phone", "mobile", paciente.celular);
  put("email", undefined, paciente.email);
  return out;
}

function describeCondition(c: Condition): string | undefined {
  return c.code?.text ?? c.code?.coding?.[0]?.display;
}

function describeMedication(m: MedicationRequest): string | undefined {
  return m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display;
}

function buildSummary(patient: Patient, conditions: string[], medications: string[]): string {
  const name = patient.name?.[0]?.given?.[0] ?? "El paciente";
  const parts: string[] = [];
  if (conditions.length) parts.push(`antecedentes: ${conditions.slice(0, 3).join(", ")}`);
  if (medications.length) parts.push(`medicación activa: ${medications.slice(0, 3).join(", ")}`);
  return parts.length
    ? `${name} ya está en el sistema — ${parts.join("; ")}.`
    : `${name} ya está en el sistema, sin antecedentes cargados.`;
}

/** "2026-08-05" + "14:30" → ISO instant. Returns undefined if either is missing. */
function toInstant(fecha?: string, hora?: string): string | undefined {
  if (!fecha || !hora) return undefined;
  const d = new Date(`${fecha}T${hora.length === 5 ? hora : `${hora}:00`}:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * FHIR `date` is yyyy-mm-dd and the server rejects anything else. Treelan's grid
 * renders dd-mm-yyyy ("04-05-1998"), so accept both and drop what we can't read.
 */
function toFhirDate(raw?: string): string | undefined {
  const s = txt(raw);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

function ensure(ok: boolean): void {
  if (!ok) throw new Error("MedPlum not configured (see SETUP.md §2)");
}

const txt = (v: unknown) => String(v ?? "").trim();
const opt = (k: string, v: unknown) => (txt(v) ? { [k]: txt(v) } : {});
