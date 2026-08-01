import { describeBenefit } from '../../../shared/stedi/types'
import type { EligibilityResponse } from '../../../shared/stedi/types'

/**
 * Moss (https://moss.dev) — hybrid semantic search with sub-10ms queries.
 *
 * `@moss-dev/moss` depends on `@moss-dev/moss-core`, which ships native Node
 * addons (`.node`), so it cannot run in the browser bundle. The client talks to
 * the Moss endpoints in `app/vite.config.ts` instead, which run it in Node.
 */

export interface MossDoc {
  id: string
  text: string
  metadata?: Record<string, string>
}

export interface MossHit {
  id: string
  text: string
  score: number
  metadata?: Record<string, string>
}

/** A payer's 271 is hundreds of coded rows — flatten each into one searchable sentence. */
export function benefitsToDocuments(response: EligibilityResponse): MossDoc[] {
  return (response.benefitsInformation ?? []).map((b, i) => ({
    id: `benefit-${i}`,
    text: describeBenefit(b),
    metadata: {
      code: b.code ?? '',
      name: b.name ?? '',
      service: b.serviceTypes?.[0] ?? '',
      network: b.inPlanNetworkIndicator ?? '',
      amount: b.benefitAmount ?? '',
    },
  }))
}

/** Builds (or rebuilds) a Moss index for one eligibility response. */
export async function indexBenefits(indexName: string, docs: MossDoc[]): Promise<void> {
  const res = await fetch('/api/moss/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexName, docs }),
  })
  if (!res.ok) {
    throw new Error(((await res.json()) as { message?: string }).message ?? `Moss ${res.status}`)
  }
}

export async function queryBenefits(
  indexName: string,
  query: string,
  topK = 5
): Promise<{ hits: MossHit[]; timeTakenInMs?: number }> {
  const res = await fetch('/api/moss/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indexName, query, topK }),
  })
  const body = (await res.json()) as {
    docs?: MossHit[]
    timeTakenInMs?: number
    message?: string
  }
  if (!res.ok) {
    throw new Error(body.message ?? `Moss ${res.status}`)
  }
  return { hits: body.docs ?? [], timeTakenInMs: body.timeTakenInMs }
}
