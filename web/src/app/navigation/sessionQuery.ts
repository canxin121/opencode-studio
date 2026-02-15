import type { LocationQuery, LocationQueryRaw } from 'vue-router'

const SESSION_QUERY_KEYS = ['sessionid', 'sessionId', 'session'] as const

type ReadQueryLike = LocationQuery | LocationQueryRaw | Record<string, unknown> | null | undefined
type WriteQueryLike = LocationQuery | LocationQueryRaw | null | undefined

function readQueryValue(query: ReadQueryLike, key: string): unknown {
  if (!query || typeof query !== 'object') return undefined
  return (query as Record<string, unknown>)[key]
}

function hasQueryKey(query: ReadQueryLike, key: string): boolean {
  if (!query || typeof query !== 'object') return false
  return Object.prototype.hasOwnProperty.call(query, key)
}

function firstTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (trimmed) return trimmed
    }
  }
  return ''
}

export function readSessionIdFromQuery(query: ReadQueryLike): string {
  for (const key of SESSION_QUERY_KEYS) {
    const sid = firstTrimmedString(readQueryValue(query, key))
    if (sid) return sid
  }
  return ''
}

export function readSessionIdFromFullPath(fullPath: string): string {
  const raw = String(fullPath || '').trim()
  if (!raw) return ''

  const qmark = raw.indexOf('?')
  if (qmark < 0) return ''
  const queryPart = raw.slice(qmark + 1)
  if (!queryPart) return ''

  const params = new URLSearchParams(queryPart)
  return readSessionIdFromQuery({
    sessionid: params.get('sessionid'),
    sessionId: params.get('sessionId'),
    session: params.get('session'),
  })
}

export function patchSessionIdInQuery(query: WriteQueryLike, sessionId: string): LocationQueryRaw {
  const next: LocationQueryRaw = {}
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      next[key] = value as LocationQueryRaw[string]
    }
  }
  const sid = String(sessionId || '').trim()
  const existingKeys = SESSION_QUERY_KEYS.filter((key) => hasQueryKey(query, key))

  if (!sid) {
    for (const key of existingKeys) {
      delete next[key]
    }
    return next
  }

  if (existingKeys.length === 0) {
    next.session = sid
    return next
  }

  for (const key of existingKeys) {
    next[key] = sid
  }
  return next
}
