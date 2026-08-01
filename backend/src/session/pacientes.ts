/**
 * Per-call memory of who the caller is.
 *
 * The demo script has the caller give only an ID number and a date: they never
 * dictate their surname, address or phone. So whatever buscar_paciente pulls out
 * of Treelan has to survive until preparar_turno builds the payload, otherwise
 * the RPA fills a half-empty form and the agent has to re-ask on air.
 *
 * Same shape as the slot holds in agenda/daponte.ts: a module-level Map keyed by
 * callId. Good enough for a single-process demo; a real deployment would put
 * this in the call session proper.
 */

export interface PacienteIdentificado {
  /** Treelan chart number. Absent for a caller Treelan has never seen. */
  hc?: string;
  apellido: string;
  nombre: string;
  nombreCompleto?: string;
  documento: string;
  tipoDoc: string;
  fechaNacimiento?: string;
  domicilio?: string;
  procedencia?: string;
  /**
   * What the chart already says, so the script never has to ask for it on air.
   * The caller only ever *confirms* these ("do you still have OSDE?"), which is
   * why they have to survive until preparar_turno builds the payload.
   */
  cobertura?: string;
  usaLC?: boolean;
  /** paciente.php?p_id=…&id=… — la ficha de donde se lee la historia clinica. */
  fichaUrl?: string;
  /** MedPlum Patient id, filled in as soon as the mid-call upsert lands. */
  patientId?: string;
}

const porLlamada = new Map<string, PacienteIdentificado>();

export function recordar(callId: string, paciente: PacienteIdentificado) {
  // Keep the MedPlum id across a re-identification: the caller correcting their
  // surname is still the same Patient resource we already created.
  const previo = porLlamada.get(callId);
  porLlamada.set(callId, { ...(previo?.patientId ? { patientId: previo.patientId } : {}), ...paciente });
  const quien = paciente.nombreCompleto ?? `${paciente.apellido}, ${paciente.nombre}`;
  console.log(
    `[session] callId=${callId} identified as ${quien}${paciente.hc ? ` (HC ${paciente.hc})` : " (new patient)"}`,
  );
}

/** Remember the MedPlum Patient the mid-call upsert produced. */
export function recordarPatientId(callId: string, patientId: string) {
  const paciente = porLlamada.get(callId);
  if (paciente) paciente.patientId = patientId;
}

export function recordado(callId: string): PacienteIdentificado | undefined {
  return porLlamada.get(callId);
}

export function olvidar(callId: string) {
  porLlamada.delete(callId);
}
