import { computed, type Ref } from 'vue'

import { normalizeStringList } from './OpenCodeConfigPanelListUtils'

type ConfigValue = unknown

export function useOpenCodeConfigPanelToolOptions(opts: {
  draft: Ref<ConfigValue>
  getPath: (obj: ConfigValue, path: string) => ConfigValue
  setStringList: (path: string, list: string[]) => void

  toolIdsRemote: Ref<string[]>
  toolFilterDebounced: Ref<string>
}) {
  const experimentalPrimaryToolsArr = computed<string[]>({
    get: () => normalizeStringList(opts.getPath(opts.draft.value, 'experimental.primary_tools')),
    set: (list: string[]) => opts.setStringList('experimental.primary_tools', list),
  })

  const toolIdOptions = computed<string[]>(() => {
    const merged = new Set<string>()

    // Fallback built-ins so UI works even if endpoint is unavailable.
    for (const id of [
      'read',
      'edit',
      'glob',
      'grep',
      'list',
      'bash',
      'task',
      'skill',
      'external_directory',
      'lsp',
      'question',
      'webfetch',
      'websearch',
      'codesearch',
      'todowrite',
      'todoread',
      'doom_loop',
    ]) {
      merged.add(id)
    }
    for (const id of opts.toolIdsRemote.value) merged.add(String(id || '').trim())
    for (const id of experimentalPrimaryToolsArr.value) merged.add(id)
    return Array.from(merged.values())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  })

  const filteredToolIdOptions = computed(() => {
    const q = opts.toolFilterDebounced.value.trim().toLowerCase()
    if (!q) return toolIdOptions.value
    return toolIdOptions.value.filter((id) => id.toLowerCase().includes(q))
  })

  return { experimentalPrimaryToolsArr, filteredToolIdOptions, toolIdOptions }
}
