import { apiJson } from '@/lib/api'

import { normalizePreviewProxyBasePath } from '../model/previewUrl'

export type WorkspacePreviewSession = {
  id: string
  state: string
  directory: string
  opencodeSessionId?: string
  proxyBasePath: string
  targetUrl?: string
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
  const proxyBasePath = normalizePreviewProxyBasePath(
    typeof record.proxyBasePath === 'string' ? record.proxyBasePath : '',
  )
  const targetUrl =
    typeof record.targetUrl === 'string' && record.targetUrl.trim() ? record.targetUrl.trim() : undefined

  const opencodeSessionId =
    typeof record.opencodeSessionId === 'string' && record.opencodeSessionId.trim()
      ? record.opencodeSessionId.trim()
      : undefined

  return {
    id,
    state,
    directory,
    ...(opencodeSessionId ? { opencodeSessionId } : {}),
    proxyBasePath,
    ...(targetUrl ? { targetUrl } : {}),
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

export async function createWorkspacePreviewSession(
  directory: string | undefined,
  targetUrl: string,
  opencodeSessionId?: string,
): Promise<WorkspacePreviewSession> {
  const trimmedDirectory = String(directory || '').trim()
  const trimmedSessionId = String(opencodeSessionId || '').trim()
  const payload = await apiJson<unknown>('/api/workspace/preview/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(trimmedDirectory ? { directory: trimmedDirectory } : {}),
      ...(trimmedSessionId ? { opencodeSessionId: trimmedSessionId } : {}),
      targetUrl: String(targetUrl || '').trim(),
    }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function discoverWorkspacePreviewSession(
  directory: string | undefined,
  opencodeSessionId?: string,
): Promise<WorkspacePreviewSession> {
  const trimmedDirectory = String(directory || '').trim()
  const trimmedSessionId = String(opencodeSessionId || '').trim()
  const payload = await apiJson<unknown>('/api/workspace/preview/sessions/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(trimmedDirectory ? { directory: trimmedDirectory } : {}),
      ...(trimmedSessionId ? { opencodeSessionId: trimmedSessionId } : {}),
    }),
  })

  const session = normalizeWorkspacePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}
