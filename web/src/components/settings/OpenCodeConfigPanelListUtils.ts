import type { JsonValue } from '@/types/json'

export function normalizeStringList(input: JsonValue): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const s = typeof item === 'string' ? item.trim() : ''
    if (!s) continue
    if (seen.has(s)) continue
    out.push(s)
    seen.add(s)
  }
  return out
}

export function createStringListSetter(setOrClear: (path: string, value: JsonValue) => void) {
  return (path: string, list: string[]) => {
    const next = normalizeStringList(list)
    setOrClear(path, next)
  }
}

export function removeFromList(list: string[], value: string): string[] {
  const v = String(value || '').trim()
  if (!v) return list
  return list.filter((x) => x !== v)
}

export function addToList(list: string[], value: string): string[] {
  const v = String(value || '').trim()
  if (!v) return list
  return normalizeStringList([...list, v])
}

export function splitTags(raw: string): string[] {
  return String(raw || '')
    .split(/[\n,\t ]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function addTagsToList(current: string[], raw: string): string[] {
  let out = current.slice()
  for (const t of splitTags(raw)) {
    out = addToList(out, t)
  }
  return out
}
