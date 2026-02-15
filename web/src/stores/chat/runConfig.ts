import type { SessionRunConfig } from '@/types/chat'
import type { JsonObject, JsonValue } from '@/types/json'

export function loadSessionRunConfigMap(storageKey: string): Record<string, SessionRunConfig> {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SessionRunConfig>
    }
  } catch {
    // ignore
  }
  return {}
}

export function createSessionRunConfigPersister(
  storageKey: string,
  getValue: () => Record<string, SessionRunConfig>,
): { persistSoon: () => void } {
  let timer: number | null = null
  function persistSoon() {
    if (timer) return
    timer = window.setTimeout(() => {
      timer = null
      try {
        localStorage.setItem(storageKey, JSON.stringify(getValue()))
      } catch {
        // ignore
      }
    }, 250)
  }
  return { persistSoon }
}

function normalizeRunConfigValue(v: JsonValue): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function extractRunConfigFromMessageInfo(info: JsonValue): Partial<SessionRunConfig> {
  const source = info && typeof info === 'object' ? (info as JsonObject) : null
  const out: Partial<SessionRunConfig> = {}
  const model = source?.model
  const modelRec = model && typeof model === 'object' ? (model as JsonObject) : null
  const agent = normalizeRunConfigValue(source?.agent)
  const providerID =
    normalizeRunConfigValue(source?.providerID) ||
    normalizeRunConfigValue(modelRec?.providerID) ||
    normalizeRunConfigValue(source?.provider)
  const modelID =
    normalizeRunConfigValue(source?.modelID) ||
    normalizeRunConfigValue(modelRec?.modelID) ||
    normalizeRunConfigValue(source?.model)
  const variant = normalizeRunConfigValue(source?.variant)

  if (agent) out.agent = agent
  if (providerID) out.providerID = providerID
  if (modelID) out.modelID = modelID
  if (variant) out.variant = variant
  return out
}
