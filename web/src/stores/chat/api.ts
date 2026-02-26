import { apiJson } from '../../lib/api'
import { parseSessionPayloadConsistency, type SessionPayloadConsistency } from '../sessionConsistency'

import type { MessageEntry, Session, SessionFileDiff } from '../../types/chat'
import type { GitDiffMeta } from '@/types/git'
import type { JsonObject, JsonValue } from '@/types/json'

type SessionListOptions = {
  offset?: number
  limit?: number
  includeTotal?: boolean
  roots?: boolean
  includeChildren?: boolean
  scope?: 'directory' | 'project'
  ids?: string[]
  focusSessionId?: string
  search?: string
  signal?: AbortSignal
}

export type SessionListResponse = {
  sessions: Session[]
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
  nextOffset?: number
  focusRootId?: string
  focusRootIndex?: number
  consistency?: ApiConsistency
}

export type ApiConsistency = SessionPayloadConsistency

export type MessageListResponse = {
  entries: MessageEntry[]
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
  nextOffset?: number
  consistency?: ApiConsistency
}

export type SessionDiffPageResponse = {
  items: SessionFileDiff[]
  total?: number
  offset: number
  limit: number
  hasMore: boolean
  nextOffset?: number
}

function toTextTrimmed(value: JsonValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstText(record: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const text = toTextTrimmed(record[key])
    if (text) return text
  }
  return ''
}

function firstString(record: JsonObject, keys: string[]): string {
  const parseTextLike = (value: JsonValue, depth = 0): string | null => {
    if (depth > 4 || value == null) return null
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
      const lines: string[] = []
      for (const entry of value) {
        const text = parseTextLike(entry, depth + 1)
        if (text == null || !text.length) continue
        lines.push(text)
      }
      return lines.length ? lines.join('\n') : ''
    }
    const nested = asRecord(value)
    if (!Object.keys(nested).length) return null

    for (const key of ['text', 'content', 'value', 'line', 'raw']) {
      const text = parseTextLike(nested[key], depth + 1)
      if (text != null) return text
    }
    if (Object.prototype.hasOwnProperty.call(nested, 'lines')) {
      const text = parseTextLike(nested.lines, depth + 1)
      if (text != null) return text
    }
    return null
  }

  for (const key of keys) {
    const text = parseTextLike(record[key])
    if (text != null) return text
  }
  return ''
}

function firstCount(record: JsonObject, keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value))
    }
  }
  return 0
}

function readDiffMeta(record: JsonObject): GitDiffMeta | null {
  const candidate = record.meta ?? record.diffMeta ?? record.diff_meta
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as unknown as GitDiffMeta
  }
  if (Array.isArray(record.fileHeader) || Array.isArray(record.hunks)) {
    return record as unknown as GitDiffMeta
  }
  return null
}

function looksLikeSessionFileDiffRecord(record: JsonObject): boolean {
  const hasBeforeAfter =
    typeof record.before === 'string' ||
    typeof record.after === 'string' ||
    Array.isArray(record.before) ||
    Array.isArray(record.after) ||
    Array.isArray(record.old) ||
    Array.isArray(record.new) ||
    Array.isArray(record.beforeLines) ||
    Array.isArray(record.afterLines)
  return Boolean(
    firstText(record, ['file', 'path', 'filename', 'name', 'target', 'filePath', 'filepath', 'relativePath']) ||
    hasBeforeAfter ||
    typeof record.patch === 'string' ||
    typeof record.diff === 'string' ||
    Array.isArray(record.patch) ||
    Array.isArray(record.diff) ||
    typeof record.additions === 'number' ||
    typeof record.deletions === 'number',
  )
}

function readSessionDiffItems(value: JsonValue, depth = 0): JsonValue[] {
  if (depth > 4) return []
  if (Array.isArray(value)) return value

  const record = asRecord(value)
  if (!Object.keys(record).length) return []

  if (looksLikeSessionFileDiffRecord(record)) return [record]

  const wrapperKeys = [
    'files',
    'changes',
    'diff',
    'diffs',
    'entries',
    'items',
    'list',
    'value',
    'data',
    'payload',
    'result',
  ]
  for (const key of wrapperKeys) {
    const items = readSessionDiffItems(record[key], depth + 1)
    if (items.length) return items
  }

  for (const nested of Object.values(record)) {
    if (!Array.isArray(nested)) continue
    if (
      nested.some((entry) => {
        const row = asRecord(entry)
        return Object.keys(row).length > 0 && looksLikeSessionFileDiffRecord(row)
      })
    ) {
      return nested
    }
  }

  return []
}

function parseSessionFileDiff(value: JsonValue): SessionFileDiff | null {
  const record = asRecord(value)
  const file = firstText(record, ['file', 'path', 'filename', 'name', 'target', 'filePath', 'filepath', 'relativePath'])
  if (!file) return null
  const diff = firstString(record, ['diff', 'patch'])
  const meta = readDiffMeta(record)
  return {
    file,
    before: firstString(record, [
      'before',
      'old',
      'oldText',
      'beforeLines',
      'oldLines',
      'original',
      'previous',
      'prev',
      'from',
      'left',
      'a',
    ]),
    after: firstString(record, [
      'after',
      'new',
      'newText',
      'afterLines',
      'newLines',
      'modified',
      'current',
      'next',
      'to',
      'right',
      'b',
    ]),
    additions: firstCount(record, ['additions', 'added', 'insertions', 'linesAdded', 'add']),
    deletions: firstCount(record, ['deletions', 'removed', 'linesDeleted', 'del']),
    ...(diff ? { diff } : {}),
    ...(meta ? { meta } : {}),
  }
}

export function normalizeSessionDiffPayload(payload: JsonValue): SessionFileDiff[] {
  const items = readSessionDiffItems(payload)
  if (!items.length) return []
  return items.map((item) => parseSessionFileDiff(item)).filter((item): item is SessionFileDiff => Boolean(item))
}

function readBoolean(value: JsonValue): boolean | undefined {
  if (typeof value === 'boolean') return value
  return undefined
}

function readOptionalInt(value: JsonValue): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

export function normalizeSessionDiffPagePayload(
  payload: JsonValue,
  opts?: { fallbackOffset?: number; fallbackLimit?: number },
): SessionDiffPageResponse {
  const fallbackOffset =
    typeof opts?.fallbackOffset === 'number' && Number.isFinite(opts.fallbackOffset)
      ? Math.max(0, Math.floor(opts.fallbackOffset))
      : 0
  const fallbackLimit =
    typeof opts?.fallbackLimit === 'number' && Number.isFinite(opts.fallbackLimit)
      ? Math.max(1, Math.floor(opts.fallbackLimit))
      : 100

  const body = asRecord(payload)
  const items = normalizeSessionDiffPayload(payload)

  const offsetRaw = readOptionalInt(body.offset ?? body.start)
  const limitRaw = readOptionalInt(body.limit ?? body.pageSize)
  const totalRaw = readOptionalInt(body.total)
  const nextOffsetRaw = readOptionalInt(body.nextOffset ?? body.next_offset ?? body.next)
  const hasMoreRaw = readBoolean(body.hasMore ?? body.has_more)

  const offset = offsetRaw ?? fallbackOffset
  const limit = Math.max(1, limitRaw ?? fallbackLimit)
  const inferredNextOffset = offset + items.length
  const inferredHasMoreFromTotal = typeof totalRaw === 'number' ? inferredNextOffset < totalRaw : undefined
  const inferredHasMoreFromPage = items.length >= limit
  const nextOffset = nextOffsetRaw ?? (inferredHasMoreFromPage ? inferredNextOffset : undefined)

  let hasMore =
    hasMoreRaw ??
    (typeof nextOffsetRaw === 'number' ? nextOffsetRaw > inferredNextOffset : undefined) ??
    inferredHasMoreFromTotal ??
    inferredHasMoreFromPage

  if (!items.length || (typeof nextOffset === 'number' && nextOffset <= offset)) {
    hasMore = false
  }

  return {
    items,
    ...(typeof totalRaw === 'number' ? { total: totalRaw } : {}),
    offset,
    limit,
    hasMore,
    ...(hasMore && typeof nextOffset === 'number' ? { nextOffset } : {}),
  }
}

type AttentionListOptions = {
  sessionId?: string
  offset?: number
  limit?: number
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: JsonValue): JsonObject {
  return isRecord(value) ? value : {}
}

function toNonNegativeInt(value: JsonValue): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

function directoryQuery(directory?: string | null): string {
  const dir = typeof directory === 'string' ? directory.trim() : ''
  return dir ? `?directory=${encodeURIComponent(dir)}` : ''
}

export async function listSessions(directory?: string | null, opts?: SessionListOptions): Promise<SessionListResponse> {
  const q = directoryQuery(directory)
  const params: string[] = []
  if (typeof opts?.offset === 'number' && Number.isFinite(opts.offset)) {
    params.push(`offset=${encodeURIComponent(String(Math.max(0, Math.floor(opts.offset))))}`)
  }
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
    params.push(`limit=${encodeURIComponent(String(Math.max(0, Math.floor(opts.limit))))}`)
  }
  if (opts?.roots) {
    params.push('roots=true')
  }
  if (opts?.includeChildren) {
    params.push('includeChildren=true')
  }
  if (opts?.scope) {
    params.push(`scope=${encodeURIComponent(opts.scope)}`)
  }
  const search = typeof opts?.search === 'string' ? opts.search.trim() : ''
  if (search) {
    params.push(`search=${encodeURIComponent(search)}`)
  }
  const focusId = typeof opts?.focusSessionId === 'string' ? opts.focusSessionId.trim() : ''
  if (focusId) {
    params.push(`focusSessionId=${encodeURIComponent(focusId)}`)
  }
  const ids = Array.isArray(opts?.ids) ? opts?.ids : []
  const filteredIds = ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => id.length > 0)
  if (filteredIds.length) {
    params.push(`ids=${encodeURIComponent(filteredIds.join(','))}`)
  }
  const includeTotal = opts?.includeTotal !== false
  if (includeTotal) {
    params.push('includeTotal=true')
  }
  const sep = q && params.length ? '&' : '?'
  const suffix = params.length ? `${sep}${params.join('&')}` : ''
  const payload = await apiJson<JsonValue>(
    `/api/session${q}${suffix}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  )
  if (Array.isArray(payload)) {
    return { sessions: payload.filter((entry): entry is Session => isRecord(entry)) }
  }
  const body = asRecord(payload)
  const rawSessions = body.sessions
  const sessions = Array.isArray(rawSessions) ? rawSessions.filter((entry): entry is Session => isRecord(entry)) : []
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? Number(body.total) : undefined
  return {
    sessions,
    total,
    offset: typeof body.offset === 'number' ? body.offset : undefined,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
    hasMore: typeof body.hasMore === 'boolean' ? body.hasMore : undefined,
    nextOffset: typeof body.nextOffset === 'number' ? body.nextOffset : undefined,
    focusRootId: typeof body.focusRootId === 'string' ? body.focusRootId : undefined,
    focusRootIndex: typeof body.focusRootIndex === 'number' ? body.focusRootIndex : undefined,
    consistency: parseSessionPayloadConsistency(body.consistency),
  }
}

export async function listSessionStatus(directory?: string | null, opts?: { sessionId?: string }): Promise<JsonObject> {
  const q = directoryQuery(directory)
  const params: string[] = []
  const sid = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : ''
  if (sid) params.push(`sessionId=${encodeURIComponent(sid)}`)
  const sep = q && params.length ? '&' : '?'
  const suffix = params.length ? `${sep}${params.join('&')}` : ''
  return await apiJson<JsonObject>(`/api/session/status${q}${suffix}`)
}

const locateSessionInFlight = new Map<string, Promise<JsonValue>>()

export async function locateSession(sessionId: string): Promise<JsonValue> {
  const sid = String(sessionId || '').trim()
  const key = sid || String(sessionId || '')
  const existing = locateSessionInFlight.get(key)
  if (existing) return await existing

  const task = apiJson<JsonValue>(`/api/opencode-studio/session-locate?sessionId=${encodeURIComponent(sid)}`).finally(
    () => {
      locateSessionInFlight.delete(key)
    },
  )
  locateSessionInFlight.set(key, task)
  return await task
}

export async function createSession(directory?: string | null): Promise<Session> {
  return await apiJson<Session>(`/api/session${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export async function deleteSession(sessionId: string, directory?: string | null): Promise<void> {
  await apiJson(`/api/session/${encodeURIComponent(sessionId)}${directoryQuery(directory)}`, { method: 'DELETE' })
}

export async function patchSessionTitle(sessionId: string, title: string, directory?: string | null): Promise<Session> {
  return await apiJson<Session>(`/api/session/${encodeURIComponent(sessionId)}${directoryQuery(directory)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

export async function shareSession(sessionId: string, directory?: string | null): Promise<Session> {
  return await apiJson<Session>(`/api/session/${encodeURIComponent(sessionId)}/share${directoryQuery(directory)}`, {
    method: 'POST',
  })
}

export async function unshareSession(sessionId: string, directory?: string | null): Promise<Session> {
  return await apiJson<Session>(`/api/session/${encodeURIComponent(sessionId)}/share${directoryQuery(directory)}`, {
    method: 'DELETE',
  })
}

export async function summarizeSession(
  sessionId: string,
  providerID: string,
  modelID: string,
  directory?: string | null,
): Promise<void> {
  await apiJson(`/api/session/${encodeURIComponent(sessionId)}/summarize${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerID, modelID, auto: false }),
  })
}

export async function abortSession(sessionId: string, directory?: string | null): Promise<void> {
  await apiJson(`/api/session/${encodeURIComponent(sessionId)}/abort${directoryQuery(directory)}`, { method: 'POST' })
}

export async function sendMessage(sessionId: string, payload: JsonValue, directory?: string | null): Promise<void> {
  await apiJson(`/api/session/${encodeURIComponent(sessionId)}/message${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function listMessages(
  sessionId: string,
  limit: number,
  directory?: string | null,
  offset?: number,
): Promise<MessageListResponse> {
  const q = directoryQuery(directory)
  const sep = q ? '&' : '?'
  const params: string[] = []
  params.push(`limit=${encodeURIComponent(String(limit))}`)
  params.push('includeTotal=true')
  if (typeof offset === 'number' && Number.isFinite(offset)) {
    params.push(`offset=${encodeURIComponent(String(Math.max(0, Math.floor(offset))))}`)
  }
  const payload = await apiJson<JsonValue>(
    `/api/session/${encodeURIComponent(sessionId)}/message${q}${sep}${params.join('&')}`,
  )
  if (Array.isArray(payload)) {
    return {
      entries: payload.filter((entry): entry is MessageEntry => isRecord(entry)),
    }
  }

  const body = asRecord(payload)
  const rawEntries = body.entries
  const entries = Array.isArray(rawEntries) ? rawEntries.filter((entry): entry is MessageEntry => isRecord(entry)) : []
  return {
    entries,
    total: toNonNegativeInt(body.total),
    offset: toNonNegativeInt(body.offset),
    limit: toNonNegativeInt(body.limit),
    hasMore: typeof body.hasMore === 'boolean' ? body.hasMore : undefined,
    nextOffset: toNonNegativeInt(body.nextOffset),
    consistency: parseSessionPayloadConsistency(body.consistency),
  }
}

export async function getMessagePartDetail(
  sessionId: string,
  messageId: string,
  partId: string,
  directory?: string | null,
): Promise<JsonValue> {
  const sid = (sessionId || '').trim()
  const mid = (messageId || '').trim()
  const pid = (partId || '').trim()
  if (!sid || !mid || !pid) throw new Error('sessionId, messageId, and partId are required')
  return await apiJson<JsonValue>(
    `/api/session/${encodeURIComponent(sid)}/message/${encodeURIComponent(mid)}/part/${encodeURIComponent(pid)}${directoryQuery(directory)}`,
  )
}

export async function replyPermission(
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  directory?: string | null,
  message?: string,
): Promise<boolean> {
  const body: { reply: 'once' | 'always' | 'reject'; message?: string } = { reply }
  if (typeof message === 'string' && message.trim()) body.message = message.trim()

  return await apiJson<boolean>(`/api/permission/${encodeURIComponent(requestId)}/reply${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function listPermissions(directory?: string | null, opts?: AttentionListOptions): Promise<JsonObject[]> {
  const q = directoryQuery(directory)
  const params: string[] = []
  const sid = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : ''
  if (sid) params.push(`sessionId=${encodeURIComponent(sid)}`)
  if (typeof opts?.offset === 'number' && Number.isFinite(opts.offset)) {
    params.push(`offset=${encodeURIComponent(String(Math.max(0, Math.floor(opts.offset))))}`)
  }
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
    params.push(`limit=${encodeURIComponent(String(Math.max(0, Math.floor(opts.limit))))}`)
  }
  const sep = q && params.length ? '&' : '?'
  const suffix = params.length ? `${sep}${params.join('&')}` : ''
  const list = await apiJson<JsonValue>(`/api/permission${q}${suffix}`)
  return Array.isArray(list) ? list.filter((entry): entry is JsonObject => isRecord(entry)) : []
}

export async function listQuestions(directory?: string | null, opts?: AttentionListOptions): Promise<JsonObject[]> {
  const q = directoryQuery(directory)
  const params: string[] = []
  const sid = typeof opts?.sessionId === 'string' ? opts.sessionId.trim() : ''
  if (sid) params.push(`sessionId=${encodeURIComponent(sid)}`)
  if (typeof opts?.offset === 'number' && Number.isFinite(opts.offset)) {
    params.push(`offset=${encodeURIComponent(String(Math.max(0, Math.floor(opts.offset))))}`)
  }
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
    params.push(`limit=${encodeURIComponent(String(Math.max(0, Math.floor(opts.limit))))}`)
  }
  const sep = q && params.length ? '&' : '?'
  const suffix = params.length ? `${sep}${params.join('&')}` : ''
  const list = await apiJson<JsonValue>(`/api/question${q}${suffix}`)
  return Array.isArray(list) ? list.filter((entry): entry is JsonObject => isRecord(entry)) : []
}

export async function replyQuestion(
  requestId: string,
  answers: string[][],
  directory?: string | null,
): Promise<boolean> {
  return await apiJson<boolean>(`/api/question/${encodeURIComponent(requestId)}/reply${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
}

export async function rejectQuestion(requestId: string, directory?: string | null): Promise<boolean> {
  return await apiJson<boolean>(`/api/question/${encodeURIComponent(requestId)}/reject${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

export async function revertSession(
  sessionId: string,
  messageID: string,
  directory?: string | null,
): Promise<JsonValue> {
  return await apiJson<JsonValue>(`/api/session/${encodeURIComponent(sessionId)}/revert${directoryQuery(directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageID }),
  })
}

export async function unrevertSession(sessionId: string, directory?: string | null): Promise<JsonValue> {
  return await apiJson<JsonValue>(
    `/api/session/${encodeURIComponent(sessionId)}/unrevert${directoryQuery(directory)}`,
    {
      method: 'POST',
    },
  )
}

export async function getSessionDiff(
  sessionId: string,
  directory?: string | null,
  opts?: { messageID?: string; offset?: number; limit?: number },
): Promise<SessionDiffPageResponse> {
  const sid = String(sessionId || '').trim()
  if (!sid) {
    return {
      items: [],
      offset: 0,
      limit: Math.max(1, Math.floor(opts?.limit || 100)),
      hasMore: false,
    }
  }

  const q = directoryQuery(directory)
  const params: string[] = []
  const messageID = typeof opts?.messageID === 'string' ? opts.messageID.trim() : ''
  const offset =
    typeof opts?.offset === 'number' && Number.isFinite(opts.offset) ? Math.max(0, Math.floor(opts.offset)) : 0
  const limit =
    typeof opts?.limit === 'number' && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : 100
  if (offset > 0) params.push(`offset=${encodeURIComponent(String(offset))}`)
  if (limit > 0) params.push(`limit=${encodeURIComponent(String(limit))}`)
  if (messageID) params.push(`messageID=${encodeURIComponent(messageID)}`)
  const sep = q && params.length ? '&' : '?'
  const suffix = params.length ? `${sep}${params.join('&')}` : ''
  const payload = await apiJson<JsonValue>(`/api/session/${encodeURIComponent(sid)}/diff${q}${suffix}`)
  return normalizeSessionDiffPagePayload(payload, {
    fallbackOffset: offset,
    fallbackLimit: limit,
  })
}
