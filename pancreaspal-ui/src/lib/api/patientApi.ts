import { getApiBaseUrl } from './config'
import type {
  CreateMetricInput,
  CreateMetricResult,
  DashboardPayload,
  ConversationTurn,
} from './dashboardTypes'

export type {
  DashboardPayload,
  CreateMetricInput,
  CreateMetricResult,
  ConversationTurn,
} from './dashboardTypes'

export type SourceDocument = {
  source: string | null
  url: string | null
  title: string | null
}

export type QueryMode = 'general' | 'metrics'

export type QueryResponse = {
  answer: string
  sources: SourceDocument[]
  query_mode?: QueryMode
}

export class PatientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'PatientApiError'
  }
}

async function parseError(res: Response): Promise<PatientApiError> {
  let detail: unknown
  try {
    detail = await res.json()
  } catch {
    detail = await res.text()
  }
  const msg =
    typeof detail === 'object' && detail !== null && 'detail' in detail
      ? String((detail as { detail: unknown }).detail)
      : `Request failed (${res.status})`
  return new PatientApiError(msg, res.status, detail)
}

function apiUrl(path: string): string {
  const base = getApiBaseUrl()
  return base ? `${base}${path}` : path
}

export async function initPatient(): Promise<string> {
  const res = await fetch(apiUrl('/api/v1/patients/init'), { method: 'POST' })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { patient_id: string }
  return data.patient_id
}

export async function queryPatient(
  patientId: string,
  query: string,
  queryMode: QueryMode = 'general',
): Promise<QueryResponse> {
  const res = await fetch(apiUrl(`/api/v1/patients/${encodeURIComponent(patientId)}/query`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, query_mode: queryMode }),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as QueryResponse
}

export async function createMetric(
  patientId: string,
  body: CreateMetricInput,
): Promise<CreateMetricResult> {
  const res = await fetch(apiUrl(`/api/v1/patients/${encodeURIComponent(patientId)}/metrics`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as CreateMetricResult
}

export async function getDashboard(
  patientId: string,
  days = 14,
  refresh = false,
): Promise<DashboardPayload> {
  const params = new URLSearchParams({ days: String(days) })
  if (refresh) params.set('refresh', 'true')
  const res = await fetch(
    apiUrl(`/api/v1/patients/${encodeURIComponent(patientId)}/dashboard?${params}`),
  )
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as DashboardPayload
}

export async function listConversations(
  patientId: string,
  limit = 50,
): Promise<ConversationTurn[]> {
  const res = await fetch(
    apiUrl(
      `/api/v1/patients/${encodeURIComponent(patientId)}/conversations?limit=${encodeURIComponent(String(limit))}`,
    ),
  )
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { turns: ConversationTurn[] }
  return data.turns
}
