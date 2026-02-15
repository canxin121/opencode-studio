type ConfigValue = unknown
type ConfigObject = Record<string, ConfigValue>

export function cloneConfig<T>(value: T): T {
  try {
    const seed = value ?? ({} as T)
    return JSON.parse(JSON.stringify(seed)) as T
  } catch {
    return {} as T
  }
}

export function isEmptyValue(value: ConfigValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

export function isPlainObject(value: ConfigValue): value is ConfigObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function getPath(obj: ConfigValue, path: string): ConfigValue {
  const parts = path.split('.').filter(Boolean)
  let cur: ConfigValue = obj
  for (const key of parts) {
    if (!isPlainObject(cur)) return undefined
    cur = cur[key]
  }
  return cur
}

export function deletePath(obj: ConfigValue, path: string) {
  const parts = path.split('.').filter(Boolean)
  if (!parts.length) return

  const stack: Array<{ parent: ConfigObject; key: string }> = []
  let cur: ConfigValue = obj

  for (const key of parts.slice(0, -1)) {
    if (!isPlainObject(cur)) return
    stack.push({ parent: cur, key })
    cur = cur[key]
  }

  if (!isPlainObject(cur)) return
  const lastKey = parts[parts.length - 1]
  if (!lastKey) return
  delete cur[lastKey]

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i]
    if (!entry) continue
    const { parent, key } = entry
    const value = parent[key]
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      delete parent[key]
    }
  }
}

export function setPath(obj: ConfigValue, path: string, value: ConfigValue) {
  const parts = path.split('.').filter(Boolean)
  if (!parts.length) return

  let cur: ConfigValue = obj
  for (const key of parts.slice(0, -1)) {
    if (!isPlainObject(cur)) return
    const child = cur[key]
    if (!isPlainObject(child)) {
      cur[key] = {}
    }
    cur = cur[key]
  }

  if (!isPlainObject(cur)) return
  const lastKey = parts[parts.length - 1]
  if (!lastKey) return
  cur[lastKey] = value
}

export function setOrClear(obj: ConfigValue, path: string, value: ConfigValue, onDirty?: () => void) {
  if (isEmptyValue(value)) {
    deletePath(obj, path)
  } else {
    setPath(obj, path, value)
  }
  if (onDirty) onDirty()
}

export function getMap(obj: ConfigValue, path: string): ConfigObject {
  const value = getPath(obj, path)
  return isPlainObject(value) ? value : {}
}

export function ensureMap(obj: ConfigValue, path: string, onDirty?: () => void): ConfigObject {
  const value = getPath(obj, path)
  if (!isPlainObject(value)) {
    setPath(obj, path, {})
    if (onDirty) onDirty()
    const next = getPath(obj, path)
    return isPlainObject(next) ? next : {}
  }
  return value
}

export function ensureEntry(obj: ConfigValue, mapPath: string, key: string, onDirty?: () => void): ConfigObject {
  const map = ensureMap(obj, mapPath, onDirty)
  const existing = map[key]
  if (!isPlainObject(existing)) {
    const next: ConfigObject = {}
    map[key] = next
    if (onDirty) onDirty()
    return next
  }
  return existing
}

export function setEntryField(
  obj: ConfigValue,
  mapPath: string,
  key: string,
  field: string,
  value: ConfigValue,
  onDirty?: () => void,
) {
  const map = ensureMap(obj, mapPath, onDirty)
  const entry = ensureEntry(obj, mapPath, key, onDirty)
  if (isEmptyValue(value)) {
    delete entry[field]
  } else {
    entry[field] = value
  }
  if (Object.keys(entry).length === 0) {
    delete map[key]
  }
  if (Object.keys(map).length === 0) {
    deletePath(obj, mapPath)
  }
  if (onDirty) onDirty()
}

export function removeEntry(obj: ConfigValue, mapPath: string, key: string, onDirty?: () => void) {
  const map = getMap(obj, mapPath)
  if (map[key]) {
    delete map[key]
    if (onDirty) onDirty()
  }
  if (Object.keys(map).length === 0) {
    deletePath(obj, mapPath)
  }
}

export function listToText(value: ConfigValue): string {
  if (!Array.isArray(value)) return ''
  return value.join('\n')
}

export function textToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function normalizeStringList(input: ConfigValue): string[] {
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

export function addToList(list: string[], value: string): string[] {
  const v = String(value || '').trim()
  if (!v) return list
  return normalizeStringList([...list, v])
}

export function removeFromList(list: string[], value: string): string[] {
  const v = String(value || '').trim()
  if (!v) return list
  return list.filter((x) => x !== v)
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
