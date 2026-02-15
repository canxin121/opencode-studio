import { addTagsToList, addToList, normalizeStringList, splitTags } from './OpenCodeConfigPanelListUtils'

export function useOpenCodeConfigPanelProvidersLists(opts: {
  providerConflictPolicy: { value: 'last-change-wins' | 'enabled-wins' | 'disabled-wins' | 'keep-conflict' }
  enabledProvidersArr: { value: string[] }
  disabledProvidersArr: { value: string[] }
  enabledProviderInput: { value: string }
  disabledProviderInput: { value: string }
  bulkProviderSelection: { value: string[] }
  bulkProviderInput: { value: string }
  providerIdOptions: { value: string[] }
}) {
  function reconcileProviderLists(changed: 'enabled' | 'disabled') {
    const enabled = opts.enabledProvidersArr.value.slice()
    const disabled = opts.disabledProvidersArr.value.slice()
    const enabledSet = new Set(enabled)
    const disabledSet = new Set(disabled)
    const intersection = enabled.filter((id) => disabledSet.has(id))
    if (intersection.length === 0) return

    if (opts.providerConflictPolicy.value === 'keep-conflict') {
      return
    }

    if (opts.providerConflictPolicy.value === 'enabled-wins') {
      opts.disabledProvidersArr.value = disabled.filter((id) => !enabledSet.has(id))
      return
    }
    if (opts.providerConflictPolicy.value === 'disabled-wins') {
      opts.enabledProvidersArr.value = enabled.filter((id) => !disabledSet.has(id))
      return
    }

    // last-change-wins (default)
    if (changed === 'enabled') {
      opts.disabledProvidersArr.value = disabled.filter((id) => !enabledSet.has(id))
    } else {
      opts.enabledProvidersArr.value = enabled.filter((id) => !disabledSet.has(id))
    }
  }

  function addEnabledProviderTags(raw: string) {
    const ids = splitTags(raw)
    if (ids.length === 0) return
    let enabled = opts.enabledProvidersArr.value.slice()
    let disabled = opts.disabledProvidersArr.value.slice()
    for (const id of ids) {
      enabled = addToList(enabled, id)
    }
    opts.enabledProvidersArr.value = enabled
    opts.disabledProvidersArr.value = disabled
    reconcileProviderLists('enabled')
    opts.enabledProviderInput.value = ''
  }

  function addDisabledProviderTags(raw: string) {
    const ids = splitTags(raw)
    if (ids.length === 0) return
    let enabled = opts.enabledProvidersArr.value.slice()
    let disabled = opts.disabledProvidersArr.value.slice()
    for (const id of ids) {
      disabled = addToList(disabled, id)
    }
    opts.enabledProvidersArr.value = enabled
    opts.disabledProvidersArr.value = disabled
    reconcileProviderLists('disabled')
    opts.disabledProviderInput.value = ''
  }

  function addBulkProviderTags(raw: string) {
    opts.bulkProviderSelection.value = addTagsToList(opts.bulkProviderSelection.value, raw)
    opts.bulkProviderInput.value = ''
  }

  function applyBulkEnableOnly() {
    const sel = normalizeStringList(opts.bulkProviderSelection.value)
    opts.enabledProvidersArr.value = sel
    opts.disabledProvidersArr.value = []
  }

  function applyBulkDisableAllExcept() {
    const sel = new Set(normalizeStringList(opts.bulkProviderSelection.value))
    opts.enabledProvidersArr.value = []
    opts.disabledProvidersArr.value = opts.providerIdOptions.value.filter((id) => !sel.has(id))
  }

  function isProviderSelectable(providerId: string): { ok: boolean; reason: string } {
    const id = String(providerId || '').trim()
    if (!id) return { ok: false, reason: 'invalid id' }

    const disabled = new Set(opts.disabledProvidersArr.value)
    if (disabled.has(id)) return { ok: false, reason: 'disabled_providers' }

    const enabled = opts.enabledProvidersArr.value
    if (enabled.length > 0 && !enabled.includes(id)) return { ok: false, reason: 'not in enabled_providers' }

    return { ok: true, reason: 'allowed' }
  }

  return {
    addBulkProviderTags,
    addDisabledProviderTags,
    addEnabledProviderTags,
    applyBulkDisableAllExcept,
    applyBulkEnableOnly,
    isProviderSelectable,
    reconcileProviderLists,
  }
}
