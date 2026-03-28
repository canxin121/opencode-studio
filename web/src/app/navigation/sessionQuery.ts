import type { LocationQuery, LocationQueryRaw } from 'vue-router'

const SESSION_QUERY_KEY = 'sessionId' as const

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
  return firstTrimmedString(readQueryValue(query, SESSION_QUERY_KEY))
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
    sessionId: params.get('sessionId'),
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
  const legacyKeys = ['session', 'sessionid'] as const

  if (!sid) {
    delete next[SESSION_QUERY_KEY]
    for (const key of legacyKeys) {
      delete next[key]
    }
    return next
  }

  next[SESSION_QUERY_KEY] = sid
  for (const key of legacyKeys) {
    if (hasQueryKey(next, key)) {
      delete next[key]
    }
  }
  return next
}
