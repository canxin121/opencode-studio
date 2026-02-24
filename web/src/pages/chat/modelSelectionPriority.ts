import type { ProviderModelPair } from '@/pages/chat/modelSelectionDefaults'

export type ProviderModelSelectionSource = 'empty' | 'session' | 'default' | 'auto'

export type ResolveProviderModelSelectionInput = {
  sessionManual?: ProviderModelPair
  sessionRunConfig?: ProviderModelPair
  sessionDerived?: ProviderModelPair
  projectDefault?: ProviderModelPair
  userDefault?: ProviderModelPair
  opencodeDefault?: ProviderModelPair
  singletonAvailable?: ProviderModelPair
}

export type ResolvedProviderModelSelection = {
  provider: string
  model: string
  source: ProviderModelSelectionSource
}

type NormalizedProviderModel = { provider: string; model: string }

function normalizeProviderModelPair(value: ProviderModelPair | null | undefined): NormalizedProviderModel {
  return {
    provider: String(value?.provider || '').trim(),
    model: String(value?.model || '').trim(),
  }
}

function isCompletePair(value: NormalizedProviderModel): boolean {
  return Boolean(value.provider && value.model)
}

function pickFirstCompletePair(...pairs: Array<ProviderModelPair | null | undefined>): NormalizedProviderModel {
  for (const pair of pairs) {
    const normalized = normalizeProviderModelPair(pair)
    if (isCompletePair(normalized)) return normalized
  }
  return { provider: '', model: '' }
}

export function resolveProviderModelSelection(
  input: ResolveProviderModelSelectionInput,
): ResolvedProviderModelSelection {
  const fromSession = pickFirstCompletePair(input.sessionManual, input.sessionRunConfig, input.sessionDerived)
  if (isCompletePair(fromSession)) {
    return { ...fromSession, source: 'session' }
  }

  const fromDefaults = pickFirstCompletePair(input.projectDefault, input.userDefault, input.opencodeDefault)
  if (isCompletePair(fromDefaults)) {
    return { ...fromDefaults, source: 'default' }
  }

  const singleton = normalizeProviderModelPair(input.singletonAvailable)
  if (isCompletePair(singleton)) {
    return { ...singleton, source: 'auto' }
  }

  return { provider: '', model: '', source: 'empty' }
}
