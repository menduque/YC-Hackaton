import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks'
import { MOCK_REQUESTS, getMockRequest } from '../../../shared/stedi/mock-requests'
import {
  activeCoverage,
  checkEligibility,
  collectAaaErrors,
  patientResponsibility,
  type EligibilityResponse,
} from '../stedi/client'
import { eligibilityToFhir } from '../../../shared/stedi/to-fhir'
import { benefitsToDocuments, indexBenefits, queryBenefits, type MossHit } from '../moss/client'

const CATEGORY_LABELS: Record<string, string> = {
  'medical-active-dependent': 'Medical — active (dependent)',
  'medical-active-subscriber': 'Medical — active (subscriber)',
  'mbi-lookup': 'CMS MBI lookup',
  'medical-inactive': 'Medical — inactive',
  dental: 'Dental',
  'aaa-error': 'AAA errors',
  'stedi-agent': 'Stedi Agent',
}

export function EligibilityDemo({ onSignInRequired }: { onSignInRequired?: () => void }) {
  const medplum = useMedplum()
  const profile = useMedplumProfile()
  const [mockId, setMockId] = useState<string>('aetna')
  const [response, setResponse] = useState<EligibilityResponse>()
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Moss semantic search over this response's benefit lines.
  const [indexName, setIndexName] = useState<string>()
  const [indexing, setIndexing] = useState(false)
  const [question, setQuestion] = useState('')
  const [hits, setHits] = useState<MossHit[]>()
  const [searchMs, setSearchMs] = useState<number>()

  const options = useMemo(
    () =>
      Object.entries(
        MOCK_REQUESTS.reduce<Record<string, { value: string; label: string }[]>>((acc, m) => {
          // Several mocks share a payer + patient name (all six AAA cases are
          // "UnitedHealthcare — John/Jane Doe"), so the id disambiguates.
          ;(acc[m.category] ??= []).push({ value: m.id, label: `${m.label}  ·  ${m.id}` })
          return acc
        }, {})
      ).map(([group, items]) => ({ group: CATEGORY_LABELS[group] ?? group, items })),
    []
  )

  const mock = getMockRequest(mockId)
  const aaaErrors = response ? collectAaaErrors(response) : []
  const active = response ? activeCoverage(response) : []
  const responsibility = response ? patientResponsibility(response) : []

  async function run(): Promise<void> {
    setLoading(true)
    setError(undefined)
    setResponse(undefined)
    setSaved(undefined)
    setIndexName(undefined)
    setHits(undefined)
    try {
      setResponse(await checkEligibility(mock.request))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function buildIndex(): Promise<void> {
    if (!response) return
    setIndexing(true)
    setError(undefined)
    try {
      const name = `benefits-${mock.id}`
      await indexBenefits(name, benefitsToDocuments(response))
      setIndexName(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIndexing(false)
    }
  }

  async function ask(): Promise<void> {
    if (!indexName || !question.trim()) return
    setError(undefined)
    try {
      const { hits: found, timeTakenInMs } = await queryBenefits(indexName, question)
      setHits(found)
      setSearchMs(timeTakenInMs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveToMedplum(): Promise<void> {
    if (!response) return
    if (!profile) {
      onSignInRequired?.()
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const { patient, coverage, eligibility } = eligibilityToFhir(mock.request, response)
      const createdPatient = await medplum.createResource(patient)
      const createdCoverage = await medplum.createResource({
        ...coverage,
        beneficiary: { reference: `Patient/${createdPatient.id}` },
      })
      const createdEligibility = await medplum.createResource({
        ...eligibility,
        patient: { reference: `Patient/${createdPatient.id}` },
        insurance: eligibility.insurance?.map((i) => ({
          ...i,
          coverage: { reference: `Coverage/${createdCoverage.id}` },
        })),
      })
      setSaved(
        `Patient/${createdPatient.id} · Coverage/${createdCoverage.id} · CoverageEligibilityResponse/${createdEligibility.id}`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack p="xl" gap="lg">
      <div>
        <Title order={2}>Stedi eligibility → Medplum FHIR</Title>
        <Text c="dimmed" size="sm">
          Stedi test mode. Synthetic payers, no PHI, nothing reaches a real payer, no charges.
        </Text>
      </div>

      <Group align="flex-end">
        <Select
          label="Mock request"
          data={options}
          value={mockId}
          onChange={(v) => v && setMockId(v)}
          searchable
          w={460}
        />
        <Button onClick={run} loading={loading}>
          Run eligibility check
        </Button>
      </Group>

      <Card withBorder padding="sm">
        <Text size="xs" c="dimmed" mb={4}>
          270 request body
        </Text>
        <Code block>{JSON.stringify(mock.request, null, 2)}</Code>
      </Card>

      {error && (
        <Alert color="red" title="Request failed">
          {error}
        </Alert>
      )}

      {response && (
        <Stack gap="md">
          <Group>
            <Badge color={aaaErrors.length ? 'red' : active.length ? 'green' : 'gray'}>
              {aaaErrors.length ? 'AAA error' : active.length ? 'Active coverage' : 'No coverage'}
            </Badge>
            <Text size="sm">{response.payer?.name}</Text>
            <Text size="sm" c="dimmed">
              mode: {response.meta?.applicationMode} · trace: {response.meta?.traceId}
            </Text>
          </Group>

          {aaaErrors.map((e, i) => (
            <Alert key={i} color="orange" title={`AAA ${e.code} — ${e.description}`}>
              <Text size="sm">{e.followupAction}</Text>
              {e.possibleResolutions && (
                <Text size="sm" c="dimmed" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                  {e.possibleResolutions}
                </Text>
              )}
            </Alert>
          ))}

          {responsibility.length > 0 && (
            <Card withBorder padding="sm">
              <Text fw={500} mb="xs">
                Patient responsibility
              </Text>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Service</Table.Th>
                    <Table.Th>Network</Table.Th>
                    <Table.Th>Period</Table.Th>
                    <Table.Th ta="right">Amount</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {responsibility.slice(0, 25).map((b, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{b.name}</Table.Td>
                      <Table.Td>{b.serviceTypes?.[0] ?? '—'}</Table.Td>
                      <Table.Td>{b.inPlanNetworkIndicator ?? '—'}</Table.Td>
                      <Table.Td>{b.timeQualifier ?? '—'}</Table.Td>
                      <Table.Td ta="right">${b.benefitAmount}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {responsibility.length > 25 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Showing 25 of {responsibility.length} lines.
                </Text>
              )}
            </Card>
          )}

          <Group>
            <Button variant="light" onClick={saveToMedplum} loading={saving}>
              {profile ? 'Save as FHIR in Medplum' : 'Sign in to save as FHIR'}
            </Button>
            {saved && (
              <Text size="sm" c="green">
                {saved}
              </Text>
            )}
          </Group>

          {(response.benefitsInformation?.length ?? 0) > 0 && (
            <Card withBorder padding="sm">
              <Group justify="space-between" mb="xs">
                <Text fw={500}>Ask about these benefits (Moss)</Text>
                {searchMs !== undefined && (
                  <Text size="xs" c="dimmed">
                    {searchMs} ms
                  </Text>
                )}
              </Group>

              {!indexName ? (
                <Group>
                  <Button variant="default" onClick={buildIndex} loading={indexing}>
                    Index {response.benefitsInformation?.length} benefit lines
                  </Button>
                  <Text size="sm" c="dimmed">
                    Builds a Moss index so you can search the payer&apos;s response in plain English.
                  </Text>
                </Group>
              ) : (
                <Stack gap="sm">
                  <Group>
                    <TextInput
                      placeholder="e.g. what do I pay for an office visit?"
                      value={question}
                      onChange={(e) => setQuestion(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void ask()}
                      w={480}
                    />
                    <Button onClick={ask}>Search</Button>
                  </Group>
                  {hits?.map((h) => (
                    <Group key={h.id} wrap="nowrap" align="flex-start">
                      <Badge variant="light" miw={56}>
                        {h.score.toFixed(2)}
                      </Badge>
                      <Text size="sm">{h.text}</Text>
                    </Group>
                  ))}
                  {hits?.length === 0 && (
                    <Text size="sm" c="dimmed">
                      No matches.
                    </Text>
                  )}
                </Stack>
              )}
            </Card>
          )}

          <Card withBorder padding="sm">
            <Text size="xs" c="dimmed" mb={4}>
              271 response ({response.benefitsInformation?.length ?? 0} benefit lines)
            </Text>
            <Code block mah={400} style={{ overflow: 'auto' }}>
              {JSON.stringify(response, null, 2)}
            </Code>
          </Card>
        </Stack>
      )}
    </Stack>
  )
}
