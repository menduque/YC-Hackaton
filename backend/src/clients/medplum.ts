import { config } from "../config.js";

/**
 * MedPlum FHIR client. Reads Patient/Condition/MedicationStatement for context,
 * writes Appointment + Communication after the fill. Handoff §6.
 *
 * TODO(keys): once MEDPLUM_CLIENT_ID/SECRET are set, wire @medplum/core:
 *   import { MedplumClient } from "@medplum/core";
 *   const mp = new MedplumClient({ baseUrl: config.medplum.baseUrl });
 *   await mp.startClientLogin(config.medplum.clientId, config.medplum.clientSecret);
 */
export const medplum = {
  isConfigured: !!(config.medplum.clientId && config.medplum.clientSecret),

  async getPatientContext(documento: string) {
    ensure(this.isConfigured);
    throw new NotWired("medplum.getPatientContext");
  },

  async writeAppointmentAndCommunication(_args: unknown) {
    ensure(this.isConfigured);
    throw new NotWired("medplum.writeAppointmentAndCommunication");
  },
};

class NotWired extends Error {
  constructor(what: string) {
    super(`${what} not implemented yet — waiting on MedPlum keys/impl`);
  }
}
function ensure(ok: boolean) {
  if (!ok) throw new Error("MedPlum not configured (see SETUP.md §2)");
}
