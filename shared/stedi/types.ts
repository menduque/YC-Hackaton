// Shape of a Stedi 271 eligibility response, plus pure helpers over it.
// No I/O and no browser/Node specifics — imported by both `app/` and `backend/`.

/**
 * Only the fields we read are typed; the payer returns a lot more
 * (see `npm run stedi -- <id> --raw`).
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

/** A payer's 271 is hundreds of coded rows — flatten one into a readable sentence. */
export function describeBenefit(b: BenefitInformation): string {
  const parts = [b.name ?? 'Benefit']
  if (b.benefitAmount) parts.push(`$${b.benefitAmount}`)
  if (b.benefitPercent) parts.push(`${Number.parseFloat(b.benefitPercent) * 100}%`)
  if (b.serviceTypes?.length) parts.push(`for ${b.serviceTypes.join(', ')}`)
  if (b.inPlanNetworkIndicator) parts.push(`in-network: ${b.inPlanNetworkIndicator}`)
  if (b.coverageLevel) parts.push(`coverage level: ${b.coverageLevel}`)
  if (b.timeQualifier) parts.push(`period: ${b.timeQualifier}`)
  if (b.insuranceType) parts.push(`plan: ${b.insuranceType}`)
  for (const info of b.additionalInformation ?? []) {
    if (info.description) parts.push(info.description)
  }
  return parts.join(' · ')
}
