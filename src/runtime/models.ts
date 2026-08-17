import { defaultHttp, errorDetail, HttpClient, authHeaders } from '../http'
import { readSession, requireAuth, writeSession } from '../store'

export interface CatalogModel {
  name: string
  label: string
}

function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[-_.\s]/g, '')
}

export async function fetchModelCatalog(http: HttpClient = defaultHttp): Promise<{
  models: CatalogModel[]
  defaultModel: string
}> {
  const auth = requireAuth()
  const response = await http(`${auth.api_base}/api/chat/models`, { headers: authHeaders(auth.token) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(errorDetail(body, `models failed (${response.status})`))
  const rows = Array.isArray(body?.models) ? body.models : []
  const models = rows
    .map((row: { name?: string; display_name?: string; label?: string }) => {
      const name = String(row?.name || '').trim()
      if (!name) return null
      return { name, label: String(row.display_name || row.label || name) }
    })
    .filter((row: CatalogModel | null): row is CatalogModel => Boolean(row))
  return { models, defaultModel: String(body?.default_model || '') }
}

export function resolveCatalogModel(query: string, models: CatalogModel[]): CatalogModel | undefined {
  const needle = normalizeModelKey(query)
  if (!needle) return undefined
  return (
    models.find((row) => normalizeModelKey(row.name) === needle) ||
    models.find((row) => normalizeModelKey(row.label) === needle) ||
    models.find((row) => normalizeModelKey(row.name).includes(needle) || normalizeModelKey(row.label).includes(needle))
  )
}

export async function resolveRuntimeModel(
  http: HttpClient,
  options: { explicit?: string; stub?: boolean } = {},
): Promise<string> {
  if (options.stub) return (options.explicit || '').trim() || 'stub'
  const wanted = (options.explicit || '').trim()
  const { models, defaultModel } = await fetchModelCatalog(http)
  if (wanted) {
    const match = resolveCatalogModel(wanted, models)
    if (!match) throw new Error(`unknown model ${wanted}`)
    writeSession({ ...readSession(), last_model: match.name })
    return match.name
  }
  const last = (readSession().last_model || '').trim()
  if (last && models.some((row) => row.name === last)) return last
  const name = defaultModel || models[0]?.name || ''
  if (!name) throw new Error('no SiSu model available')
  writeSession({ ...readSession(), last_model: name })
  return name
}
