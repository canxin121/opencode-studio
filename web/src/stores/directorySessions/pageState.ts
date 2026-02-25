import type { SessionRuntimeState } from '../directorySessionRuntime'

type PageState<TSession> = {
  page: number
  totalRoots: number
  sessions: TSession[]
}

type RunningIndexEntry = {
  sessionId: string
  directoryId: string | null
  directoryPath: string | null
  runtime: SessionRuntimeState
  updatedAt: number
}

function toNonNegativeInt(input: unknown): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 0
  return value >= 0 ? value : 0
}

function collectPageRoots<TSession>(
  sessions: TSession[],
  opts: {
    readSessionId: (sessionLike: TSession) => string
    readParentId: (sessionLike: TSession) => string | null
  },
): { rootIds: string[]; rootBySessionId: Map<string, string> } {
  const byId = new Map<string, TSession>()
  for (const session of sessions) {
    const sid = opts.readSessionId(session)
    if (!sid) continue
    byId.set(sid, session)
  }

  const rootBySessionId = new Map<string, string>()
  const resolveRootId = (sessionId: string, trail?: Set<string>): string => {
    const cached = rootBySessionId.get(sessionId)
    if (cached) return cached

    if (!byId.has(sessionId)) {
      rootBySessionId.set(sessionId, sessionId)
      return sessionId
    }

    const seen = trail || new Set<string>()
    if (seen.has(sessionId)) {
      rootBySessionId.set(sessionId, sessionId)
      return sessionId
    }
    seen.add(sessionId)

    const session = byId.get(sessionId)
    const parentId = session ? opts.readParentId(session) : null
    if (!parentId || !byId.has(parentId)) {
      rootBySessionId.set(sessionId, sessionId)
      return sessionId
    }

    const rootId = resolveRootId(parentId, seen)
    rootBySessionId.set(sessionId, rootId)
    return rootId
  }

  const rootIds: string[] = []
  const seenRoots = new Set<string>()
  for (const session of sessions) {
    const sid = opts.readSessionId(session)
    if (!sid) continue
    const rootId = resolveRootId(sid)
    if (seenRoots.has(rootId)) continue
    seenRoots.add(rootId)
    rootIds.push(rootId)
  }

  return { rootIds, rootBySessionId }
}

function rootCountInPageSessions<TSession>(
  sessions: TSession[],
  opts: {
    readSessionId: (sessionLike: TSession) => string
    readParentId: (sessionLike: TSession) => string | null
  },
): number {
  return collectPageRoots(sessions, opts).rootIds.length
}

function trimPageSessionsByRootLimit<TSession>(
  sessions: TSession[],
  maxRootCount: number,
  opts: {
    readSessionId: (sessionLike: TSession) => string
    readParentId: (sessionLike: TSession) => string | null
  },
): TSession[] {
  const limit = toNonNegativeInt(maxRootCount)
  if (!Array.isArray(sessions) || sessions.length === 0) return []
  if (limit <= 0) return []

  const { rootIds, rootBySessionId } = collectPageRoots(sessions, opts)
  if (rootIds.length <= limit) return sessions

  const keepRootIds = new Set(rootIds.slice(0, limit))
  const out: TSession[] = []
  for (const session of sessions) {
    const sid = opts.readSessionId(session)
    if (!sid) continue
    const rootId = rootBySessionId.get(sid) || sid
    if (!keepRootIds.has(rootId)) continue
    out.push(session)
  }
  return out
}

export function upsertSessionInPageState<TSession>(
  page: PageState<TSession>,
  session: TSession,
  opts: {
    incrementRootTotal?: boolean
    maxRootCount?: number
    readSessionId: (sessionLike: TSession) => string
    readParentId: (sessionLike: TSession) => string | null
    equals: (left: TSession, right: TSession) => boolean
  },
): PageState<TSession> | null {
  const sid = opts.readSessionId(session)
  if (!sid) return null

  const baseSessions = Array.isArray(page.sessions) ? page.sessions : []
  const maxRootCount =
    typeof opts.maxRootCount === 'number' && Number.isFinite(opts.maxRootCount)
      ? Math.max(0, Math.floor(opts.maxRootCount))
      : 0
  const idx = baseSessions.findIndex((item) => opts.readSessionId(item) === sid)
  let sessionsChanged = false
  let nextSessions = baseSessions

  if (idx >= 0) {
    const current = baseSessions[idx]
    if (!current || !opts.equals(current, session)) {
      nextSessions = baseSessions.slice()
      nextSessions[idx] = session
      sessionsChanged = true
    }
  } else {
    const parentId = opts.readParentId(session)
    const hasRootCapacity =
      maxRootCount <= 0 ||
      rootCountInPageSessions(baseSessions, {
        readSessionId: opts.readSessionId,
        readParentId: opts.readParentId,
      }) < maxRootCount
    const shouldInsert =
      (!parentId && page.page === 0 && hasRootCapacity) ||
      (parentId ? baseSessions.some((item) => opts.readSessionId(item) === parentId) : false)
    if (shouldInsert) {
      nextSessions = baseSessions.slice()
      nextSessions.push(session)
      sessionsChanged = true
    }
  }

  const currentTotal = toNonNegativeInt(page.totalRoots)
  const nextTotal = opts.incrementRootTotal ? currentTotal + 1 : currentTotal
  const totalChanged = nextTotal !== currentTotal

  let resolvedSessions = sessionsChanged ? nextSessions : baseSessions
  if (maxRootCount > 0) {
    const trimmed = trimPageSessionsByRootLimit(resolvedSessions, maxRootCount, {
      readSessionId: opts.readSessionId,
      readParentId: opts.readParentId,
    })
    if (trimmed !== resolvedSessions) {
      resolvedSessions = trimmed
      sessionsChanged = true
    }
  }

  if (!sessionsChanged && !totalChanged) return null

  return {
    ...page,
    sessions: sessionsChanged ? resolvedSessions : baseSessions,
    totalRoots: nextTotal,
  }
}

export function removeSessionFromPageState<TSession>(
  page: PageState<TSession>,
  sessionId: string,
  opts: {
    decrementRootTotal?: boolean
    readSessionId: (sessionLike: TSession) => string
  },
): PageState<TSession> | null {
  const sid = (sessionId || '').trim()
  if (!sid) return null

  const baseSessions = Array.isArray(page.sessions) ? page.sessions : []
  const nextSessions = baseSessions.filter((item) => opts.readSessionId(item) !== sid)
  const sessionsChanged = nextSessions.length !== baseSessions.length

  const currentTotal = toNonNegativeInt(page.totalRoots)
  const nextTotal = opts.decrementRootTotal ? Math.max(0, currentTotal - 1) : currentTotal
  const totalChanged = nextTotal !== currentTotal
  if (!sessionsChanged && !totalChanged) return null

  return {
    ...page,
    sessions: sessionsChanged ? nextSessions : baseSessions,
    totalRoots: nextTotal,
  }
}

export function upsertRuntimeOnlyRunningIndexEntry(
  entries: RunningIndexEntry[],
  total: number,
  patch: {
    sessionId: string
    runtime: SessionRuntimeState
    directoryIdHint?: string | null
    nowMs: number
  },
): { entries: RunningIndexEntry[]; total: number } {
  const sid = (patch.sessionId || '').trim()
  if (!sid) return { entries, total }

  const next = entries.slice()
  const idx = next.findIndex((item) => item.sessionId === sid)
  const current = idx >= 0 ? next[idx] : null
  const directoryId = (patch.directoryIdHint || '').trim() || current?.directoryId || null
  const nextEntry: RunningIndexEntry = {
    sessionId: sid,
    directoryId,
    directoryPath: current?.directoryPath || null,
    runtime: patch.runtime,
    updatedAt: Math.max(current?.updatedAt || 0, toNonNegativeInt(patch.nowMs)),
  }

  if (idx >= 0) {
    next[idx] = { ...current, ...nextEntry }
  } else {
    next.push(nextEntry)
  }

  next.sort((a, b) => {
    const diff = b.updatedAt - a.updatedAt
    if (diff !== 0) return diff
    return a.sessionId.localeCompare(b.sessionId)
  })

  return {
    entries: next,
    total: idx >= 0 ? Math.max(0, toNonNegativeInt(total)) : Math.max(toNonNegativeInt(total), next.length),
  }
}
