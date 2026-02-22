export type EffectiveDefaultsLike = {
  provider?: string
  model?: string
  agent?: string
}

export type DeriveSendRunConfigInput = {
  selectedProviderId?: string
  selectedModelId?: string
  selectedAgent?: string
  selectedVariant?: string
  effectiveDefaults?: EffectiveDefaultsLike | null
}

export type DerivedSendRunConfig = {
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
}

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Ensure message payload is explicit about the effective run config.
// This avoids relying on upstream /session defaults, which can vary by environment.
export function deriveSendRunConfig(input: DeriveSendRunConfigInput): DerivedSendRunConfig {
  const defaults = input.effectiveDefaults || null

  const provider = norm(input.selectedProviderId) || norm(defaults?.provider)
  const model = norm(input.selectedModelId) || norm(defaults?.model)
  const agent = norm(input.selectedAgent) || norm(defaults?.agent)
  const variant = norm(input.selectedVariant)

  const out: DerivedSendRunConfig = {}
  if (provider && model) {
    out.providerID = provider
    out.modelID = model
  }
  if (agent) out.agent = agent
  if (variant) out.variant = variant
  return out
}
