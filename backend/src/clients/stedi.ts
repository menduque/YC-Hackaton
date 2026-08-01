import { config } from "../config.js";
import {
  MOCK_REQUESTS,
  STEDI_ELIGIBILITY_ENDPOINT,
  getMockRequest,
  type EligibilityRequest,
  type MockRequest,
} from "../../../shared/stedi/mock-requests";
import {
  activeCoverage,
  collectAaaErrors,
  patientResponsibility,
  type AaaError,
  type EligibilityResponse,
} from "../../../shared/stedi/types";

/**
 * Stedi eligibility (X12 270/271). Runs just before the widget sets turno_deudor.
 * Handoff §5.
 *
 * TEST MODE ONLY. Stedi test keys accept only Stedi's own documented mock
 * requests — synthetic patients, nothing reaches a real payer, no charges. We
 * refuse to run with a key that isn't `test_`-prefixed, so a production key can
 * never push a synthetic patient into a live clearinghouse.
 *
 * Stedi is a US clearinghouse and this is an Argentine clinic, so the payer the
 * patient names ("OSDE", "Swiss Medical", …) is mapped onto a Stedi fixture.
 * The 270/271 round-trip is real; the payer identity is a stand-in.
 */

/** Argentine payer name (normalised) → Stedi mock fixture id. */
const PAYER_FIXTURES: Record<string, string> = {
  osde: "aetna",
  swissmedical: "cigna",
  swiss: "cigna",
  galeno: "unitedhealthcare",
  omint: "humana",
  medicus: "kaiser-ncal",
  medife: "ambetter",
  sancorsalud: "oscar-health-dependent",
  sancor: "oscar-health-dependent",
  premedic: "bcbstx-dependent",
  pami: "cms",
  particular: "unitedhealthcare-inactive",
  ninguna: "unitedhealthcare-inactive",
  sinobrasocial: "unitedhealthcare-inactive",
};

function normalise(payer: string): string {
  return payer
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Resolve a spoken payer name to a fixture, falling back to STEDI_TEST_PAYER_ID. */
export function resolveFixture(payer: string): { mock: MockRequest; matched: boolean } {
  const id = PAYER_FIXTURES[normalise(payer)];
  if (id) return { mock: getMockRequest(id), matched: true };

  const fallback = config.stedi.testPayerId || "aetna";
  const mock = MOCK_REQUESTS.find((m) => m.id === fallback) ?? MOCK_REQUESTS[0];
  return { mock, matched: false };
}

export interface CoverageResult {
  eligible: boolean;
  /** Short, speakable line for the voice agent. */
  summary: string;
  payerName: string;
  /** The Argentine payer the patient actually named. */
  requestedPayer: string;
  /** False when we fell back because the name wasn't in the mapping. */
  payerMatched: boolean;
  fixtureId: string;
  copays: { service: string; amount: string }[];
  deductibles: { period: string; network: string; amount: string }[];
  errors: AaaError[];
  traceId?: string;
  applicationMode?: string;
  raw?: EligibilityResponse;
}

export const stedi = {
  isConfigured: !!config.stedi.apiKey,

  async checkEligibility(args: {
    payer: string;
    nroAfiliado?: string;
    documento?: string;
  }): Promise<CoverageResult> {
    if (!this.isConfigured) {
      throw new Error("Stedi not configured (see SETUP.md §3)");
    }
    if (!config.stedi.apiKey.startsWith("test_")) {
      throw new Error(
        "STEDI_API_KEY is not a test-mode key. This path only sends synthetic " +
          "patients, so it refuses to talk to a production clearinghouse.",
      );
    }

    const { mock, matched } = resolveFixture(args.payer);

    // The member id / document the patient gives us are deliberately NOT sent:
    // test mode only answers for Stedi's own fixtures, and any other value comes
    // back as an AAA error. In production these would replace the fixture values.
    const request: EligibilityRequest = mock.request;

    const res = await fetch(STEDI_ELIGIBILITY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.stedi.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    const raw = (await res.json()) as EligibilityResponse & { message?: string };
    if (!res.ok) {
      throw new Error(raw.message ?? `Stedi returned ${res.status}`);
    }

    const errors = collectAaaErrors(raw);
    const active = activeCoverage(raw);
    const eligible = errors.length === 0 && active.length > 0;

    const responsibility = patientResponsibility(raw);
    const copays = responsibility
      .filter((b) => b.code === "B")
      .slice(0, 8)
      .map((b) => ({ service: b.serviceTypes?.[0] ?? "General", amount: b.benefitAmount ?? "" }));
    const deductibles = responsibility
      .filter((b) => b.code === "C")
      .slice(0, 8)
      .map((b) => ({
        period: b.timeQualifier ?? "",
        network: b.inPlanNetworkIndicator ?? "",
        amount: b.benefitAmount ?? "",
      }));

    return {
      eligible,
      summary: buildSummary({ eligible, errors, copays, requestedPayer: args.payer }),
      payerName: raw.payer?.name ?? mock.payerName,
      requestedPayer: args.payer,
      payerMatched: matched,
      fixtureId: mock.id,
      copays,
      deductibles,
      errors,
      traceId: raw.meta?.traceId,
      applicationMode: raw.meta?.applicationMode,
      raw,
    };
  },
};

/**
 * One Spanish sentence the agent can read out. Short on purpose — a voice agent
 * reciting a benefits table is unusable.
 */
function buildSummary(args: {
  eligible: boolean;
  errors: AaaError[];
  copays: { service: string; amount: string }[];
  requestedPayer: string;
}): string {
  if (args.errors.length > 0) {
    return `No pude verificar la cobertura de ${args.requestedPayer}: ${args.errors[0].description}. Lo confirma la recepción.`;
  }
  if (!args.eligible) {
    return `La cobertura de ${args.requestedPayer} figura inactiva. La recepción lo va a verificar.`;
  }
  const copay = args.copays[0];
  return copay
    ? `Cobertura activa con ${args.requestedPayer}. El copago de consulta es de $${copay.amount}.`
    : `Cobertura activa con ${args.requestedPayer}.`;
}
