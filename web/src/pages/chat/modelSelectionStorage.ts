export type StringMapEntry = { key: string; value: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeStringMapEntry(rawKey: string, rawValue: unknown): StringMapEntry | null {
  const key = String(rawKey || '').trim()
  const value = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (!key || !value) return null
  return { key, value }
}

export function loadStringMapFromStorage(
  storageKey: string,
  normalizeEntry: (key: string, value: unknown) => StringMapEntry | null,
): Record<string, string> {
  try {
    const raw = (localStorage.getItem(storageKey) || '').trim()
    const parsed = raw ? JSON.parse(raw) : null
    if (!isRecord(parsed)) return {}

    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeEntry(key, value)
      if (!normalized) continue
      out[normalized.key] = normalized.value
    }
    return out
  } catch {
    return {}
  }
}

export function createStringMapPersister(opts: {
  storageKey: string
  getValue: () => Record<string, string>
  delayMs?: number
}): { persistSoon: () => void } {
  const delayMs = Math.max(1, Math.floor(opts.delayMs ?? 250))
  let timer: number | null = null

  function persistSoon() {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      try {
        localStorage.setItem(opts.storageKey, JSON.stringify(opts.getValue()))
      } catch {
        // ignore
      }
    }, delayMs)
  }

  return { persistSoon }
}
