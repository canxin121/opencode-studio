import { onBeforeUnmount, watch } from 'vue'

type RemoteFn = (opts?: { silent?: boolean }) => void | Promise<void>

export function useGitAutoFetch(opts: {
  repoRoot: { value: string | null }
  gitReady: { value: boolean }
  repoBusy: { value: boolean }
  hasRemotes: { value: boolean }
  autoFetchEnabled: { value: boolean }
  autoFetchIntervalMinutes: { value: number }
  autoSyncEnabled: { value: boolean }
  autoSyncIntervalMinutes: { value: number }
  fetchRemote: RemoteFn
  sync: RemoteFn
}) {
  const {
    repoRoot,
    gitReady,
    repoBusy,
    hasRemotes,
    autoFetchEnabled,
    autoFetchIntervalMinutes,
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    fetchRemote,
    sync,
  } = opts

  let fetchTimer: number | null = null
  let syncTimer: number | null = null

  function clearFetchTimer() {
    if (fetchTimer !== null) {
      window.clearInterval(fetchTimer)
      fetchTimer = null
    }
  }

  function clearSyncTimer() {
    if (syncTimer !== null) {
      window.clearInterval(syncTimer)
      syncTimer = null
    }
  }

  function canRun(): boolean {
    return Boolean(repoRoot.value) && gitReady.value && hasRemotes.value && !repoBusy.value
  }

  function scheduleFetch() {
    clearFetchTimer()
    if (!autoFetchEnabled.value) return
    const minutes = Math.max(1, Number(autoFetchIntervalMinutes.value) || 0)
    const intervalMs = minutes * 60 * 1000
    fetchTimer = window.setInterval(() => {
      if (!canRun()) return
      void fetchRemote({ silent: true })
    }, intervalMs)
  }

  function scheduleSync() {
    clearSyncTimer()
    if (!autoSyncEnabled.value) return
    const minutes = Math.max(1, Number(autoSyncIntervalMinutes.value) || 0)
    const intervalMs = minutes * 60 * 1000
    syncTimer = window.setInterval(() => {
      if (!canRun()) return
      void sync({ silent: true })
    }, intervalMs)
  }

  watch(
    () =>
      [
        repoRoot.value,
        gitReady.value,
        hasRemotes.value,
        autoFetchEnabled.value,
        autoFetchIntervalMinutes.value,
      ] as const,
    () => {
      scheduleFetch()
    },
    { immediate: true },
  )

  watch(
    () =>
      [repoRoot.value, gitReady.value, hasRemotes.value, autoSyncEnabled.value, autoSyncIntervalMinutes.value] as const,
    () => {
      scheduleSync()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clearFetchTimer()
    clearSyncTimer()
  })

  return {
    stop: () => {
      clearFetchTimer()
      clearSyncTimer()
    },
  }
}
