import { computed, nextTick, ref, type Ref } from 'vue'

import { usePinnedScroll } from '@/composables/chat/usePinnedScroll'

type UiLike = { isMobile: boolean; isMobilePointer: boolean }
type ChatPartValue = unknown
type ChatMessageLike = {
  info?: { role?: string; id?: string }
  parts?: ChatPartValue[]
}

type ChatLike = {
  selectedSessionId: string | null
  messages: ChatMessageLike[]
  selectedHistory: { loading: boolean; exhausted: boolean }
  loadOlderMessages: (sid: string) => Promise<boolean>
}

export function useChatScrollNav(opts: {
  chat: ChatLike
  ui: UiLike
  getRevertId: () => string
  composerFullscreenActive: Ref<boolean>
  composerShellHeight: Ref<number>
  composerDividerHitPx: number
}) {
  const { chat, ui, getRevertId, composerFullscreenActive, composerShellHeight, composerDividerHitPx } = opts

  const loadingOlder = computed(() => chat.selectedHistory.loading)

  function hasUserTextPart(part: ChatPartValue): boolean {
    if (!part || typeof part !== 'object') return false
    const maybe = part as {
      type?: ChatPartValue
      synthetic?: ChatPartValue
      ignored?: ChatPartValue
      text?: ChatPartValue
    }
    return (
      maybe.type === 'text' &&
      maybe.synthetic !== true &&
      maybe.ignored !== true &&
      typeof maybe.text === 'string' &&
      maybe.text.trim().length > 0
    )
  }

  const navigableMessageIds = computed<string[]>(() => {
    const out: string[] = []
    const revertId = (getRevertId() || '').trim()
    for (const m of chat.messages) {
      const role = String(m?.info?.role || '')
      // Only navigate between user messages.
      if (role !== 'user') continue
      const id = typeof m?.info?.id === 'string' ? m.info.id.trim() : ''
      if (!id) continue
      if (revertId && id >= revertId) break
      const hasText = Array.isArray(m?.parts) ? m.parts.some((p: ChatPartValue) => hasUserTextPart(p)) : false
      if (!hasText) continue
      out.push(id)
    }
    return out
  })

  const navIndex = ref(0)
  let navRaf: number | null = null
  let navLockUntil = 0

  function messageElId(messageId: string) {
    return `msg-${messageId}`
  }

  function scrollToMessageId(messageId: string, behavior: ScrollBehavior = 'smooth') {
    const el = document.getElementById(messageElId(messageId))
    if (!el) return
    el.scrollIntoView({ behavior, block: 'center' })
  }

  function updateNavIndexFromScroll(scrollEl: HTMLElement | null) {
    if (navRaf) return
    navRaf = window.requestAnimationFrame(() => {
      navRaf = null
      if (Date.now() < navLockUntil) return
      const el = scrollEl
      if (!el) return
      const ids = navigableMessageIds.value
      if (!ids.length) return

      // Choose the message closest to the viewport center.
      // This stays stable with scrollIntoView({block:'center'}) and avoids index "flipping".
      const targetY = el.scrollTop + el.clientHeight / 2
      let bestIdx = 0
      let bestDist = Number.POSITIVE_INFINITY

      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]
        if (!id) continue
        const node = document.getElementById(messageElId(id)) as HTMLElement | null
        if (!node) continue
        const center = node.offsetTop + node.offsetHeight / 2
        const dist = Math.abs(center - targetY)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i
        }
      }

      navIndex.value = bestIdx
    })
  }

  const pinned = usePinnedScroll({
    bottomThresholdPx: 140,
    onScroll: () => {
      // scrollEl ref is provided by the composable, but we only need its current element.
      updateNavIndexFromScroll(scrollEl.value)
    },
    canLoadOlder: () => {
      const sid = chat.selectedSessionId
      if (!sid) return false
      if (loadingOlder.value) return false
      if (chat.messages.length === 0) return false
      return !chat.selectedHistory.exhausted
    },
    loadOlder: async () => {
      const sid = chat.selectedSessionId
      if (!sid) return false
      return await chat.loadOlderMessages(sid)
    },
  })

  const {
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
  } = pinned

  const navBottomOffset = computed(() => {
    const base = ui.isMobilePointer ? 96 : 112
    const divider = !composerFullscreenActive.value && !ui.isMobile ? composerDividerHitPx : 0
    const height = composerShellHeight.value + divider
    if (!height) return `${base}px`
    return `${Math.max(base, height + 12)}px`
  })

  const navTotalLabel = computed(() => {
    // OpenCode API does not expose a cheap total count.
    // Show a "+" suffix until we've loaded the beginning.
    const n = navigableMessageIds.value.length
    return chat.selectedHistory.exhausted ? String(n) : `${n}+`
  })

  function navPrev() {
    void (async () => {
      const ids = navigableMessageIds.value
      if (!ids.length) return

      const sid = chat.selectedSessionId
      if (!sid) return

      // At the beginning of the loaded window: try to load older history first.
      if (navIndex.value <= 0) {
        if (chat.selectedHistory.exhausted || chat.selectedHistory.loading) return

        const currentId = ids[0] || ''
        if (!currentId) return
        navLockUntil = Date.now() + 1200
        suppressAutoLoadOlderUntil.value = Date.now() + 1600

        const ok = await loadOlderAndPreserveViewport()
        if (!ok) return
        await nextTick()

        const ids2 = navigableMessageIds.value
        const idx = ids2.indexOf(currentId)
        if (idx > 0) {
          const target = ids2[idx - 1]
          if (!target) return
          navIndex.value = idx - 1
          suppressAutoLoadOlderUntil.value = Date.now() + 1400
          navLockUntil = Date.now() + 1200
          scrollToMessageId(target, 'smooth')
        }
        return
      }

      const nextIdx = Math.max(0, navIndex.value - 1)
      const id = ids[nextIdx]
      if (!id) return
      navIndex.value = nextIdx
      navLockUntil = Date.now() + 800
      suppressAutoLoadOlderUntil.value = Date.now() + 900
      scrollToMessageId(id, 'smooth')
    })()
  }

  function navNext() {
    const ids = navigableMessageIds.value
    if (!ids.length) return
    const nextIdx = Math.min(ids.length - 1, navIndex.value + 1)
    navIndex.value = nextIdx
    const id = ids[nextIdx]
    if (!id) return
    navLockUntil = Date.now() + 800
    suppressAutoLoadOlderUntil.value = Date.now() + 900
    scrollToMessageId(id, 'smooth')
  }

  return {
    loadingOlder,
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
    navigableMessageIds,
    navIndex,
    navBottomOffset,
    navTotalLabel,
    navPrev,
    navNext,
  }
}
