import { computed, ref } from 'vue'

export type GitDiffSource = 'working' | 'staged'

export function useGitDiffSelection(opts: { conflictPaths: { value: string[] }; refresh: () => void }) {
  const selectedFile = ref<string | null>(null)
  const diffSource = ref<GitDiffSource>('working')

  const diffDebounceTimer = ref<number | null>(null)
  function refreshDiff() {
    opts.refresh()
  }

  function selectFile(path: string, source?: GitDiffSource) {
    const nextSource = source ?? diffSource.value ?? 'working'
    const sameSelection = selectedFile.value === path && diffSource.value === nextSource

    selectedFile.value = path
    diffSource.value = nextSource

    // If the selection didn't change (clicking the same file again), refresh.
    // Otherwise the viewer reacts to prop changes and will load immediately.
    if (!sameSelection) return

    // Debounce refresh to avoid flicker during rapid taps.
    if (diffDebounceTimer.value) window.clearTimeout(diffDebounceTimer.value)
    diffDebounceTimer.value = window.setTimeout(() => {
      refreshDiff()
    }, 100)
  }

  const selectedIsConflict = computed(() => {
    const p = (selectedFile.value || '').trim()
    if (!p) return false
    return opts.conflictPaths.value.includes(p)
  })

  return {
    selectedFile,
    diffSource,
    selectedIsConflict,
    refreshDiff,
    selectFile,
  }
}
