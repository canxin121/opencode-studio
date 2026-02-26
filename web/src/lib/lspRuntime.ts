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
}

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

export function normalizeLspRuntimeList(payload: LspRuntimeListResponse): LspRuntimeItem[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.servers)
        ? payload.servers
        : Array.isArray(payload?.list)
          ? payload.list
          : []

  return list
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
      }
    })
    .filter((item): item is LspRuntimeItem => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function runtimeStatusTone(status: string): 'ok' | 'warn' | 'idle' {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  if (value === 'connected' || value === 'running' || value === 'ready') return 'ok'
  if (value === 'error' || value === 'failed' || value === 'disconnected' || value === 'stopped') return 'warn'
  return 'idle'
}
