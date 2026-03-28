function firstQueryValue(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const value = firstQueryValue(item)
      if (value) return value
    }
  }
  return ''
}

export const DEFAULT_WINDOW_SCOPE_ID = 'window-default'

export function readWindowIdFromQuery(query: unknown): string {
  if (!query || typeof query !== 'object') return ''
  const record = query as Record<string, unknown>
  return firstQueryValue(record.windowId || record.windowid)
}

export function readWindowIdFromSearch(search: string): string {
  const source = String(search || '').trim()
  if (!source) return ''
  const params = new URLSearchParams(source.startsWith('?') ? source : `?${source}`)
  return firstQueryValue(params.get('windowId') || params.get('windowid'))
}

export function readWindowIdFromLocation(): string {
  if (typeof window === 'undefined') return ''
  return readWindowIdFromSearch(window.location.search || '')
}

export function normalizeWindowScopeId(raw: unknown, fallback = DEFAULT_WINDOW_SCOPE_ID): string {
  const preferred = String(raw || '').trim()
  if (preferred) return preferred
  const normalizedFallback = String(fallback || '').trim()
  return normalizedFallback || DEFAULT_WINDOW_SCOPE_ID
}

export function resolveWindowScopeId(opts?: { query?: unknown; fallback?: unknown; defaultScope?: string }): string {
  const queryWindowId = readWindowIdFromQuery(opts?.query)
  if (queryWindowId) return queryWindowId
  const locationWindowId = readWindowIdFromLocation()
  if (locationWindowId) return locationWindowId
  return normalizeWindowScopeId(opts?.fallback, opts?.defaultScope || DEFAULT_WINDOW_SCOPE_ID)
}
