export type McpStatusResponse = unknown

export type McpStatusItem = {
  name: string
  status: string
  error: string
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

function pickStatus(value: unknown): { status: string; error: string } {
  const rec = asRecord(value)
  if (!rec) return { status: '', error: '' }

  const status = pickString(rec, ['status', 'state'])
  const error = pickString(rec, ['error', 'message', 'detail'])
  if (status) return { status, error }

  if (rec.connected === true) return { status: 'connected', error }
  if (rec.connected === false) return { status: 'disconnected', error }

  return { status: '', error }
}

export function normalizeMcpStatus(payload: McpStatusResponse): McpStatusItem[] {
  if (!payload) return []

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        const rec = asRecord(entry)
        if (!rec) return null
        const name = pickString(rec, ['name', 'id', 'server', 'serverName', 'label'])
        if (!name) return null
        const info = pickStatus(rec)
        return {
          name,
          status: info.status || 'unknown',
          error: info.error,
        }
      })
      .filter((item): item is McpStatusItem => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const root = asRecord(payload)
  if (!root) return []

  const items = Object.entries(root)
    .map(([name, value]) => {
      const trimmed = String(name || '').trim()
      if (!trimmed) return null
      const info = pickStatus(value)
      return {
        name: trimmed,
        status: info.status || 'unknown',
        error: info.error,
      }
    })
    .filter((item): item is McpStatusItem => Boolean(item))

  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export function mcpStatusTone(status: string): 'ok' | 'warn' | 'idle' {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  if (value === 'connected' || value === 'running' || value === 'ready') return 'ok'
  if (value === 'disabled') return 'idle'
  if (
    value === 'failed' ||
    value === 'error' ||
    value === 'needs_auth' ||
    value === 'needs-client-auth' ||
    value === 'needs_client_registration' ||
    value === 'disconnected' ||
    value === 'stopped'
  )
    return 'warn'
  return 'idle'
}
