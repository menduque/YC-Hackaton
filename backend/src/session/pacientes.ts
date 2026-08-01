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
  hc: string;
  apellido: string;
  nombre: string;
  nombreCompleto: string;
  documento: string;
  tipoDoc: string;
  fechaNacimiento?: string;
  domicilio?: string;
  procedencia?: string;
  /** paciente.php?p_id=…&id=… — la ficha de donde se lee la historia clinica. */
  fichaUrl?: string;
}

const porLlamada = new Map<string, PacienteIdentificado>();

export function recordar(callId: string, paciente: PacienteIdentificado) {
  porLlamada.set(callId, paciente);
  console.log(
    `[session] callId=${callId} identified as ${paciente.nombreCompleto} (HC ${paciente.hc})`,
  );
}

export function recordado(callId: string): PacienteIdentificado | undefined {
  return porLlamada.get(callId);
}

export function olvidar(callId: string) {
  porLlamada.delete(callId);
}
