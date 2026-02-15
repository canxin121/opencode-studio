import type { SseEvent } from '@/lib/sse'
import type { MessageEntry } from '@/types/chat'
import type { JsonValue as JsonLike } from '@/types/json'

import { normalizeMessageInfoFromPartEvent, normalizeMessageInfoFromSse, normalizeMessagePartFromSse } from './reducers'

import { binarySearchById, upsertMessageEntryIn, upsertPart } from './messageIndex'

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

function firstRecord(value: UnknownRecord, keys: string[]): UnknownRecord | null {
  for (const key of keys) {
    const candidate = value[key]
    if (isRecord(candidate)) return candidate
  }
  return null
}

export function applyStreamingEventToMessages(opts: {
  evt: SseEvent
  ensureSessionMessages: (sessionId: string) => MessageEntry[]
  pruneSessionMessages: (sessionId: string) => void
}): boolean {
  const evt = opts.evt
  const t = evt.type || ''
  if (!t.startsWith('message.')) return false

  // message.updated: carries authoritative role/time (don't guess from part events).
  if (t === 'message.updated') {
    const info = normalizeMessageInfoFromSse(evt)
    if (!info) return false
    const sid = info.sessionID
    if (!sid) return false
    const list = opts.ensureSessionMessages(sid)
    upsertMessageEntryIn(list, info)
    opts.pruneSessionMessages(sid)
    return true
  }

  if (t === 'message.part.updated' || t === 'message.part.created') {
    // Derive IDs from the part event, but do NOT overwrite the message role.
    const idInfo = normalizeMessageInfoFromPartEvent(evt)
    if (!idInfo) return false
    const sid = idInfo.sessionID
    const mid = idInfo.id
    if (!sid || !mid) return false

    const list = opts.ensureSessionMessages(sid)
    const lookup = binarySearchById(list, mid, (m) => m.info.id)

    // Only create a placeholder message for assistant-only part types.
    // This prevents user messages from briefly rendering as assistant bubbles.
    let entry: MessageEntry | null = null
    if (lookup.found) {
      entry = list[lookup.index] || null
    } else {
      const props = asRecord(evt.properties)
      const rawPart = firstRecord(props, ['part', 'messagePart', 'partInfo'])
      const rawType = getString(rawPart, 'type') || getString(rawPart, 'kind')
      const ty = String(rawType || '').toLowerCase()
      const assistantOnly =
        ty === 'tool' ||
        ty === 'reasoning' ||
        ty === 'step-start' ||
        ty === 'step-finish' ||
        ty === 'snapshot' ||
        ty === 'patch' ||
        ty === 'retry' ||
        ty === 'compaction'

      if (!assistantOnly) return false

      const created = typeof idInfo?.time?.created === 'number' ? Number(idInfo.time.created) : Date.now()
      entry = upsertMessageEntryIn(list, {
        id: mid,
        sessionID: sid,
        role: 'assistant',
        time: { created, completed: created },
      })
      opts.pruneSessionMessages(sid)
    }
    if (!entry) return false

    const part = normalizeMessagePartFromSse(evt, mid, sid)
    if (!part) return false

    const props = asRecord(evt.properties)
    const deltaFromProps = getString(props, 'delta')
    const deltaFromPart = typeof part.delta === 'string' ? part.delta : ''
    const delta = deltaFromProps || deltaFromPart

    // Apply part update in-place, keeping parts sorted.
    upsertPart(entry, part, delta)
    return true
  }

  return false
}
