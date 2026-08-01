import type { EligibilityRequest } from '../../../shared/stedi/mock-requests'
import type { EligibilityResponse } from '../../../shared/stedi/types'

// The response shape and the pure helpers over it live in shared/ so the
// backend voice agent and this bench read the same 271 the same way.
export type {
  AaaError,
  BenefitInformation,
  EligibilityEntity,
  EligibilityResponse,
} from '../../../shared/stedi/types'
export {
  activeCoverage,
  collectAaaErrors,
  describeBenefit,
  patientResponsibility,
} from '../../../shared/stedi/types'

/**
 * Runs an eligibility check through the dev proxy in `vite.config.ts`, which
 * attaches the test API key server-side. The key is never in the bundle.
 */
export async function checkEligibility(request: EligibilityRequest): Promise<EligibilityResponse> {
  const res = await fetch('/api/stedi/eligibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = (await res.json()) as EligibilityResponse & { message?: string }
  if (!res.ok) {
    throw new Error(body.message ?? `Stedi returned ${res.status}`)
  }
  return body
}
