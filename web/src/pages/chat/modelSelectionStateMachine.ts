import { ref, type Ref } from 'vue'

import type { SelectionSource } from './modelSelectionResolver'

export function useModelSelectionStateMachine(opts: {
  selectedAgent: Ref<string>
  selectedProviderId: Ref<string>
  selectedModelId: Ref<string>
  selectedVariant: Ref<string>
  ensureAgentOption?: (name: string) => void
  ensureProviderOption?: (providerId: string) => void
}) {
  const agentSource = ref<SelectionSource>('empty')
  const providerSource = ref<SelectionSource>('empty')
  const modelSource = ref<SelectionSource>('empty')
  const variantSource = ref<SelectionSource>('empty')

  function setAgent(value: string, source: SelectionSource) {
    opts.selectedAgent.value = value
    agentSource.value = value ? source : 'empty'
    if (value) opts.ensureAgentOption?.(value)
  }

  function setProvider(value: string, source: SelectionSource) {
    opts.selectedProviderId.value = value
    providerSource.value = value ? source : 'empty'
    if (value) opts.ensureProviderOption?.(value)
  }

  function setModel(value: string, source: SelectionSource) {
    opts.selectedModelId.value = value
    modelSource.value = value ? source : 'empty'
  }

  function setVariant(value: string, source: SelectionSource) {
    opts.selectedVariant.value = value
    variantSource.value = value ? source : 'empty'
  }

  function resetSelectionForSessionSwitch() {
    opts.selectedAgent.value = ''
    opts.selectedProviderId.value = ''
    opts.selectedModelId.value = ''
    agentSource.value = 'empty'
    providerSource.value = 'empty'
    modelSource.value = 'empty'
    variantSource.value = 'empty'
  }

  return {
    agentSource,
    providerSource,
    modelSource,
    variantSource,
    setAgent,
    setProvider,
    setModel,
    setVariant,
    resetSelectionForSessionSwitch,
  }
}
