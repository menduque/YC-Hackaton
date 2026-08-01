import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

// `dotenv/config` only looks at process.cwd(), which is backend/ under
// `npm run dev`. Load backend/.env first (it wins), then fall back to the
// repo-root .env so scripts/, the app's Vite middleware and this server can all
// share one file.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../.env") });
dotenv.config({ path: resolve(here, "../../.env") });

/** One place that reads env. Nothing here throws — missing keys are reported, not fatal. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:8787",

  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY ?? "",
  },
  medplum: {
    baseUrl: process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/",
    clientId: process.env.MEDPLUM_CLIENT_ID ?? "",
    clientSecret: process.env.MEDPLUM_CLIENT_SECRET ?? "",
    projectId: process.env.MEDPLUM_PROJECT_ID ?? "",
  },
  stedi: {
    apiKey: process.env.STEDI_API_KEY ?? "",
    testPayerId: process.env.STEDI_TEST_PAYER_ID ?? "",
  },
  moss: {
    projectId: process.env.MOSS_PROJECT_ID ?? "",
    projectKey: process.env.MOSS_PROJECT_KEY ?? "",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
} as const;

/** Which vendors have enough config to be usable. Logged at boot. */
export function vendorStatus() {
  return {
    deepgram: !!config.deepgram.apiKey,
    medplum: !!(config.medplum.clientId && config.medplum.clientSecret),
    stedi: !!config.stedi.apiKey,
    moss: !!(config.moss.projectId && config.moss.projectKey),
    anthropic: !!config.anthropic.apiKey,
  };
}
