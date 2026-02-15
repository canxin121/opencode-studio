import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

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
    composerShellHeight,
    pageRef,
    composerBarRef,
    composerRef,
    commandOpen,
    composerPickerOpen,
    modelPickerQuery,
    scrollToBottom,
  } = opts

  const STORAGE_COMPOSER_USER_HEIGHT = 'oc2.chat.composerUserHeight'
  const DEFAULT_COMPOSER_HEIGHT = 240
  const DEFAULT_MOBILE_COMPOSER_HEIGHT = 160

  // Height state
  const composerUserHeight = ref<number>(DEFAULT_COMPOSER_HEIGHT)
  const composerTargetHeight = ref<number>(DEFAULT_COMPOSER_HEIGHT)

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

  function openEditorFullscreen() {
    commandOpen.value = false
    composerPickerOpen.value = null
    modelPickerQuery.value = ''
    editorClosing.value = false
    editorFullscreen.value = true

    // Calculate max height (approximate or exact)
    // VerticalSplitPane handles max constraint, so we can just set a very large number
    // to ensure it fills the space, OR preferably, set it to the container height.
    if (pageRef.value) {
      composerTargetHeight.value = pageRef.value.clientHeight
    } else {
      composerTargetHeight.value = window.innerHeight
    }

    void nextTick(() => {
      scrollToBottom('auto')
      getComposerTextareaEl(composerRef.value)?.focus()
    })
  }

  function closeEditorFullscreen() {
    if (!editorFullscreen.value && !editorClosing.value) return
    editorClosing.value = true

    // Animate/Restore back to user height
    composerTargetHeight.value = composerUserHeight.value

    setTimeout(() => {
      editorFullscreen.value = false
      editorClosing.value = false
      getComposerTextareaEl(composerRef.value)?.focus()
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

  onMounted(() => {
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
    }

    window.addEventListener('resize', handleWindowResize)
  })

  function handleWindowResize() {
    if (editorFullscreen.value && pageRef.value) {
      composerTargetHeight.value = pageRef.value.clientHeight
    }
  }

  onBeforeUnmount(() => {
    if (composerShellObserver) {
      composerShellObserver.disconnect()
      composerShellObserver = null
    }
    window.removeEventListener('resize', handleWindowResize)
  })

  // Stub for compatibility if ChatPage calls it directly (though we'll remove usage)
  function startComposerResize(_e: PointerEvent) {
    // No-op
  }

  // Stub for compatibility
  function syncExpandedComposerHeight() {
    if (editorFullscreen.value) handleWindowResize()
  }

  return {
    composerCollapsedHeight: ref(0), // Unused but kept for type compat if needed
    composerUserHeight,
    composerTargetHeight,
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
