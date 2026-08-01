import type {
  Coverage,
  CoverageEligibilityResponse,
  CoverageEligibilityResponseInsuranceItem,
  Organization,
  Patient,
} from '@medplum/fhirtypes'
import type { EligibilityRequest } from './mock-requests'
import type { BenefitInformation, EligibilityResponse } from './types'

/** Stedi returns `YYYYMMDD`; FHIR wants `YYYY-MM-DD`. */
function toFhirDate(yyyymmdd?: string): string | undefined {
  if (!yyyymmdd || yyyymmdd.length !== 8) return undefined
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function toFhirGender(code?: string): Patient['gender'] {
  if (code === 'M') return 'male'
  if (code === 'F') return 'female'
  return undefined
}

/**
 * X12 EB01 benefit codes -> the FHIR CoverageEligibilityResponse benefit slots
 * we care about. Anything else is carried through as a plain `name`.
 */
const BENEFIT_TYPE: Record<string, { code: string; display: string }> = {
  '1': { code: 'benefit', display: 'Active Coverage' },
  A: { code: 'copay-percent', display: 'Co-Insurance' },
  B: { code: 'copay', display: 'Co-Payment' },
  C: { code: 'deductible', display: 'Deductible' },
  G: { code: 'benefit', display: 'Out of Pocket (Stop Loss)' },
  I: { code: 'benefit', display: 'Non-Covered' },
}

/**
 * Builds the FHIR resources that represent one Stedi eligibility check.
 *
 * Returns unsaved resources with no `id` — feed them to
 * `medplum.createResource()` (or a transaction Bundle) to persist.
 */
export function eligibilityToFhir(
  request: EligibilityRequest,
  response: EligibilityResponse
): { patient: Patient; payer: Organization; coverage: Coverage; eligibility: CoverageEligibilityResponse } {
  // The patient is the dependent when one was sent, otherwise the subscriber.
  const dep = request.dependents?.[0]
  const respDep = response.dependents?.[0]
  const sub = response.subscriber

  const patient: Patient = {
    resourceType: 'Patient',
    name: [
      {
        given: [(dep?.firstName ?? respDep?.firstName ?? sub?.firstName ?? '').trim()].filter(
          Boolean
        ),
        family: dep?.lastName ?? respDep?.lastName ?? sub?.lastName,
      },
    ],
    birthDate: toFhirDate(dep?.dateOfBirth ?? respDep?.dateOfBirth ?? sub?.dateOfBirth),
    gender: toFhirGender(respDep?.gender ?? sub?.gender),
  }

  const payer: Organization = {
    resourceType: 'Organization',
    name: response.payer?.name,
    identifier: [
      {
        system: 'https://www.stedi.com/healthcare/payer-id',
        value: request.tradingPartnerServiceId,
      },
    ],
  }

  const coverage: Coverage = {
    resourceType: 'Coverage',
    status: 'active',
    beneficiary: { display: patient.name?.[0]?.family },
    subscriberId: response.subscriber?.memberId ?? request.subscriber.memberId,
    payor: [{ display: response.payer?.name }],
    relationship: dep
      ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: dep.individualRelationshipCode === '01' ? 'spouse' : 'child' }] }
      : { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: 'self' }] },
    class: response.plan?.groupNumber
      ? [
          {
            type: {
              coding: [
                { system: 'http://terminology.hl7.org/CodeSystem/coverage-class', code: 'group' },
              ],
            },
            value: response.plan.groupNumber,
          },
        ]
      : undefined,
  }

  const eligibility: CoverageEligibilityResponse = {
    resourceType: 'CoverageEligibilityResponse',
    status: 'active',
    purpose: ['benefits'],
    patient: { display: patient.name?.[0]?.family },
    created: new Date().toISOString(),
    request: { display: `Stedi trace ${response.meta?.traceId ?? 'unknown'}` },
    outcome: (response.errors?.length ?? 0) > 0 ? 'error' : 'complete',
    disposition: response.errors?.[0]?.description,
    insurer: { display: response.payer?.name },
    insurance: [
      {
        // Placeholder — callers replace this with a real Coverage reference
        // once the Coverage resource above has been persisted.
        coverage: { display: response.payer?.name },
        inforce: (response.benefitsInformation ?? []).some((b) => b.code === '1'),
        item: (response.benefitsInformation ?? [])
          .filter((b) => BENEFIT_TYPE[b.code ?? ''])
          .slice(0, 100)
          .map(toEligibilityItem),
      },
    ],
  }

  return { patient, payer, coverage, eligibility }
}

function toEligibilityItem(b: BenefitInformation): CoverageEligibilityResponseInsuranceItem {
  const type = BENEFIT_TYPE[b.code ?? '']
  const amount = b.benefitAmount ? Number.parseFloat(b.benefitAmount) : undefined
  return {
    category: b.serviceTypes?.length
      ? {
          coding: [
            {
              system: 'https://x12.org/codes/service-type-codes',
              code: b.serviceTypeCodes?.[0],
              display: b.serviceTypes[0],
            },
          ],
          text: b.serviceTypes[0],
        }
      : undefined,
    network: b.inPlanNetworkIndicator
      ? { text: b.inPlanNetworkIndicator }
      : undefined,
    unit: b.coverageLevel ? { text: b.coverageLevel } : undefined,
    term: b.timeQualifier ? { text: b.timeQualifier } : undefined,
    benefit: [
      {
        type: { coding: [{ code: type.code, display: type.display }], text: b.name ?? type.display },
        ...(amount !== undefined
          ? { allowedMoney: { value: amount, currency: 'USD' } }
          : b.benefitPercent
            ? { allowedString: `${Number.parseFloat(b.benefitPercent) * 100}%` }
            : {}),
      },
    ],
  }
}
