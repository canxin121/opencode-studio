import type { MessageEntry, MessageInfo, MessagePart } from '@/types/chat'

export function binarySearchById<T>(
  arr: T[],
  id: string,
  getId: (item: T) => string,
): { found: boolean; index: number } {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const midItem = arr[mid]
    if (midItem === undefined) break
    const cur = getId(midItem)
    if (cur < id) lo = mid + 1
    else hi = mid
  }
  const index = lo
  const atIndex = index < arr.length ? arr[index] : undefined
  const found = atIndex !== undefined && getId(atIndex) === id
  return { found, index }
}

export function upsertMessageEntryIn(list: MessageEntry[], info: MessageInfo): MessageEntry {
  const { found, index } = binarySearchById(list, info.id, (m) => m.info.id)
  if (found) {
    const entry = list[index]
    if (!entry) {
      const fallback: MessageEntry = { info, parts: [] }
      list.splice(index, 0, fallback)
      return fallback
    }
    Object.assign(entry.info, info)
    if (!Array.isArray(entry.parts)) entry.parts = []
    return entry
  }
  const entry: MessageEntry = { info, parts: [] }
  list.splice(index, 0, entry)
  return entry
}

export function upsertPart(entry: MessageEntry, part: MessagePart, delta: string) {
  if (!Array.isArray(entry.parts)) {
    entry.parts = []
  }
  const parts = entry.parts
  const { found, index } = binarySearchById(parts, part.id, (p) => p.id)

  const partType = typeof part.type === 'string' ? String(part.type) : ''
  const nextText = typeof part.text === 'string' ? String(part.text) : ''

  if (!found) {
    const next: MessagePart = { ...part }
    if ((partType === 'text' || partType === 'reasoning') && delta && (!nextText || partType === 'reasoning')) {
      // Chunk-only streams: seed text from delta.
      next.text = nextText || delta
    }
    parts.splice(index, 0, next)
    return
  }

  const prev = parts[index]
  if (!prev) {
    const fallback: MessagePart = { ...part }
    if ((partType === 'text' || partType === 'reasoning') && delta && (!nextText || partType === 'reasoning')) {
      fallback.text = nextText || delta
    }
    parts.splice(index, 0, fallback)
    return
  }
  const base = typeof prev.text === 'string' ? String(prev.text) : ''

  // Prefer authoritative part snapshots when present, but fall back to delta when
  // the snapshot isn't advancing (some emitters stream delta-only).
  if (partType === 'text' || partType === 'reasoning') {
    if (delta) {
      if (nextText && nextText.length > base.length) {
        Object.assign(prev, part, { text: nextText })
      } else {
        Object.assign(prev, part, { text: base + delta })
      }
    } else if (nextText) {
      Object.assign(prev, part, { text: nextText })
    } else {
      Object.assign(prev, part)
    }
    return
  }

  Object.assign(prev, part)
}
