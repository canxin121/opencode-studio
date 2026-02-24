import { parseModelSlug } from './modelSelectionDefaults'
import type { SessionRunConfig } from '@/types/chat'
import type { JsonValue as JsonLike } from '@/types/json'

type UnknownRecord = Record<string, JsonLike>
type ChatMessageLike = { info?: UnknownRecord }

export type SessionSelection = {
  agent: string
  provider: string
  model: string
  variant: string
}

function asRecord(value: JsonLike): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {}
}

export function readSessionRunConfigSelection(runConfig: SessionRunConfig | null | undefined): SessionSelection {
  return {
    agent: typeof runConfig?.agent === 'string' ? runConfig.agent.trim() : '',
    provider: typeof runConfig?.providerID === 'string' ? runConfig.providerID.trim() : '',
    model: typeof runConfig?.modelID === 'string' ? runConfig.modelID.trim() : '',
    variant: typeof runConfig?.variant === 'string' ? runConfig.variant.trim() : '',
  }
}

export function deriveSessionSelectionFromMessages(messages: ChatMessageLike[]): SessionSelection {
  const list = Array.isArray(messages) ? messages : []
  const pickLast = (extract: (info: UnknownRecord) => string) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const info = asRecord(list[i]?.info)
      const value = extract(info)
      if (value) return value
    }
    return ''
  }

  const agent = pickLast((info) => (typeof info.agent === 'string' ? info.agent.trim() : ''))

  const provider =
    pickLast((info) => (typeof info.providerID === 'string' ? info.providerID.trim() : '')) ||
    pickLast((info) => {
      const model = asRecord(info.model)
      return typeof model.providerID === 'string' ? model.providerID.trim() : ''
    })

  const model =
    pickLast((info) => (typeof info.modelID === 'string' ? info.modelID.trim() : '')) ||
    pickLast((info) => {
      const modelInfo = asRecord(info.model)
      return typeof modelInfo.modelID === 'string' ? modelInfo.modelID.trim() : ''
    })

  const variant = pickLast((info) => (typeof info.variant === 'string' ? info.variant.trim() : ''))
  return { agent, provider, model, variant }
}

export function normalizeSessionManualModelStorageEntry(
  sessionId: string,
  value: unknown,
): {
  key: string
  value: string
} | null {
  const sid = String(sessionId || '').trim()
  if (!sid || typeof value !== 'string') return null
  const parsed = parseModelSlug(value)
  if (!parsed.provider || !parsed.model) return null
  return { key: sid, value: `${parsed.provider}/${parsed.model}` }
}

export function readSessionManualModelPair(
  map: Record<string, string>,
  sessionId: string,
): { provider: string; model: string } {
  const sid = String(sessionId || '').trim()
  if (!sid) return { provider: '', model: '' }
  return parseModelSlug(map[sid] || '')
}

export function writeSessionManualModelPair(
  map: Record<string, string>,
  sessionId: string,
  provider: string,
  model: string,
): Record<string, string> {
  const sid = String(sessionId || '').trim()
  const pid = String(provider || '').trim()
  const mid = String(model || '').trim()
  if (!sid || !pid || !mid) return map

  const slug = `${pid}/${mid}`
  if (map[sid] === slug) return map
  return { ...map, [sid]: slug }
}

export function removeSessionManualModelPair(map: Record<string, string>, sessionId: string): Record<string, string> {
  const sid = String(sessionId || '').trim()
  if (!sid) return map
  if (!Object.prototype.hasOwnProperty.call(map, sid)) return map
  const next = { ...map }
  delete next[sid]
  return next
}
