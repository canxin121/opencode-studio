import { invokePluginAction } from '@/plugins/host/api'
import type { JsonValue as JsonLike } from '@/types/json'

export type PluginHostEvent = {
  type: string
  data: JsonLike
  lastEventId?: string
}

function parseEventData(raw: string): JsonLike {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text) as JsonLike
  } catch {
    return text
  }
}

export async function invokeHostPluginAction(
  pluginId: string,
  action: string,
  payload: JsonLike = null,
  context: JsonLike = null,
): Promise<JsonLike> {
  const resp = await invokePluginAction(pluginId, action, payload, context)
  if (!resp.ok) {
    throw new Error(resp.error?.message || `Plugin action failed: ${action}`)
  }
  return resp.data ?? null
}

export function subscribeHostPluginEvents(
  pluginId: string,
  handlers: {
    onEvent?: (evt: PluginHostEvent) => void
    onError?: (err: Event) => void
  },
): () => void {
  const id = String(pluginId || '').trim()
  if (!id) return () => {}

  const source = new EventSource(`/api/plugins/${encodeURIComponent(id)}/events`)

  source.onmessage = (evt) => {
    handlers.onEvent?.({
      type: 'message',
      data: parseEventData(evt.data),
      lastEventId: evt.lastEventId,
    })
  }

  source.addEventListener('plugin.event', (evt) => {
    const msg = evt as MessageEvent
    handlers.onEvent?.({
      type: 'plugin.event',
      data: parseEventData(msg.data),
      lastEventId: msg.lastEventId,
    })
  })

  source.addEventListener('plugin.error', (evt) => {
    const msg = evt as MessageEvent
    handlers.onEvent?.({
      type: 'plugin.error',
      data: parseEventData(msg.data),
      lastEventId: msg.lastEventId,
    })
  })

  source.onerror = (evt) => {
    handlers.onError?.(evt)
  }

  return () => {
    source.close()
  }
}
