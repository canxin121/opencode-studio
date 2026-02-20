export type TerminalCreateResponse = { sessionId: string; cols: number; rows: number }

export type TerminalSessionInfo = { sessionId: string; cwd: string }

export type TerminalUiSessionMeta = {
  name?: string
  pinned?: boolean
  folderId?: string
  lastUsedAt?: number
}

export type TerminalUiFolder = {
  id: string
  name: string
}

export type TerminalUiState = {
  version: number
  updatedAt: number
  activeSessionId: string | null
  sessionIds: string[]
  sessionMetaById: Record<string, TerminalUiSessionMeta>
  folders: TerminalUiFolder[]
}

import { ApiError, apiJson, apiText } from '@/lib/api'
import type { JsonValue as JsonLike } from '@/types/json'

function asObject(value: JsonLike): Record<string, JsonLike> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function toFiniteNumber(value: JsonLike, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeSessionId(value: JsonLike): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCollapsedName(value: JsonLike, maxLen: number): string {
  const raw = typeof value === 'string' ? value : ''
  const collapsed = raw.replace(/\s+/g, ' ').trim().slice(0, maxLen)
  return collapsed
}

function parseTerminalUiFolder(value: JsonLike): TerminalUiFolder | null {
  const record = asObject(value)
  if (!record) return null
  const id = normalizeSessionId(record.id)
  const name = normalizeCollapsedName(record.name, 40)
  if (!id || !name) return null
  return { id, name }
}

function parseTerminalUiSessionMeta(value: JsonLike): TerminalUiSessionMeta | null {
  const record = asObject(value)
  if (!record) return null

  const out: TerminalUiSessionMeta = {}
  const name = normalizeCollapsedName(record.name, 80)
  if (name) out.name = name

  const folderId = normalizeSessionId(record.folderId)
  if (folderId) out.folderId = folderId

  if (record.pinned === true) out.pinned = true

  const rawLastUsedAt = toFiniteNumber(record.lastUsedAt, 0)
  if (rawLastUsedAt > 0) out.lastUsedAt = Math.floor(rawLastUsedAt)

  return Object.keys(out).length > 0 ? out : null
}

function parseTerminalUiState(payload: JsonLike): TerminalUiState {
  const record = asObject(payload) || {}

  const rawSessionIds = Array.isArray(record.sessionIds) ? record.sessionIds : []
  const sessionIds: string[] = []
  const seen = new Set<string>()
  for (const item of rawSessionIds) {
    const sid = normalizeSessionId(item)
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    sessionIds.push(sid)
  }

  const rawFolders = Array.isArray(record.folders) ? record.folders : []
  const folders: TerminalUiFolder[] = []
  const seenFolder = new Set<string>()
  for (const item of rawFolders) {
    const folder = parseTerminalUiFolder(item)
    if (!folder) continue
    if (seenFolder.has(folder.id)) continue
    seenFolder.add(folder.id)
    folders.push(folder)
  }

  const sessionMetaById: Record<string, TerminalUiSessionMeta> = {}
  const rawMetaMap = asObject(record.sessionMetaById) || {}
  for (const [rawId, rawMeta] of Object.entries(rawMetaMap)) {
    const sid = normalizeSessionId(rawId)
    if (!sid) continue
    const meta = parseTerminalUiSessionMeta(rawMeta)
    if (!meta) continue
    sessionMetaById[sid] = meta
  }

  const activeSessionIdValue = normalizeSessionId(record.activeSessionId)
  const activeSessionId = activeSessionIdValue || null

  return {
    version: Math.max(0, Math.floor(toFiniteNumber(record.version, 0))),
    updatedAt: Math.max(0, Math.floor(toFiniteNumber(record.updatedAt, 0))),
    activeSessionId,
    sessionIds,
    sessionMetaById,
    folders,
  }
}

function parseCreateResponse(payload: JsonLike): TerminalCreateResponse {
  const record = asObject(payload) || {}
  return {
    sessionId: String(record.sessionId || ''),
    cols: toFiniteNumber(record.cols, 0),
    rows: toFiniteNumber(record.rows, 0),
  }
}

function terminalPath(id: string): string {
  return `/api/terminal/${encodeURIComponent(id)}`
}

function terminalUiStatePath(): string {
  return '/api/ui/terminal/state'
}

export async function createTerminalSession(input: {
  cwd: string
  cols: number
  rows: number
}): Promise<TerminalCreateResponse> {
  const payload = await apiJson<JsonLike>('/api/terminal/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseCreateResponse(payload)
}

export async function getTerminalSessionInfo(id: string): Promise<TerminalSessionInfo | null> {
  try {
    const payload = await apiJson<JsonLike>(terminalPath(id))
    const json = asObject(payload) || {}
    return {
      sessionId: String(json.sessionId || id),
      cwd: String(json.cwd || ''),
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function sendTerminalInput(id: string, data: string): Promise<void> {
  await apiText(`${terminalPath(id)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: data,
  })
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  await apiText(`${terminalPath(id)}/resize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  })
}

export async function deleteTerminalSession(id: string): Promise<void> {
  await apiText(terminalPath(id), { method: 'DELETE' })
}

export async function restartTerminalSession(input: {
  id: string
  cwd: string
  cols: number
  rows: number
}): Promise<TerminalCreateResponse> {
  const payload = await apiJson<JsonLike>(`${terminalPath(input.id)}/restart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: input.cwd, cols: input.cols, rows: input.rows }),
  })
  return parseCreateResponse(payload)
}

export function terminalStreamUrl(id: string, since?: number): string {
  const base = `/api/terminal/${encodeURIComponent(id)}/stream`
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return base
  return `${base}?since=${Math.floor(since)}`
}

export async function getTerminalUiState(): Promise<TerminalUiState> {
  const payload = await apiJson<JsonLike>(terminalUiStatePath())
  return parseTerminalUiState(payload)
}

export async function putTerminalUiState(input: TerminalUiState): Promise<TerminalUiState> {
  const payload = await apiJson<JsonLike>(terminalUiStatePath(), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseTerminalUiState(payload)
}

export function terminalUiStateEventsUrl(since?: number): string {
  const base = '/api/ui/terminal/state/events'
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return base
  return `${base}?since=${Math.floor(since)}`
}
