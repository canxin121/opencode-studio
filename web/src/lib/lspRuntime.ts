export type LspRuntimeListResponse =
  | unknown[]
  | {
      items?: unknown[]
      servers?: unknown[]
      list?: unknown[]
    }

export type LspRuntimeItem = {
  id: string
  name: string
  status: string
  rootDir: string
  transport: string
  sessionID: string
}

const RUNTIME_LIST_KEYS = ['items', 'servers', 'list'] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pickStatus(obj: Record<string, unknown>): string {
  const explicit = pickString(obj, ['status', 'state'])
  if (explicit) return explicit
  if (obj.connected === true) return 'connected'
  if (obj.connected === false) return 'disconnected'
  return 'unknown'
}

function pickSessionID(obj: Record<string, unknown>): string {
  const direct = pickString(obj, ['sessionID', 'sessionId', 'session_id'])
  if (direct) return direct

  const session = obj.session
  if (typeof session === 'string' && session.trim()) return session.trim()
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    return pickString(session as Record<string, unknown>, ['id', 'sessionID', 'sessionId', 'session_id'])
  }
  return ''
}

function resolveRawRuntimeList(payload: LspRuntimeListResponse, activeSessionId: string): unknown[] {
  if (Array.isArray(payload)) return payload

  const root = asRecord(payload)
  if (!root) return []

  if (activeSessionId) {
    const scopedPayload = root[activeSessionId]
    if (Array.isArray(scopedPayload)) return scopedPayload
    const scopedRecord = asRecord(scopedPayload)
    if (scopedRecord) {
      for (const key of RUNTIME_LIST_KEYS) {
        if (Array.isArray(scopedRecord[key])) return scopedRecord[key] as unknown[]
      }
    }
  }

  for (const key of RUNTIME_LIST_KEYS) {
    if (Array.isArray(root[key])) return root[key] as unknown[]
  }

  return []
}

export function normalizeLspRuntimeList(
  payload: LspRuntimeListResponse,
  opts?: {
    sessionId?: string
  },
): LspRuntimeItem[] {
  const activeSessionId = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : ''
  const list = resolveRawRuntimeList(payload, activeSessionId)

  const items = list
    .map((raw) => {
      const rec = asRecord(raw)
      if (!rec) return null
      const id = pickString(rec, ['id', 'lspId', 'serverId', 'name', 'label'])
      const name = pickString(rec, ['name', 'label', 'server', 'serverName']) || id
      if (!id && !name) return null
      return {
        id: id || name,
        name,
        status: pickStatus(rec),
        rootDir: pickString(rec, ['rootDir', 'root', 'workspaceRoot', 'workspace', 'directory']),
        transport: pickString(rec, ['transport', 'connection', 'mode']),
        sessionID: pickSessionID(rec),
      }
    })
    .filter((item): item is LspRuntimeItem => Boolean(item))

  const hasSessionIDs = items.some((item) => item.sessionID)
  const filtered = activeSessionId && hasSessionIDs ? items.filter((item) => item.sessionID === activeSessionId) : items
  return filtered.sort((a, b) => a.name.localeCompare(b.name))
}

export function runtimeStatusTone(status: string): 'ok' | 'warn' | 'idle' {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  if (value === 'connected' || value === 'running' || value === 'ready') return 'ok'
  if (value === 'error' || value === 'failed' || value === 'disconnected' || value === 'stopped') return 'warn'
  return 'idle'
}
