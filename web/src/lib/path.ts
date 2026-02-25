export function normalizeFsPath(raw: string): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\\/g, '/')
  if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}/`
  return normalized
}

export function trimTrailingFsSlashes(raw: string): string {
  const normalized = normalizeFsPath(raw)
  if (!normalized) return ''
  if (normalized === '/') return '/'
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized

  const trimmed = normalized.replace(/\/+$/g, '')
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`
  return trimmed || normalized
}

function pathForCompare(raw: string): string {
  const trimmed = trimTrailingFsSlashes(raw)
  if (/^[A-Za-z]:/.test(trimmed)) {
    return `${trimmed.slice(0, 1).toLowerCase()}${trimmed.slice(1)}`
  }
  return trimmed
}

export function fsPathEquals(a: string, b: string): boolean {
  return pathForCompare(a) === pathForCompare(b)
}

export function fsPathStartsWith(path: string, prefix: string): boolean {
  const p = pathForCompare(path)
  const base = pathForCompare(prefix)
  if (!p || !base) return false
  if (p === base) return true
  return p.startsWith(`${base}/`)
}
