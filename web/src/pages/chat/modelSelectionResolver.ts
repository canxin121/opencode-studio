import { resolveProviderModelSelection } from './modelSelectionPriority'
import type { ProviderModelPair } from './modelSelectionDefaults'

export type SelectionSource = 'empty' | 'session' | 'default' | 'auto' | 'manual'

export function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const next = String(value || '').trim()
    if (next) return next
  }
  return ''
}

export function resolveAgentSelection(input: {
  includeSessionLayers: boolean
  runConfigAgent: string
  derivedAgent: string
  projectDefaultAgent: string
  userDefaultAgent: string
  fallbackAgent: string
}): { value: string; source: 'session' | 'default' | 'empty' } {
  const sessionAgent = input.includeSessionLayers ? firstNonEmpty(input.runConfigAgent, input.derivedAgent) : ''
  if (sessionAgent) {
    return { value: sessionAgent, source: 'session' }
  }

  const defaultAgent = firstNonEmpty(input.projectDefaultAgent, input.userDefaultAgent, input.fallbackAgent)
  if (defaultAgent) {
    return { value: defaultAgent, source: 'default' }
  }

  return { value: '', source: 'empty' }
}

export function resolveModelSelection(input: {
  includeSessionLayers: boolean
  sessionManual: ProviderModelPair
  sessionRunConfig: ProviderModelPair
  sessionDerived: ProviderModelPair
  projectDefault: ProviderModelPair
  userDefault: ProviderModelPair
  opencodeDefault: ProviderModelPair
  singletonAvailable: ProviderModelPair
}): {
  provider: string
  model: string
  source: 'session' | 'default' | 'auto' | 'empty'
} {
  return resolveProviderModelSelection({
    sessionManual: input.includeSessionLayers ? input.sessionManual : undefined,
    sessionRunConfig: input.includeSessionLayers ? input.sessionRunConfig : undefined,
    sessionDerived: input.includeSessionLayers ? input.sessionDerived : undefined,
    projectDefault: input.projectDefault,
    userDefault: input.userDefault,
    opencodeDefault: input.opencodeDefault,
    singletonAvailable: input.singletonAvailable,
  })
}

export function resolveVariantSelection(input: {
  includeSessionLayers: boolean
  runConfigVariant: string
  derivedVariant: string
}): { value: string; source: 'session' | 'empty' } {
  const sessionVariant = input.includeSessionLayers ? firstNonEmpty(input.runConfigVariant, input.derivedVariant) : ''
  if (sessionVariant) {
    return { value: sessionVariant, source: 'session' }
  }
  return { value: '', source: 'empty' }
}
