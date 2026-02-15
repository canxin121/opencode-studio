import type { SseEvent } from '@/lib/sse'

type RuntimeValue = unknown
type RuntimeRecord = Record<string, RuntimeValue>

function asRecord(value: RuntimeValue): RuntimeRecord {
  return typeof value === 'object' && value !== null ? (value as RuntimeRecord) : {}
}

export function readParentId(session: RuntimeValue): string | null {
  const rec = asRecord(session)
  const raw = rec.parentID ?? rec.parentId ?? rec.parent_id
  const id = typeof raw === 'string' ? raw.trim() : ''
  return id || null
}

export function readUpdatedAt(session: RuntimeValue): number {
  const time = asRecord(asRecord(session).time)
  const value = Number(time.updated || 0)
  return Number.isFinite(value) ? value : 0
}

export function extractSessionId(evt: SseEvent): string {
  const props = asRecord(evt.properties)
  const id =
    (typeof props.sessionID === 'string' && props.sessionID) ||
    (typeof props.sessionId === 'string' && props.sessionId) ||
    (typeof props.session_id === 'string' && props.session_id) ||
    ''
  return String(id || '').trim()
}
