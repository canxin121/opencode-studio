import { apiJson } from '@/lib/api'

import type { JsonValue as JsonLike } from '@/types/json'
import type { PluginActionResponse, PluginListResponse, PluginManifestResponse } from '@/plugins/host/types'

export async function fetchPluginList(): Promise<PluginListResponse> {
  return await apiJson<PluginListResponse>('/api/plugins')
}

export async function fetchPluginManifest(pluginId: string): Promise<PluginManifestResponse> {
  const id = String(pluginId || '').trim()
  if (!id) throw new Error('Plugin id is required')
  return await apiJson<PluginManifestResponse>(`/api/plugins/${encodeURIComponent(id)}/manifest`)
}

export async function invokePluginAction(
  pluginId: string,
  action: string,
  payload: JsonLike = null,
  context: JsonLike = null,
): Promise<PluginActionResponse> {
  const id = String(pluginId || '').trim()
  const actionName = String(action || '').trim()
  if (!id) throw new Error('Plugin id is required')
  if (!actionName) throw new Error('Plugin action is required')
  return await apiJson<PluginActionResponse>(`/api/plugins/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: actionName, payload, context }),
  })
}
