import type { LocationQueryRaw } from 'vue-router'

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

function hasEmbeddedWorkspacePaneLocation(): boolean {
  if (typeof window === 'undefined') return false
  return hasEmbeddedWorkspacePaneSearch(window.location.search || '')
}

const embeddedWorkspacePaneBootContext = hasEmbeddedWorkspacePaneLocation()

export const DEFAULT_WINDOW_SCOPE_ID = 'window-default'

export function hasEmbeddedWorkspacePaneQuery(query: unknown): boolean {
  if (!query || typeof query !== 'object') return false
  const record = query as Record<string, unknown>
  return firstQueryValue(record.ocEmbed) === '1'
}

export function hasEmbeddedWorkspacePaneSearch(search: string): boolean {
  const source = String(search || '').trim()
  if (!source) return false
  const params = new URLSearchParams(source.startsWith('?') ? source : `?${source}`)
  return firstQueryValue(params.get('ocEmbed')) === '1'
}

export function isEmbeddedWorkspacePaneContext(query?: unknown): boolean {
  if (hasEmbeddedWorkspacePaneQuery(query)) return true
  if (hasEmbeddedWorkspacePaneLocation()) return true
  return embeddedWorkspacePaneBootContext
}

export function withEmbeddedWorkspaceScopeQuery(nextQuery: LocationQueryRaw, currentQuery?: unknown): LocationQueryRaw {
  if (!isEmbeddedWorkspacePaneContext(currentQuery)) return { ...nextQuery }

  const out: LocationQueryRaw = {
    ...nextQuery,
    ocEmbed: '1',
  }
  const windowId = readWindowIdFromQuery(currentQuery) || readWindowIdFromLocation()
  if (windowId && !firstQueryValue(out.windowId)) {
    out.windowId = windowId
  }
  return out
}

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
