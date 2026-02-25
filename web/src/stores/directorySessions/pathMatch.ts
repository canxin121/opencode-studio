function normalizeDirForCompare(path: string): string {
  const normalized = (path || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return normalized.toLowerCase()
  }
  return normalized
}

function isPathWithinDirectory(path: string, directoryPath: string): boolean {
  if (!path || !directoryPath) return false
  if (path === directoryPath) return true
  return path.startsWith(`${directoryPath}/`)
}

export function matchDirectoryEntryForPath<T extends { path?: string | null }>(
  entries: T[],
  directoryPath: string,
): T | null {
  const normalizedPath = normalizeDirForCompare(directoryPath)
  if (!normalizedPath) return null

  let exact: T | null = null
  let fallback: T | null = null
  let fallbackLen = -1
  for (const entry of entries) {
    const normalizedEntryPath = normalizeDirForCompare(String(entry?.path || ''))
    if (!normalizedEntryPath) continue
    if (normalizedEntryPath === normalizedPath) {
      exact = entry
      break
    }
    if (!isPathWithinDirectory(normalizedPath, normalizedEntryPath)) continue
    if (normalizedEntryPath.length <= fallbackLen) continue
    fallback = entry
    fallbackLen = normalizedEntryPath.length
  }

  return exact || fallback
}
