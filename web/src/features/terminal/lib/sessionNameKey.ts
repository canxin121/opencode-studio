export type TerminalSessionMeta = {
  name?: string
  pinned?: boolean
  folderId?: string
  lastUsedAt?: number
}

const MAX_TERMINAL_NAME_LEN = 80

function normalizeNameKey(input: string): string {
  return input.trim().toLowerCase()
}

function clipChars(input: string, maxLen: number): string {
  return Array.from(input).slice(0, maxLen).join('')
}

export function normalizeTerminalSessionName(input: unknown): string {
  const collapsed = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  return clipChars(collapsed, MAX_TERMINAL_NAME_LEN)
}

export function createUniqueTerminalSessionName(
  candidate: unknown,
  usedNameKeys: Set<string>,
  opts?: { fallbackBase?: string },
): string {
  const fallback = normalizeTerminalSessionName(opts?.fallbackBase || 'Terminal') || 'Terminal'
  const base = normalizeTerminalSessionName(candidate) || fallback
  const baseKey = normalizeNameKey(base)
  if (!usedNameKeys.has(baseKey)) {
    usedNameKeys.add(baseKey)
    return base
  }

  for (let n = 2; n < 10000; n += 1) {
    const suffix = ` (${n})`
    const maxBaseLen = Math.max(1, MAX_TERMINAL_NAME_LEN - suffix.length)
    const clippedBase = clipChars(base, maxBaseLen)
    const next = `${clippedBase}${suffix}`
    const nextKey = normalizeNameKey(next)
    if (usedNameKeys.has(nextKey)) continue
    usedNameKeys.add(nextKey)
    return next
  }

  const forced = `${clipChars(base, 70)} ${Date.now()}`
  const forcedKey = normalizeNameKey(forced)
  usedNameKeys.add(forcedKey)
  return forced
}

export function ensureTerminalSessionNames(
  sessionIds: string[],
  sessionMetaById: Record<string, TerminalSessionMeta>,
  opts?: { fallbackBase?: string },
): { sessionMetaById: Record<string, TerminalSessionMeta>; changed: boolean } {
  const usedNameKeys = new Set<string>()
  const nextNameById: Record<string, string> = {}
  const nextMetaById: Record<string, TerminalSessionMeta> = {}
  let changed = false

  for (const id of sessionIds) {
    const sid = String(id || '').trim()
    if (!sid) continue
    const current = sessionMetaById[sid] || {}
    const normalizedCurrent = normalizeTerminalSessionName(current.name)
    if (!normalizedCurrent) continue
    nextNameById[sid] = createUniqueTerminalSessionName(normalizedCurrent, usedNameKeys, opts)
  }

  for (const id of sessionIds) {
    const sid = String(id || '').trim()
    if (!sid) continue
    const current = sessionMetaById[sid] || {}
    const nextName =
      nextNameById[sid] ||
      createUniqueTerminalSessionName(current.name, usedNameKeys, {
        fallbackBase: opts?.fallbackBase,
      })
    if (normalizeTerminalSessionName(current.name) !== nextName) {
      changed = true
    }
    nextMetaById[sid] = {
      ...current,
      name: nextName,
    }
  }

  if (!changed) {
    if (Object.keys(nextMetaById).length !== Object.keys(sessionMetaById).length) {
      changed = true
    }
  }

  return {
    sessionMetaById: nextMetaById,
    changed,
  }
}

export function resolveSessionIdByName(
  sessionIds: string[],
  sessionMetaById: Record<string, TerminalSessionMeta>,
  name: unknown,
): string | null {
  const expected = normalizeTerminalSessionName(name)
  if (!expected) return null
  const expectedKey = normalizeNameKey(expected)

  for (const rawId of sessionIds) {
    const sid = String(rawId || '').trim()
    if (!sid) continue
    const actual = normalizeTerminalSessionName(sessionMetaById[sid]?.name)
    if (!actual) continue
    if (normalizeNameKey(actual) === expectedKey) {
      return sid
    }
  }

  return null
}
