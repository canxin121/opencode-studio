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

function asSessionRecord(value: unknown): WorkspacePreviewSession | null {
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
    const session = asSessionRecord(item)
    if (session) sessions.push(session)
  }
  return sessions
}

export async function listWorkspacePreviewSessions(directory?: string): Promise<WorkspacePreviewSession[]> {
  const trimmedDirectory = String(directory || '').trim()
  const query = trimmedDirectory ? `?directory=${encodeURIComponent(trimmedDirectory)}` : ''
  const payload = await apiJson<PreviewSessionsResponse>(`/api/workspace/preview/sessions${query}`)
  return normalizePreviewSessions(payload)
}
