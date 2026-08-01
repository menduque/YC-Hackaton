import type { EligibilityRequest } from './mock-requests'

/**
 * A Stedi 271 eligibility response. Only the fields the demo reads are typed —
 * the payer returns a lot more (see `--raw` on scripts/stedi-eligibility.mjs).
 */
export interface EligibilityResponse {
  meta?: { applicationMode?: string; traceId?: string }
  controlNumber?: string
  tradingPartnerServiceId?: string
  payer?: { name?: string; payorIdentification?: string }
  provider?: { providerName?: string; npi?: string }
  subscriber?: EligibilityEntity
  dependents?: EligibilityEntity[]
  plan?: { planNumber?: string; groupNumber?: string }
  benefitsInformation?: BenefitInformation[]
  errors?: AaaError[]
}

export interface EligibilityEntity {
  memberId?: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  gender?: string
  aaaErrors?: AaaError[]
}

export interface AaaError {
  field?: string
  code?: string
  description?: string
  followupAction?: string
  location?: string
  possibleResolutions?: string
}

export interface BenefitInformation {
  code?: string
  name?: string
  serviceTypeCodes?: string[]
  serviceTypes?: string[]
  insuranceTypeCode?: string
  insuranceType?: string
  planCoverage?: string
  timeQualifierCode?: string
  timeQualifier?: string
  benefitAmount?: string
  benefitPercent?: string
  inPlanNetworkIndicatorCode?: string
  inPlanNetworkIndicator?: string
  coverageLevelCode?: string
  coverageLevel?: string
  benefitsDateInformation?: Record<string, string>
  additionalInformation?: { description?: string }[]
}

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

/**
 * Every AAA error anywhere in the response, flattened and de-duplicated.
 * Stedi surfaces the same error in both `errors` and the entity that caused it
 * (e.g. `subscriber.aaaErrors`), so a naive concat shows each one twice.
 */
export function collectAaaErrors(res: EligibilityResponse): AaaError[] {
  const all = [
    ...(res.errors ?? []),
    ...(res.subscriber?.aaaErrors ?? []),
    ...(res.dependents?.flatMap((d) => d.aaaErrors ?? []) ?? []),
  ]
  const seen = new Set<string>()
  return all.filter((e) => {
    const key = `${e.code}|${e.location}|${e.description}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Benefit lines that indicate active coverage (EB code `1`). */
export function activeCoverage(res: EligibilityResponse): BenefitInformation[] {
  return (res.benefitsInformation ?? []).filter((b) => b.code === '1')
}

/** Co-payment (`B`) and deductible (`C`) lines that carry a dollar amount. */
export function patientResponsibility(res: EligibilityResponse): BenefitInformation[] {
  return (res.benefitsInformation ?? []).filter(
    (b) => (b.code === 'B' || b.code === 'C') && b.benefitAmount
  )
}
