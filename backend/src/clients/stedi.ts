import { config } from "../config.js";

/**
 * Stedi eligibility (X12 270/271). Runs just before the widget sets turno_deudor.
 * US-centric: map "OSDE" → a sandbox test payer. Handoff §5.
 *
 * TODO(keys): call the Stedi Eligibility API with STEDI_API_KEY + STEDI_TEST_PAYER_ID.
 */
export const stedi = {
  isConfigured: !!config.stedi.apiKey,

  async checkEligibility(_args: {
    payer: string;
    nroAfiliado?: string;
    documento?: string;
  }): Promise<{ eligible: boolean; raw?: unknown }> {
    if (!this.isConfigured) throw new Error("Stedi not configured (see SETUP.md §3)");
    throw new Error("stedi.checkEligibility not implemented yet — waiting on Stedi keys/impl");
  },
};
