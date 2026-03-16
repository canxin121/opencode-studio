import { apiJson } from '@/lib/api'

import { normalizePreviewProxyBasePath } from '../model/previewUrl'

export type WorkspacePreviewSession = {
  id: string
  state: string
  directory: string
  runDirectory: string
  opencodeSessionId?: string
  proxyBasePath: string
  targetUrl: string
  command: string
  args: string[]
  logsPath: string
  pid?: number
}

type PreviewSessionsResponse = {
  sessions: unknown
}

export function normalizeWorkspacePreviewSession(value: unknown): WorkspacePreviewSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null

  const state = typeof record.state === 'string' && record.state.trim() ? record.state.trim() : 'unknown'
  const directory = typeof record.directory === 'string' ? record.directory.trim() : ''
  if (!directory) return null

  const runDirectory =
    typeof record.runDirectory === 'string' && record.runDirectory.trim() ? record.runDirectory.trim() : ''
  if (!runDirectory) return null

  const proxyBasePath = normalizePreviewProxyBasePath(
    typeof record.proxyBasePath === 'string' ? record.proxyBasePath : '',
  )
  const targetUrl = typeof record.targetUrl === 'string' && record.targetUrl.trim() ? record.targetUrl.trim() : ''
  if (!targetUrl) return null

  const command = typeof record.command === 'string' && record.command.trim() ? record.command.trim() : ''
  if (!command) return null

  const args = Array.isArray(record.args) ? record.args.map((v) => String(v || '').trim()).filter(Boolean) : []
  if (args.length === 0) return null

  const logsPath = typeof record.logsPath === 'string' && record.logsPath.trim() ? record.logsPath.trim() : ''
  if (!logsPath) return null

  const pidRaw = typeof record.pid === 'number' ? record.pid : Number(record.pid)
  const pid = Number.isFinite(pidRaw) && pidRaw > 0 ? Math.floor(pidRaw) : undefined

  const opencodeSessionId =
    typeof record.opencodeSessionId === 'string' && record.opencodeSessionId.trim()
      ? record.opencodeSessionId.trim()
      : undefined

  return {
    id,
    state,
    directory,
    runDirectory,
    ...(opencodeSessionId ? { opencodeSessionId } : {}),
    proxyBasePath,
    targetUrl,
    command,
    args,
    logsPath,
    ...(pid ? { pid } : {}),
  }
}

function normalizePreviewSessions(payload: PreviewSessionsResponse): WorkspacePreviewSession[] {
  const source = Array.isArray(payload?.sessions) ? payload.sessions : []

  const sessions: WorkspacePreviewSession[] = []
  for (const item of source) {
    const session = normalizeWorkspacePreviewSession(item)
    if (session) sessions.push(session)
  }
  return sessions
}

export async function listWorkspacePreviewSessions(): Promise<WorkspacePreviewSession[]> {
  const payload = await apiJson<PreviewSessionsResponse>('/api/workspace/preview/sessions')
  return normalizePreviewSessions(payload)
}

export type WorkspacePreviewSessionCreateInput = {
  id: string
  directory: string
  runDirectory: string
  command: string
  args: string[]
  logsPath: string
  targetUrl: string
  opencodeSessionId?: string
}

export async function createWorkspacePreviewSession(
  input: WorkspacePreviewSessionCreateInput,
): Promise<WorkspacePreviewSession> {
  const trimmedId = String(input?.id || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  const trimmedDirectory = String(input?.directory || '').trim()
  if (!trimmedDirectory) throw new Error('Directory is required')

  const trimmedRunDirectory = String(input?.runDirectory || '').trim()
  if (!trimmedRunDirectory) throw new Error('Run directory is required')

  const trimmedCommand = String(input?.command || '').trim()
  if (!trimmedCommand) throw new Error('Command is required')

  const trimmedLogsPath = String(input?.logsPath || '').trim()
  if (!trimmedLogsPath) throw new Error('Logs path is required')

  const trimmedSessionId = String(input?.opencodeSessionId || '').trim()

  const args = Array.isArray(input?.args) ? input.args.map((v) => String(v || '').trim()).filter(Boolean) : []
  if (args.length === 0) throw new Error('Args is required')

  const targetUrl = String(input?.targetUrl || '').trim()
  if (!targetUrl) throw new Error('Target URL is required')

  const payload = await apiJson<unknown>('/api/workspace/preview/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: trimmedId,
      directory: trimmedDirectory,
      runDirectory: trimmedRunDirectory,
      command: trimmedCommand,
      args,
      logsPath: trimmedLogsPath,
      ...(trimmedSessionId ? { opencodeSessionId: trimmedSessionId } : {}),
      targetUrl,
    }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function discoverWorkspacePreviewSession(
  input: Omit<WorkspacePreviewSessionCreateInput, 'targetUrl'>,
): Promise<WorkspacePreviewSession> {
  const trimmedId = String(input?.id || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  const trimmedDirectory = String(input?.directory || '').trim()
  if (!trimmedDirectory) throw new Error('Directory is required')

  const trimmedRunDirectory = String(input?.runDirectory || '').trim()
  if (!trimmedRunDirectory) throw new Error('Run directory is required')

  const trimmedCommand = String(input?.command || '').trim()
  if (!trimmedCommand) throw new Error('Command is required')

  const trimmedLogsPath = String(input?.logsPath || '').trim()
  if (!trimmedLogsPath) throw new Error('Logs path is required')

  const trimmedSessionId = String(input?.opencodeSessionId || '').trim()
  const args = Array.isArray(input?.args) ? input.args.map((v) => String(v || '').trim()).filter(Boolean) : []
  if (args.length === 0) throw new Error('Args is required')

  const payload = await apiJson<unknown>('/api/workspace/preview/sessions/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: trimmedId,
      directory: trimmedDirectory,
      runDirectory: trimmedRunDirectory,
      command: trimmedCommand,
      args,
      logsPath: trimmedLogsPath,
      ...(trimmedSessionId ? { opencodeSessionId: trimmedSessionId } : {}),
    }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function updateWorkspacePreviewSession(
  sessionId: string,
  patch: {
    directory?: string
    runDirectory?: string
    opencodeSessionId?: string
    command?: string
    args?: string[]
    logsPath?: string
    targetUrl?: string
  },
): Promise<WorkspacePreviewSession> {
  const trimmedId = String(sessionId || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  const directory = typeof patch.directory === 'string' ? patch.directory.trim() : ''
  if (typeof patch.directory === 'string' && !directory) throw new Error('Directory is required')

  const runDirectory = typeof patch.runDirectory === 'string' ? patch.runDirectory.trim() : ''
  if (typeof patch.runDirectory === 'string' && !runDirectory) throw new Error('Run directory is required')

  const command = typeof patch.command === 'string' ? patch.command.trim() : ''
  if (typeof patch.command === 'string' && !command) throw new Error('Command is required')

  const logsPath = typeof patch.logsPath === 'string' ? patch.logsPath.trim() : ''
  if (typeof patch.logsPath === 'string' && !logsPath) throw new Error('Logs path is required')

  const targetUrl = typeof patch.targetUrl === 'string' ? patch.targetUrl.trim() : ''
  if (typeof patch.targetUrl === 'string' && !targetUrl) throw new Error('Target URL is required')

  const args = Array.isArray(patch.args) ? patch.args.map((v) => String(v || '').trim()).filter(Boolean) : []
  if (Array.isArray(patch.args) && args.length === 0) throw new Error('Args is required')

  const payload = await apiJson<unknown>(`/api/workspace/preview/sessions/${encodeURIComponent(trimmedId)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(typeof patch.directory === 'string' ? { directory } : {}),
      ...(typeof patch.runDirectory === 'string' ? { runDirectory } : {}),
      ...(typeof patch.opencodeSessionId === 'string' ? { opencodeSessionId: patch.opencodeSessionId.trim() } : {}),
      ...(typeof patch.command === 'string' ? { command } : {}),
      ...(Array.isArray(patch.args) ? { args } : {}),
      ...(typeof patch.logsPath === 'string' ? { logsPath } : {}),
      ...(typeof patch.targetUrl === 'string' ? { targetUrl } : {}),
    }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function deleteWorkspacePreviewSession(sessionId: string): Promise<void> {
  const trimmedId = String(sessionId || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  await apiJson<{ ok: boolean }>(`/api/workspace/preview/sessions/${encodeURIComponent(trimmedId)}`, {
    method: 'DELETE',
  })
}

export async function renameWorkspacePreviewSession(
  sessionId: string,
  newId: string,
): Promise<WorkspacePreviewSession> {
  const trimmedId = String(sessionId || '').trim()
  const trimmedNew = String(newId || '').trim()
  if (!trimmedId) throw new Error('Session id is required')
  if (!trimmedNew) throw new Error('New session id is required')

  const payload = await apiJson<unknown>(`/api/workspace/preview/sessions/${encodeURIComponent(trimmedId)}/rename`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: trimmedNew }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function startWorkspacePreviewSession(sessionId: string): Promise<WorkspacePreviewSession> {
  const trimmedId = String(sessionId || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  const payload = await apiJson<unknown>(`/api/workspace/preview/sessions/${encodeURIComponent(trimmedId)}/start`, {
    method: 'POST',
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function stopWorkspacePreviewSession(sessionId: string): Promise<WorkspacePreviewSession> {
  const trimmedId = String(sessionId || '').trim()
  if (!trimmedId) throw new Error('Session id is required')

  const payload = await apiJson<unknown>(`/api/workspace/preview/sessions/${encodeURIComponent(trimmedId)}/stop`, {
    method: 'POST',
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}
