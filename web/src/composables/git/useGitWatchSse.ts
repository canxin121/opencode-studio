import { ref } from 'vue'

export function useGitWatchSse<TPayload>(opts: {
  buildUrl: (directory: string) => string
  onPayload: (payload: TPayload, prev: TPayload | null) => void
  onError?: () => void
}) {
  const watchSource = ref<EventSource | null>(null)
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
    const url = opts.buildUrl(directory)
    const es = new EventSource(url)
    watchSource.value = es

    es.addEventListener('status', (ev: MessageEvent) => {
      let payload: TPayload | null = null
      try {
        payload = JSON.parse(String(ev.data || '')) as TPayload
      } catch {
        return
      }
      if (!payload) return

      const prev = watchLastPayload.value
      watchLastPayload.value = payload
      opts.onPayload(payload, prev)
    })

    es.addEventListener('error', () => {
      opts.onError?.()
      // EventSource retries internally, but we close + retry to keep behavior predictable
      // when switching directories quickly or when the endpoint rejects.
      if (watchRetryTimer.value) return
      watchRetryTimer.value = window.setTimeout(() => {
        watchRetryTimer.value = null
        if (!canRetry()) {
          stopWatch()
          return
        }
        retry()
      }, 2000)
    })
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
