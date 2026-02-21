import { ref } from 'vue'

import { connectSse } from '@/lib/sse'

export function useGitWatchSse<TPayload>(opts: {
  buildUrl: (directory: string) => string
  onPayload: (payload: TPayload, prev: TPayload | null) => void
  onError?: () => void
}) {
  const watchSource = ref<ReturnType<typeof connectSse> | null>(null)
  const watchRetryTimer = ref<number | null>(null)
  const watchRefreshTimer = ref<number | null>(null)
  const watchLastPayload = ref<TPayload | null>(null)

  function stopWatch() {
    if (watchRetryTimer.value) {
      window.clearTimeout(watchRetryTimer.value)
      watchRetryTimer.value = null
    }
    if (watchRefreshTimer.value) {
      window.clearTimeout(watchRefreshTimer.value)
      watchRefreshTimer.value = null
    }
    if (watchSource.value) {
      watchSource.value.close()
      watchSource.value = null
    }
    watchLastPayload.value = null
  }

  function startWatch(directory: string, canRetry: () => boolean, retry: () => void) {
    stopWatch()
    const endpoint = opts.buildUrl(directory)
    const client = connectSse({
      endpoint,
      debugLabel: 'sse:git-watch',
      onEvent: (evt) => {
        if (String(evt?.type || '') !== 'git.watch.status') return
        const payload = (evt as unknown as { properties?: unknown }).properties as TPayload | undefined
        if (!payload) return
        const prev = watchLastPayload.value
        watchLastPayload.value = payload
        opts.onPayload(payload, prev)
      },
      onError: () => {
        opts.onError?.()
        // Keep legacy retry signal for callers that want a full restart.
        if (watchRetryTimer.value) return
        watchRetryTimer.value = window.setTimeout(() => {
          watchRetryTimer.value = null
          if (!canRetry()) {
            stopWatch()
            return
          }
          retry()
        }, 2000)
      },
    })
    watchSource.value = client
  }

  return {
    watchSource,
    watchLastPayload,
    watchRetryTimer,
    watchRefreshTimer,
    startWatch,
    stopWatch,
  }
}
