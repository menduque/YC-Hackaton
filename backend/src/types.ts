/** The single object everything converges on. See handoff §1. */
export interface TurnoPayload {
  fecha: string; // YYYY-MM-DD, confirmed against real availability
  hora: string; // HH:MM as in the Treelan grid
  doctor?: string; // Treelan's Profesional_Select label, e.g. "DAPONTE Franco"
  profesionalId?: string; // Treelan professional UUID (traceability; the RPA matches on the label)
  sede?: string; // "Montañeses"
  paciente: {
    apellido: string; // required in Treelan
    nombre: string; // required
    tipoDoc: "DNI" | "LC" | "LE" | "PAS" | string; // default DNI
    documento: string;
    fechaNacimiento?: string; // YYYY-MM-DD — only if volunteered; fills Patient.birthDate
    domicilio?: string;
    telefono?: string;
    celular?: string;
    email?: string;
  };
  cobertura?: string; // validated by Stedi before written (turno_deudor)
  motivo?: string; // matches EHR options; default "Consulta"
  usaLC?: boolean; // required in Treelan, but the front desk can fill it
  comentarios?: string; // clinical summary — same text goes to MedPlum Communication
  enviaRecordatorio?: boolean; // default true
}

/** Message pushed to the widget over the WS "pull" transport (handoff §2.C). */
export interface OidoScheduleMessage {
  type: "OIDO_SCHEDULE";
  callId: string;
  payload: TurnoPayload;
  lento?: boolean;
}

/** V2 per-field streaming message (handoff §7). */
export interface OidoFieldMessage {
  type: "field";
  callId: string;
  seq: number;
  field: string; // Treelan input name, e.g. "turno_nro_doc"
  value: string;
}
