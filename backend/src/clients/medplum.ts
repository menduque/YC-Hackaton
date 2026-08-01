import { MedplumClient } from "@medplum/core";
import type {
  Appointment,
  Communication,
  Condition,
  MedicationRequest,
  Patient,
} from "@medplum/fhirtypes";
import { config } from "../config.js";
import type { TurnoPayload } from "../types.js";

/**
 * MedPlum FHIR client. Reads Patient/Condition/MedicationRequest for context,
 * writes Appointment + Communication after the fill. Handoff §6.
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
   * Keyed on the national id (DNI), so calling twice with the same document
   * updates rather than duplicates.
   */
  async upsertPatient(paciente: TurnoPayload["paciente"]): Promise<Patient> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const existing = paciente.documento
      ? await mp.searchOne("Patient", { identifier: paciente.documento })
      : undefined;

    const draft: Patient = {
      ...existing,
      resourceType: "Patient",
      active: true,
      name: [{ use: "official", family: paciente.apellido, given: [paciente.nombre] }],
      birthDate: paciente.fechaNacimiento || existing?.birthDate,
      identifier: [
        {
          system: DOCUMENTO_SYSTEM,
          value: paciente.documento,
          type: { text: paciente.tipoDoc || "DNI" },
        },
      ],
      telecom: [
        ...(paciente.telefono ? [{ system: "phone" as const, value: paciente.telefono, use: "home" as const }] : []),
        ...(paciente.celular ? [{ system: "phone" as const, value: paciente.celular, use: "mobile" as const }] : []),
        ...(paciente.email ? [{ system: "email" as const, value: paciente.email }] : []),
      ],
      address: paciente.domicilio ? [{ text: paciente.domicilio }] : undefined,
    };
    // Don't file empty arrays — Medplum renders them as blank rows in the UI.
    if (!draft.telecom?.length) delete draft.telecom;

    return existing?.id
      ? mp.updateResource<Patient>({ ...draft, id: existing.id })
      : mp.createResource<Patient>(draft);
  },

  /**
   * Look a patient up by national id (DNI). Medplum stores it as a
   * Patient.identifier; we search on the value and take the first hit.
   */
  async getPatientContext(documento: string): Promise<PatientContext> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const patient = await mp.searchOne("Patient", { identifier: documento });
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
   * After the widget fills the form, record what happened: the Appointment and a
   * Communication carrying the clinical summary the agent wrote.
   *
   * Status is `proposed`, not `booked` — the front desk still has to press
   * Aceptar in Treelan. Nothing here may imply the appointment is confirmed
   * (handoff §9.12).
   */
  async writeAppointmentAndCommunication(args: {
    turno: TurnoPayload;
    patientId?: string;
    callId?: string;
  }): Promise<{ appointmentId: string; communicationId?: string }> {
    ensure(this.isConfigured);
    const mp = await getClient();

    const patientRef = args.patientId ? { reference: `Patient/${args.patientId}` } : undefined;
    const start = toInstant(args.turno.fecha, args.turno.hora);

    const appointment = await mp.createResource<Appointment>({
      resourceType: "Appointment",
      status: "proposed",
      description: args.turno.motivo ?? "Consulta",
      start,
      end: start ? new Date(new Date(start).getTime() + 30 * 60_000).toISOString() : undefined,
      comment: args.turno.comentarios,
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

    let communicationId: string | undefined;
    if (args.turno.comentarios) {
      const communication = await mp.createResource<Communication>({
        resourceType: "Communication",
        status: "completed",
        subject: patientRef,
        about: [{ reference: `Appointment/${appointment.id}` }],
        sent: new Date().toISOString(),
        payload: [{ contentString: args.turno.comentarios }],
        ...(args.callId
          ? { identifier: [{ system: "https://oido.ai/call-id", value: args.callId }] }
          : {}),
      });
      communicationId = communication.id;
    }

    return { appointmentId: appointment.id as string, communicationId };
  },
};

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

function ensure(ok: boolean): void {
  if (!ok) throw new Error("MedPlum not configured (see SETUP.md §2)");
}
