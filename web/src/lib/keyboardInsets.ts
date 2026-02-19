type Options = {
  enabled: boolean
}

// Best-effort mobile keyboard + safe-area CSS variables.
// This behavior is enough to prevent "jumping" layouts.
export function installKeyboardInsets(options: Options) {
  if (!options.enabled) return () => {}
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const root = document.documentElement

  let keyboardInset = 0
  let keyboardAvoidTarget: HTMLElement | null = null
  let keyboardAvoidOffset = 0

  // When the page uses modern "dynamic viewport" units (dvh) or browsers that resize the
  // layout viewport on keyboard open (Android Chrome), `documentElement.clientHeight` can
  // shrink along with `visualViewport.height`. In that case, computing insets as
  // (layoutHeight - visualViewportHeight) returns ~0 and we fail to detect the keyboard.
  //
  // Track a per-orientation "max visible height" baseline and measure shrink from that.
  // This stays stable across keyboard open, but resets when orientation changes.
  let maxViewportHeight = 0
  let lastOrientationKey = ''

  const getOrientationKey = () => {
    try {
      // matchMedia is supported broadly; keep it simple.
      return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
    } catch {
      return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
    }
  }

  const clearKeyboardAvoid = () => {
    if (!keyboardAvoidTarget) return
    keyboardAvoidOffset = 0
    keyboardAvoidTarget.style.setProperty('--oc-keyboard-avoid-offset', '0px')
    keyboardAvoidTarget.removeAttribute('data-keyboard-avoid-active')
    keyboardAvoidTarget = null
  }

  const resolveAvoidTarget = (active: HTMLElement | null) => {
    if (!active) return null
    const marked = active.closest('[data-keyboard-avoid]') as HTMLElement | null
    return marked || active
  }

  const update = () => {
    const viewport = window.visualViewport
    const height = viewport ? Math.round(viewport.height) : window.innerHeight
    const offsetTop = viewport ? Math.max(0, Math.round(viewport.offsetTop)) : 0
    root.style.setProperty('--oc-visual-viewport-offset-top', `${offsetTop}px`)

    const orientationKey = getOrientationKey()
    if (orientationKey !== lastOrientationKey) {
      lastOrientationKey = orientationKey
      maxViewportHeight = height
    }

    const active = document.activeElement as HTMLElement | null
    const tag = active?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    const isTextTarget = Boolean(isInput || active?.isContentEditable)

    // Update baseline only when we're not actively typing (keyboard likely closed).
    // Use max so address-bar/toolbars animations don't temporarily lower the baseline.
    if (!isTextTarget) {
      maxViewportHeight = Math.max(maxViewportHeight, height)
    }

    const rawInset = Math.max(0, maxViewportHeight - height)
    const threshold = isTextTarget ? 120 : 180
    const measured = rawInset >= threshold ? rawInset : 0

    keyboardInset = isTextTarget ? measured : 0
    root.style.setProperty('--oc-keyboard-inset', `${keyboardInset}px`)

    // Used by layout/CSS to hide bottom navigation on mobile while the keyboard is open.
    if (keyboardInset > 0) root.setAttribute('data-oc-keyboard-open', 'true')
    else root.removeAttribute('data-oc-keyboard-open')

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const homeIndicator = isIOS && keyboardInset > 0 ? 34 : 0
    root.style.setProperty('--oc-keyboard-home-indicator', `${homeIndicator}px`)

    const avoidTarget = isTextTarget ? resolveAvoidTarget(active) : null
    if (!avoidTarget || !active) {
      clearKeyboardAvoid()
      return
    }

    if (avoidTarget !== keyboardAvoidTarget) {
      clearKeyboardAvoid()
      keyboardAvoidTarget = avoidTarget
    }

    const viewportBottom = offsetTop + height

    // For chat-like UIs we want the whole composer bar to stay visible (model/agent/send
    // controls included), not only the focused textarea.
    //
    // Note: the avoid target is shifted via `top: -offset`. Use the last applied offset to
    // compute overlap against the target's *natural* (unshifted) position to avoid oscillation.
    const rect = keyboardAvoidTarget.getBoundingClientRect()
    const naturalBottom = rect.bottom + keyboardAvoidOffset
    const overlap = naturalBottom - viewportBottom
    const clearance = 8
    const avoidOffset = overlap > clearance && keyboardInset > 0 ? Math.min(overlap, keyboardInset) : 0

    keyboardAvoidOffset = avoidOffset
    keyboardAvoidTarget.style.setProperty('--oc-keyboard-avoid-offset', `${avoidOffset}px`)
    keyboardAvoidTarget.setAttribute('data-keyboard-avoid-active', 'true')
  }

  update()
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', update)
  viewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  document.addEventListener('focusin', update, true)
  document.addEventListener('focusout', update, true)

  return () => {
    viewport?.removeEventListener('resize', update)
    viewport?.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    document.removeEventListener('focusin', update, true)
    document.removeEventListener('focusout', update, true)
    clearKeyboardAvoid()
  }
}
