import { apiJson } from '@/lib/api'

type QueryValue = string | number | boolean | null | undefined

function buildQuery(params: Record<string, QueryValue>): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    const key = encodeURIComponent(k)
    const value = encodeURIComponent(typeof v === 'boolean' ? String(v) : String(v))
    out.push(`${key}=${value}`)
  }
  return out.join('&')
}

export function gitUrl(path: string, directory: string, query?: Record<string, QueryValue>): string {
  const cleanPath = (path || '').replace(/^\/+/, '')
  const params = { directory, ...(query ?? {}) }
  const qs = buildQuery(params)
  return `/api/git/${cleanPath}${qs ? `?${qs}` : ''}`
}

export async function gitJson<T>(
  path: string,
  directory: string,
  query?: Record<string, QueryValue>,
  init?: RequestInit,
): Promise<T> {
  return await apiJson<T>(gitUrl(path, directory, query), init)
}

export function gitWatchUrl(directory: string, intervalMs = 1500): string {
  return gitUrl('watch', directory, { intervalMs })
}
