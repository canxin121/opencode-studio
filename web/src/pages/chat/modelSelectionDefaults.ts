import type { JsonValue as JsonLike } from '@/types/json'

type UnknownRecord = Record<string, JsonLike>

export type ConfigDefaults = {
  defaultAgent: string
  defaultProvider: string
  defaultModel: string
}

export type ProviderModelPair = {
  provider?: string
  model?: string
}

export type ResolveDefaultsInput = {
  projectConfig?: JsonLike
  userConfig?: JsonLike
  opencodeSelection?: ProviderModelPair
  fallbackAgent?: string
}

export function parseModelSlug(slug: string): { provider: string; model: string } {
  const raw = (slug || '').trim()
  const idx = raw.indexOf('/')
  if (idx <= 0) return { provider: '', model: '' }
  const provider = raw.slice(0, idx).trim()
  const model = raw.slice(idx + 1).trim()
  return { provider, model }
}

function isRecord(value: JsonLike | null | undefined): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(obj: JsonLike | null | undefined, keys: string[]): string {
  if (!isRecord(obj)) return ''
  for (const key of keys) {
    const v = obj[key]
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (s) return s
  }
  return ''
}

function normalizeAgentName(raw: string): string {
  let v = String(raw || '').trim()
  if (v.startsWith('@')) v = v.slice(1).trim()
  return v
}

export function extractConfigDefaults(cfg: JsonLike | null | undefined): ConfigDefaults {
  const defaultAgent = normalizeAgentName(
    pickString(cfg, ['default_agent', 'defaultAgent', 'agent', 'default_agent_name', 'defaultAgentName']),
  )
  const providerRaw = pickString(cfg, ['provider', 'default_provider', 'defaultProvider', 'providerID', 'providerId'])
  const modelRaw = pickString(cfg, ['model', 'default_model', 'defaultModel', 'default_model_id', 'defaultModelId'])

  let defaultProvider = providerRaw
  let defaultModel = ''
  if (modelRaw) {
    const parsed = parseModelSlug(modelRaw)
    if (parsed.provider && parsed.model) {
      if (!defaultProvider) defaultProvider = parsed.provider
      defaultModel = parsed.model
    } else {
      defaultModel = modelRaw
    }
  }

  return { defaultAgent, defaultProvider, defaultModel }
}

function pickProviderModelPair(...candidates: ProviderModelPair[]): { provider: string; model: string } {
  for (const candidate of candidates) {
    const provider = (candidate.provider || '').trim()
    const model = (candidate.model || '').trim()
    if (provider && model) return { provider, model }
  }
  return { provider: '', model: '' }
}

export function resolveEffectiveDefaults(input: ResolveDefaultsInput): {
  agent: string
  provider: string
  model: string
} {
  const project = extractConfigDefaults(input.projectConfig)
  const user = extractConfigDefaults(input.userConfig)
  const opencodeSelection = input.opencodeSelection || {}

  const pair = pickProviderModelPair(
    { provider: project.defaultProvider, model: project.defaultModel },
    { provider: user.defaultProvider, model: user.defaultModel },
    opencodeSelection,
  )

  return {
    agent: (project.defaultAgent || user.defaultAgent || input.fallbackAgent || '').trim(),
    provider: pair.provider,
    model: pair.model,
  }
}
