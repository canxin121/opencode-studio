import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

// ChatPage scroll management:
// - "Pinned" bottom-following behavior while user is at bottom
// - Programmatic initial bottom landing on session switch
// - Optional progressive "load older" when user scrolls to top

export function shouldAutoLoadOlder(opts: {
  canLoadOlder: boolean
  suppressed: boolean
  scrollTop: number
  autoLoadUnlocked: boolean
  atBottom: boolean
}) {
  if (!opts.canLoadOlder) return false
  if (opts.suppressed) return false
  if (!opts.autoLoadUnlocked) return false
  if (opts.atBottom) return false
  return opts.scrollTop <= 120
}

export function usePinnedScroll(opts: {
  bottomThresholdPx?: number
  // Called on every scroll update (used for nav index updates).
  onScroll?: () => void
  canLoadOlder?: () => boolean
  // Should prepend older messages; returns true if any were loaded.
  loadOlder?: () => Promise<boolean>
}) {
  const scrollEl = ref<HTMLDivElement | null>(null)
  const contentEl = ref<HTMLDivElement | null>(null)
  const bottomEl = ref<HTMLDivElement | null>(null)

  const bottomThreshold = typeof opts.bottomThresholdPx === 'number' ? opts.bottomThresholdPx : 140

  const isAtBottom = ref(true)

  function remainingToBottomPx(): number {
    const el = scrollEl.value
    if (!el) return Number.POSITIVE_INFINITY
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }

  function isNearBottomNow(extraThresholdPx = 0): boolean {
    const threshold = Math.max(0, bottomThreshold + Math.max(0, Math.floor(extraThresholdPx)))
    return remainingToBottomPx() < threshold
  }

  // Used by the page to temporarily hide the list while performing a stable bottom landing.
  const pendingInitialScrollSessionId = ref<string | null>(null)
  let initialScrollNonce = 0

  // Throttle load-older and suppress auto-load during programmatic navigation.
  let lastLoadOlderAt = 0
  const suppressAutoLoadOlderUntil = ref(0)
  const autoLoadOlderUnlocked = ref(false)

  // Batch auto-scroll work to at most once per frame while streaming.
  let scrollRaf: number | null = null

  // Keep the scroll pinned to bottom while the user is "following".
  // This prevents entry jitter from immediate reflows (markdown, fonts, keyboard insets).
  let followResizeObserver: ResizeObserver | null = null
  let followResizeUnlockRaf: number | null = null
  let followResizeLocked = false

  function requestInitialScroll(sessionId: string | null | undefined) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
    pendingInitialScrollSessionId.value = sid || null
    if (!sid) return
    // Session switches / initial entry should feel chat-like: land at bottom.
    // Also avoid triggering auto-load-older from a programmatic scroll.
    isAtBottom.value = true
    suppressAutoLoadOlderUntil.value = Date.now() + 1400
    autoLoadOlderUnlocked.value = false
  }

  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    const scroller = scrollEl.value
    if (!scroller) return
    // Prefer an explicit anchor to avoid scrollHeight races.
    const anchor = bottomEl.value
    if (anchor) {
      anchor.scrollIntoView({ behavior, block: 'end' })
      return
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior })
  }

  function scheduleScrollToBottom() {
    if (scrollRaf) return
    scrollRaf = window.requestAnimationFrame(async () => {
      scrollRaf = null
      // Preserve follow behavior when browser restores from background with a
      // stale scroll flag but the viewport is still effectively at bottom.
      if (!isAtBottom.value && !isNearBottomNow(48)) return
      isAtBottom.value = true
      await nextTick()
      scrollToBottom('auto')
    })
  }

  function pinToBottomNow() {
    if (!isAtBottom.value) return
    if (followResizeLocked) return
    followResizeLocked = true
    scrollToBottom('auto')
    followResizeUnlockRaf = window.requestAnimationFrame(() => {
      followResizeLocked = false
      followResizeUnlockRaf = null
    })
  }

  watch(
    () => [scrollEl.value, contentEl.value] as const,
    () => {
      followResizeObserver?.disconnect()
      followResizeObserver = null

      const scroller = scrollEl.value
      const content = contentEl.value
      if (!scroller || !content) return

      followResizeObserver = new ResizeObserver(() => {
        pinToBottomNow()
      })
      followResizeObserver.observe(scroller)
      followResizeObserver.observe(content)
    },
    { flush: 'post', immediate: true },
  )

  async function loadOlderAndPreserveViewport(): Promise<boolean> {
    const el = scrollEl.value
    if (!el) return false
    if (!opts.loadOlder) return false
    if (!opts.canLoadOlder?.()) return false

    const now = Date.now()
    if (now - lastLoadOlderAt < 900) return false
    lastLoadOlderAt = now
    suppressAutoLoadOlderUntil.value = now + 1400

    const prevHeight = el.scrollHeight
    const prevTop = el.scrollTop

    const ok = await opts.loadOlder()
    if (!ok) return false

    await nextTick()
    const nextHeight = el.scrollHeight
    // Preserve viewport position after prepending older messages.
    el.scrollTop = prevTop + (nextHeight - prevHeight)
    return true
  }

  async function maybeLoadOlder() {
    const el = scrollEl.value
    if (!el) return
    const canLoadOlder = !!opts.canLoadOlder?.()
    const shouldAutoLoad = shouldAutoLoadOlder({
      canLoadOlder,
      suppressed: Date.now() < suppressAutoLoadOlderUntil.value,
      scrollTop: el.scrollTop,
      autoLoadUnlocked: autoLoadOlderUnlocked.value,
      atBottom: isAtBottom.value,
    })
    if (!shouldAutoLoad) return

    void loadOlderAndPreserveViewport()
  }

  function handleScroll() {
    if (!scrollEl.value) return
    isAtBottom.value = isNearBottomNow()
    if (!autoLoadOlderUnlocked.value && !isAtBottom.value) {
      autoLoadOlderUnlocked.value = true
    }
    opts.onScroll?.()
    void maybeLoadOlder()
  }

  async function scrollToBottomOnceAfterLoad(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (pendingInitialScrollSessionId.value !== sid) return
    if (!scrollEl.value) return

    const nonce = ++initialScrollNonce
    // We hide the list while `pendingInitialScrollSessionId` is set; do a stable
    // bottom landing before revealing to avoid entry jitter.
    await nextTick()
    if (nonce !== initialScrollNonce) return
    scrollToBottom('auto')

    // One extra frame absorbs immediate reflows (font swap, markdown highlight).
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    if (nonce !== initialScrollNonce) return
    scrollToBottom('auto')

    if (pendingInitialScrollSessionId.value !== sid) return

    isAtBottom.value = true
    pendingInitialScrollSessionId.value = null
  }

  onBeforeUnmount(() => {
    if (scrollRaf) {
      window.cancelAnimationFrame(scrollRaf)
      scrollRaf = null
    }
    if (followResizeObserver) {
      followResizeObserver.disconnect()
      followResizeObserver = null
    }
    if (followResizeUnlockRaf) {
      window.cancelAnimationFrame(followResizeUnlockRaf)
      followResizeUnlockRaf = null
    }
  })

  return {
    scrollEl,
    contentEl,
    bottomEl,
    isAtBottom,
    pendingInitialScrollSessionId,
    suppressAutoLoadOlderUntil,
    requestInitialScroll,
    scrollToBottom,
    scheduleScrollToBottom,
    scrollToBottomOnceAfterLoad,
    loadOlderAndPreserveViewport,
    handleScroll,
  }
}
