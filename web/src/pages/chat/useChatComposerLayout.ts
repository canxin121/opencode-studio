import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

type UiLike = { isMobile: boolean; isMobilePointer: boolean }

type ComposerExpose = {
  shellEl?: HTMLDivElement | { value: HTMLDivElement | null } | null
  textareaEl?: HTMLTextAreaElement | { value: HTMLTextAreaElement | null } | null
}

function getComposerTextareaEl(composer: ComposerExpose | null): HTMLTextAreaElement | null {
  const textarea = composer?.textareaEl
  if (!textarea) return null
  return textarea instanceof HTMLTextAreaElement ? textarea : textarea.value
}

export function useChatComposerLayout(opts: {
  ui: UiLike

  // State owned by the page (used by other composables too).
  editorFullscreen: Ref<boolean>
  editorClosing: Ref<boolean>
  composerFullscreenActive: Ref<boolean>
  composerShellHeight: Ref<number>

  // Refs needed for sizing + observing.
  pageRef: Ref<HTMLElement | null>
  composerBarRef: Ref<HTMLElement | null>
  scrollEl: Ref<HTMLDivElement | null>
  composerRef: Ref<ComposerExpose | null>

  // Close pickers when entering fullscreen.
  commandOpen: Ref<boolean>
  composerPickerOpen: Ref<null | 'agent' | 'model' | 'variant'>
  modelPickerQuery: Ref<string>

  // Scroll helper (used on entering fullscreen).
  scrollToBottom: (behavior?: ScrollBehavior) => void
}) {
  const {
    ui,
    editorFullscreen,
    editorClosing,
    composerFullscreenActive,
    composerShellHeight,
    pageRef,
    composerBarRef,
    composerRef,
    commandOpen,
    composerPickerOpen,
    modelPickerQuery,
    scrollToBottom,
  } = opts

  const root = typeof document !== 'undefined' ? document.documentElement : null
  function syncComposerFullscreenRootFlag() {
    if (!root) return
    if (composerFullscreenActive.value) root.setAttribute('data-oc-composer-fullscreen', 'true')
    else root.removeAttribute('data-oc-composer-fullscreen')
  }

  const STORAGE_COMPOSER_USER_HEIGHT = 'oc2.chat.composerUserHeight'
  const DEFAULT_COMPOSER_HEIGHT = 240
  const DEFAULT_MOBILE_COMPOSER_HEIGHT = 160

  // Height state
  const composerUserHeight = ref<number>(DEFAULT_COMPOSER_HEIGHT)
  const composerTargetHeight = ref<number>(DEFAULT_COMPOSER_HEIGHT)

  // Mobile fullscreen: keep the editor pinned to the top.
  //
  // On mobile browsers, dismissing the IME can briefly toggle toolbar/viewport metrics.
  // While the fullscreen composer is active we drive the split pane height from measurements,
  // which can momentarily become smaller than the container height. In the normal split layout
  // that reveals the top pane for a frame and makes the editor "jump" downward.
  //
  // Collapsing the top pane in fullscreen mode ensures the editor's top edge stays stable.
  const composerSplitTopCollapsed = ref(false)
  const SPLIT_TOP_COLLAPSE_DELAY_MS = 220
  let splitTopCollapseTimer: ReturnType<typeof setTimeout> | null = null

  const clearSplitTopCollapseTimer = () => {
    if (splitTopCollapseTimer === null) return
    try {
      clearTimeout(splitTopCollapseTimer)
    } catch {
      // ignore
    }
    splitTopCollapseTimer = null
  }

  const scheduleSplitTopCollapse = () => {
    clearSplitTopCollapseTimer()
    splitTopCollapseTimer = setTimeout(() => {
      splitTopCollapseTimer = null
      // Re-check conditions at execution time.
      if (!ui.isMobilePointer) return
      if (!editorFullscreen.value) return
      if (editorClosing.value) return
      composerSplitTopCollapsed.value = true
    }, SPLIT_TOP_COLLAPSE_DELAY_MS)
  }

  watch(
    () => [ui.isMobilePointer, editorFullscreen.value, editorClosing.value] as const,
    ([isMobilePointer, isFullscreen, isClosing]) => {
      clearSplitTopCollapseTimer()

      // Desktop/tablet: keep the normal split behavior.
      if (!isMobilePointer) {
        composerSplitTopCollapsed.value = false
        return
      }

      // Closing animation should reveal the message list again.
      if (!isFullscreen || isClosing) {
        composerSplitTopCollapsed.value = false
        return
      }

      // Delay collapse so the open transition still expands "up" from the bottom.
      composerSplitTopCollapsed.value = false
      scheduleSplitTopCollapse()
    },
    { immediate: true },
  )

  // Initialize from storage
  try {
    const raw = (localStorage.getItem(STORAGE_COMPOSER_USER_HEIGHT) || '').trim()
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n > 0) {
      composerUserHeight.value = Math.round(n)
      composerTargetHeight.value = Math.round(n)
    }
  } catch {
    // ignore
  }

  // Override for mobile: enforce a compact fixed height initially.
  if (ui.isMobile) {
    composerTargetHeight.value = DEFAULT_MOBILE_COMPOSER_HEIGHT
    composerUserHeight.value = DEFAULT_MOBILE_COMPOSER_HEIGHT
  }

  function persistUserHeight(h: number) {
    try {
      localStorage.setItem(STORAGE_COMPOSER_USER_HEIGHT, String(Math.round(h)))
    } catch {}
  }

  // Called when VerticalSplitPane updates the size (dragging)
  function handleComposerResize(newHeight: number) {
    if (ui.isMobile) return

    // If we are dragging, we update the target height immediately
    composerTargetHeight.value = newHeight

    // If not in fullscreen (or if we decide dragging exits fullscreen/updates user pref), update user height
    if (!editorFullscreen.value) {
      composerUserHeight.value = newHeight
      persistUserHeight(newHeight)
    }
  }

  function resetComposerHeight() {
    if (ui.isMobile || editorFullscreen.value) return
    composerUserHeight.value = DEFAULT_COMPOSER_HEIGHT
    composerTargetHeight.value = DEFAULT_COMPOSER_HEIGHT
    persistUserHeight(DEFAULT_COMPOSER_HEIGHT)
  }

  function applyComposerUserHeight() {
    if (ui.isMobile) return
    if (!editorFullscreen.value) {
      composerTargetHeight.value = composerUserHeight.value
    }
  }

  function syncFullscreenHeight() {
    if (!editorFullscreen.value || editorClosing.value) return

    const el = pageRef.value
    const h = el ? Math.round(el.getBoundingClientRect().height) : 0
    if (Number.isFinite(h) && h > 0) {
      composerTargetHeight.value = h
      return
    }

    composerTargetHeight.value = window.innerHeight
  }

  function openEditorFullscreen() {
    commandOpen.value = false
    composerPickerOpen.value = null
    modelPickerQuery.value = ''
    editorClosing.value = false
    editorFullscreen.value = true

    syncFullscreenHeight()

    void nextTick(() => {
      scrollToBottom('auto')

      // Mobile UX: don't auto-open the IME just because the user toggled fullscreen.
      if (!ui.isMobilePointer) {
        getComposerTextareaEl(composerRef.value)?.focus()
      }
    })
  }

  function closeEditorFullscreen() {
    if (!editorFullscreen.value && !editorClosing.value) return
    editorClosing.value = true

    // Mobile UX: collapsing the fullscreen editor should dismiss the IME.
    if (ui.isMobilePointer) {
      try {
        getComposerTextareaEl(composerRef.value)?.blur()
      } catch {
        // ignore
      }
    }

    // Animate/Restore back to user height
    composerTargetHeight.value = composerUserHeight.value

    setTimeout(() => {
      editorFullscreen.value = false
      editorClosing.value = false

      // Keep desktop behavior (restore focus), but avoid reopening the keyboard on mobile.
      if (!ui.isMobilePointer) {
        getComposerTextareaEl(composerRef.value)?.focus()
      }
    }, 240) // Match transition duration
  }

  function toggleEditorFullscreen() {
    if (editorClosing.value) return
    if (editorFullscreen.value) {
      closeEditorFullscreen()
    } else {
      openEditorFullscreen()
    }
  }

  // Keep track of actual shell height for UI adjustments (like scroll nav position)
  let composerShellObserver: ResizeObserver | null = null
  let pageObserver: ResizeObserver | null = null

  const viewport = typeof window !== 'undefined' ? window.visualViewport : null

  onMounted(() => {
    syncComposerFullscreenRootFlag()

    // Keep app shell stable while the fullscreen composer is active.
    watch(() => composerFullscreenActive.value, syncComposerFullscreenRootFlag, { immediate: true })

    if (typeof ResizeObserver !== 'undefined') {
      composerShellObserver = new ResizeObserver(() => {
        const el = composerBarRef.value
        composerShellHeight.value = el ? Math.round(el.getBoundingClientRect().height) : 0
      })

      const el = composerBarRef.value
      if (el) {
        composerShellObserver.observe(el)
        composerShellHeight.value = Math.round(el.getBoundingClientRect().height)
      }

      // Track chat page size changes that don't emit window.resize (iOS keyboard, dvh changes,
      // bottom-nav padding tweaks).
      pageObserver = new ResizeObserver(() => {
        syncFullscreenHeight()
      })
      if (pageRef.value) {
        pageObserver.observe(pageRef.value)
      }
    }

    window.addEventListener('resize', handleWindowResize)
    viewport?.addEventListener('resize', handleWindowResize)
    viewport?.addEventListener('scroll', handleWindowResize)
  })

  function handleWindowResize() {
    syncFullscreenHeight()
  }

  onBeforeUnmount(() => {
    // Ensure we don't leave the app shell in fullscreen state.
    try {
      root?.removeAttribute('data-oc-composer-fullscreen')
    } catch {}

    if (composerShellObserver) {
      composerShellObserver.disconnect()
      composerShellObserver = null
    }
    if (pageObserver) {
      pageObserver.disconnect()
      pageObserver = null
    }
    window.removeEventListener('resize', handleWindowResize)
    viewport?.removeEventListener('resize', handleWindowResize)
    viewport?.removeEventListener('scroll', handleWindowResize)

    clearSplitTopCollapseTimer()
  })

  // Stub for compatibility if ChatPage calls it directly (though we'll remove usage)
  function startComposerResize(_e: PointerEvent) {
    // No-op
  }

  // Stub for compatibility
  function syncExpandedComposerHeight() {
    syncFullscreenHeight()
  }

  return {
    composerCollapsedHeight: ref(0), // Unused but kept for type compat if needed
    composerUserHeight,
    composerTargetHeight,
    composerSplitTopCollapsed,
    startComposerResize,
    applyComposerUserHeight,
    syncExpandedComposerHeight,
    openEditorFullscreen,
    closeEditorFullscreen,
    toggleEditorFullscreen,
    handleComposerResize, // New export
    resetComposerHeight,
  }
}
