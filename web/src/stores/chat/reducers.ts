import type { SseEvent } from '../../lib/sse'
import type { MessageInfo, MessagePart } from '../../types/chat'
import type { JsonValue as JsonLike } from '@/types/json'

type UnknownRecord = Record<string, JsonLike>

function isRecord(value: JsonLike): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: JsonLike): UnknownRecord {
  return isRecord(value) ? value : {}
}

function getString(value: JsonLike, key: string): string {
  if (!isRecord(value)) return ''
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : ''
}

function getNumber(value: JsonLike, key: string): number | null {
  if (!isRecord(value)) return null
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function firstRecord(value: UnknownRecord, keys: string[]): UnknownRecord | null {
  for (const key of keys) {
    const candidate = value[key]
    if (isRecord(candidate)) return candidate
  }
  return null
}

export function clampText(input: JsonLike, max = 260): string {
  const raw = typeof input === 'string' ? input : ''
  const t = raw.trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function safeJson(value: JsonLike): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function extractSessionId(evt: SseEvent): string | null {
  const props = asRecord(evt.properties)
  const info = isRecord(props.info) ? props.info : null
  const part = firstRecord(props, ['part', 'messagePart', 'partInfo'])
  const session = getString(info, 'sessionID') || getString(part, 'sessionID') || getString(props, 'sessionID')
  return typeof session === 'string' && session.trim() ? session.trim() : null
}

export function normalizeMessageInfoFromSse(evt: SseEvent): MessageInfo | null {
  const props = asRecord(evt.properties)
  const raw = isRecord(props.info) ? props.info : null
  if (!raw) return null

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const sessionID = typeof raw.sessionID === 'string' ? raw.sessionID.trim() : ''

  if (!id || !sessionID) return null

  const role = typeof raw.role === 'string' ? raw.role : ''

  // The UI uses time.created to decide when to hide placeholders; ensure it's present.
  const timeObj = asRecord(raw.time)
  const created = getNumber(timeObj, 'created') ?? Date.now()
  const updated = getNumber(timeObj, 'updated') ?? created

  const info: MessageInfo = {
    ...raw,
    id,
    sessionID,
    role,
    time: { ...timeObj, created, completed: updated },
  }
  return info
}

export function normalizeMessageInfoFromPartEvent(evt: SseEvent): MessageInfo | null {
  const props = asRecord(evt.properties)
  const part = firstRecord(props, ['part', 'messagePart', 'partInfo'])
  if (!part) return null

  const sessionID = typeof part.sessionID === 'string' ? part.sessionID.trim() : ''
  const messageID = typeof part.messageID === 'string' ? part.messageID.trim() : ''
  if (!sessionID || !messageID) return null

  const created = getNumber(asRecord(part.time), 'created') ?? Date.now()

  return {
    id: messageID,
    sessionID,
    // Part events overwhelmingly come from assistant output; default for rendering.
    role: 'assistant',
    time: { created, completed: created },
  }
}

export function normalizeMessagePartFromSse(evt: SseEvent, messageID: string, sessionID: string): MessagePart | null {
  const props = asRecord(evt.properties)
  let raw: UnknownRecord | null = null
  if (isRecord(props)) {
    raw = firstRecord(props, ['part', 'messagePart', 'partInfo'])

    // OpenCode commonly sends incremental text as properties.delta.
    // Some emitters may omit the full part snapshot; keep delta around either way.
    const deltaFromProps = getString(props, 'delta')

    // Some emitters send { partID, delta } instead of the full part.
    if (!raw && deltaFromProps) {
      raw = {
        id: props.partID ?? '',
        type: 'text',
        delta: deltaFromProps,
      }
    }
  }
  if (!raw) return null

  const type =
    typeof raw.type === 'string'
      ? raw.type
      : typeof raw.kind === 'string'
        ? raw.kind
        : typeof raw.text === 'string' || typeof raw.content === 'string'
          ? 'text'
          : ''
  const text = typeof raw.text === 'string' ? raw.text : typeof raw.content === 'string' ? raw.content : undefined

  let id = typeof raw.id === 'string' ? raw.id.trim() : ''

  // Some emitters provide partID outside the part object.
  if (!id && isRecord(props)) {
    const pid = getString(props, 'partID').trim()
    if (pid) id = pid
  }

  // Last resort: synthesize an ID for chunk-only text/reasoning streams.
  if (!id && (type === 'text' || type === 'reasoning')) {
    id = `synthetic:${type}:${messageID}`
  }
  if (!id) return null

  const out: MessagePart = {
    ...raw,
    id,
    type,
    messageID,
    sessionID,
  }
  if (text !== undefined) out.text = text

  // Preserve delta for streaming consumers (OpenCode uses properties.delta).
  if (typeof props.delta === 'string' && typeof out.delta !== 'string') {
    out.delta = props.delta
  }
  return out
}
