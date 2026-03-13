import { apiJson } from '@/lib/api'

import { normalizePreviewProxyBasePath } from '../model/previewUrl'

export type WorkspacePreviewSession = {
  id: string
  state: string
  directory: string
  proxyBasePath: string
  targetUrl?: string
}

type PreviewSessionsResponse =
  | WorkspacePreviewSession[]
  | {
      sessions?: unknown
    }

type PreviewSessionResponse =
  | WorkspacePreviewSession
  | {
      session?: unknown
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

  return {
    id,
    state,
    directory,
    proxyBasePath,
    ...(targetUrl ? { targetUrl } : {}),
  }
}

function normalizePreviewSessions(payload: PreviewSessionsResponse): WorkspacePreviewSession[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { sessions?: unknown })?.sessions)
      ? ((payload as { sessions?: unknown[] }).sessions ?? [])
      : []

  const sessions: WorkspacePreviewSession[] = []
  for (const item of source) {
    const session = normalizeWorkspacePreviewSession(item)
    if (session) sessions.push(session)
  }
  return sessions
}

function normalizeSinglePreviewSession(payload: PreviewSessionResponse): WorkspacePreviewSession | null {
  const direct = normalizeWorkspacePreviewSession(payload)
  if (direct) return direct

  const wrapped = (payload as { session?: unknown })?.session
  return normalizeWorkspacePreviewSession(wrapped)
}

export async function listWorkspacePreviewSessions(directory?: string): Promise<WorkspacePreviewSession[]> {
  const trimmedDirectory = String(directory || '').trim()
  const query = trimmedDirectory ? `?directory=${encodeURIComponent(trimmedDirectory)}` : ''
  const payload = await apiJson<PreviewSessionsResponse>(`/api/workspace/preview/sessions${query}`)
  return normalizePreviewSessions(payload)
}

export async function createWorkspacePreviewSession(
  directory: string,
  targetUrl: string,
): Promise<WorkspacePreviewSession> {
  const payload = await apiJson<PreviewSessionResponse>('/api/workspace/preview/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      directory: String(directory || '').trim(),
      targetUrl: String(targetUrl || '').trim(),
    }),
  })

  const session = normalizeSinglePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}

export async function discoverWorkspacePreviewSession(directory: string): Promise<WorkspacePreviewSession> {
  const payload = await apiJson<PreviewSessionResponse>('/api/workspace/preview/sessions/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      directory: String(directory || '').trim(),
    }),
  })

  const session = normalizeSinglePreviewSession(payload)
  if (!session) throw new Error('Invalid preview session response')
  return session
}
