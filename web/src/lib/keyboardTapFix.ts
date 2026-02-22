type Options = {
  enabled: boolean
}

type TapMode = 'keep' | 'blur'

function isTextInputLike(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement
    const t = String(input.type || '').toLowerCase()
    // Treat most text-entry types as keyboard targets.
    return (
      t === 'text' ||
      t === 'search' ||
      t === 'email' ||
      t === 'url' ||
      t === 'tel' ||
      t === 'password' ||
      t === 'number' ||
      t === 'date' ||
      t === 'datetime-local' ||
      t === 'month' ||
      t === 'time' ||
      t === 'week'
    )
  }
  return Boolean(el.isContentEditable)
}

function resolveInteractiveTarget(start: Element): HTMLElement | null {
  const el = start instanceof HTMLElement ? start : null
  if (!el) return null

  // Prefer native interactive elements.
  const match = el.closest(
    'button, a[href], input, textarea, select, summary, label, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
  )
  return match instanceof HTMLElement ? match : null
}

function isDisabled(el: HTMLElement): boolean {
  // Handle both native disabled + aria-disabled.
  const maybeDisabled = (el as { disabled?: boolean }).disabled
  if (typeof maybeDisabled === 'boolean' && maybeDisabled) return true
  return String(el.getAttribute('aria-disabled') || '').toLowerCase() === 'true'
}

function resolveTapMode(start: Element): TapMode {
  const el = start instanceof HTMLElement ? start : null
  if (!el) return 'blur'
  const carrier = el.closest('[data-oc-keyboard-tap]') as HTMLElement | null
  if (!carrier) return 'blur'
  const raw = String(carrier.getAttribute('data-oc-keyboard-tap') || '')
    .trim()
    .toLowerCase()
  if (raw === 'keep') return 'keep'
  return 'blur'
}

// Some mobile browsers treat the first tap while the on-screen keyboard is open as a pure
// "dismiss keyboard" gesture, swallowing the intended click.
//
// Default behavior: when a text input is focused (IME open) and the user taps an interactive
// control outside it, proactively blur the input so the tap becomes a real click instead of a
// “dismiss keyboard only” gesture (common on mobile Safari).
//
// Use `data-oc-keyboard-tap="keep"` on a control (or ancestor) to keep the keyboard open and
// still register the tap.
export function installKeyboardTapFix(options: Options): () => void {
  if (!options.enabled) return () => {}
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const root = document.documentElement

  type Pending = {
    pointerId: number
    target: HTMLElement
    focusEl: HTMLElement
    mode: TapMode
    startX: number
    startY: number
    startedAt: number
    waitingForNativeClick: boolean
    syntheticClickFired: boolean
    fallbackTimer: number | null
    clearTimer: number | null
  }

  let pending: Pending | null = null
  let suppressTrustedClickUntil = 0
  let suppressTrustedClickTarget: HTMLElement | null = null

  const TAP_MOVE_PX = 12
  const TAP_TIMEOUT_MS = 800
  const POST_IME_GHOST_SUPPRESS_MS = 800

  const isTouchUi = () => {
    // Only run on touch-first layouts to avoid surprising desktop/tablet behaviors.
    // This class is set by applyDeviceClasses() based on coarse-pointer + width.
    return root.classList.contains('mobile-pointer')
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== 'touch') return
    if (!isTouchUi()) return

    const eventTarget = e.target instanceof Element ? e.target : null
    if (!eventTarget) return

    const active = document.activeElement as HTMLElement | null
    if (!isTextInputLike(active)) return

    // Interactions inside the active text target should behave normally.
    if (active && active.contains(eventTarget)) return

    const interactive = resolveInteractiveTarget(eventTarget)
    if (!interactive) return

    // Let the browser move focus between text inputs.
    if (isTextInputLike(interactive)) return
    if (isDisabled(interactive)) return

    const mode = resolveTapMode(eventTarget)

    pending = {
      pointerId: e.pointerId,
      target: interactive,
      focusEl: active,
      mode,
      startX: Number.isFinite(e.clientX) ? e.clientX : 0,
      startY: Number.isFinite(e.clientY) ? e.clientY : 0,
      startedAt: Date.now(),
      waitingForNativeClick: false,
      syntheticClickFired: false,
      fallbackTimer: null,
      clearTimer: null,
    }

    if (mode === 'keep') {
      // Keep the keyboard open by preventing focus from moving to the tapped control.
      // We'll forward the interaction via a synthetic click on pointerup.
      if (e.cancelable) {
        try {
          e.preventDefault()
        } catch {
          // ignore
        }
      }
      return
    }

    // mode === 'blur'
    // Dismiss the keyboard so the native click isn't swallowed.
    try {
      active.blur()
    } catch {
      // ignore
    }
  }

  const clearPending = () => {
    if (pending && pending.fallbackTimer !== null) {
      try {
        window.clearTimeout(pending.fallbackTimer)
      } catch {
        // ignore
      }
    }
    if (pending && pending.clearTimer !== null) {
      try {
        window.clearTimeout(pending.clearTimer)
      } catch {
        // ignore
      }
    }
    pending = null
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return

    const now = Date.now()
    const dt = now - pending.startedAt
    const dx = (Number.isFinite(e.clientX) ? e.clientX : 0) - pending.startX
    const dy = (Number.isFinite(e.clientY) ? e.clientY : 0) - pending.startY

    const moved = Math.sqrt(dx * dx + dy * dy)
    const isTap = moved <= TAP_MOVE_PX && dt <= TAP_TIMEOUT_MS
    const target = pending.target
    const focusEl = pending.focusEl
    const mode = pending.mode
    if (!isTap) {
      clearPending()
      return
    }
    if (!target.isConnected) {
      clearPending()
      return
    }

    if (mode === 'keep') {
      clearPending()

      // Fire the intended action.
      try {
        suppressTrustedClickUntil = now + 600
        suppressTrustedClickTarget = target
        target.click()
      } catch {
        // ignore
      }

      // Restore focus defensively in case the browser still blurred the input.
      // Keep it best-effort: some UI actions intentionally move focus.
      try {
        if (focusEl.isConnected) {
          focusEl.focus({ preventScroll: true })
        }
      } catch {
        // ignore
      }
      return
    }

    // mode === 'blur'
    // Prefer a native (trusted) click. If the browser swallows it, fall back to a synthetic click.
    pending.waitingForNativeClick = true
    pending.fallbackTimer = window.setTimeout(() => {
      if (!pending) return
      if (!pending.waitingForNativeClick) return
      const t = pending.target
      const now2 = Date.now()
      if (!t.isConnected) {
        clearPending()
        return
      }

      try {
        suppressTrustedClickUntil = now2 + 600
        suppressTrustedClickTarget = t
        t.click()
      } catch {
        // ignore
      }

      // Keep `pending` around briefly: some browsers deliver a delayed post-IME *trusted* click
      // after our fallback fires, and that click can be retargeted to a different control
      // (e.g. sessions menu, bottom nav).
      pending.syntheticClickFired = true
      pending.clearTimer = window.setTimeout(() => {
        clearPending()
      }, POST_IME_GHOST_SUPPRESS_MS)
    }, 0)
  }

  const onPointerCancel = (e: PointerEvent) => {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return
    clearPending()
  }

  const onClickCapture = (e: MouseEvent) => {
    // If we blurred the IME and a real click arrives, don't synthesize a second one.
    if (pending && pending.waitingForNativeClick && e.isTrusted) {
      const t = e.target instanceof Node ? e.target : null
      if (t && pending.target.contains(t)) {
        // If a fallback synthetic click already fired, this trusted click is a duplicate.
        if (pending.syntheticClickFired) {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
        clearPending()
        return
      }

      // On some mobile browsers the post-IME click can be retargeted to a different control
      // after viewport relayout (e.g. bottom nav). Consume that ghost click; the fallback
      // synthetic click will still fire the originally intended control.
      if (t) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (pending.syntheticClickFired) {
          clearPending()
        }
      }
      return
    }

    if (!suppressTrustedClickTarget) return
    if (Date.now() > suppressTrustedClickUntil) {
      suppressTrustedClickTarget = null
      suppressTrustedClickUntil = 0
      return
    }

    // Only suppress the browser-generated click. Our forwarded click is synthetic.
    if (!e.isTrusted) return
    const t = e.target instanceof Node ? e.target : null
    if (!t) return
    if (!suppressTrustedClickTarget.contains(t)) return

    e.preventDefault()
    e.stopImmediatePropagation()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('click', onClickCapture, true)

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('click', onClickCapture, true)
    pending = null
    suppressTrustedClickTarget = null
    suppressTrustedClickUntil = 0
  }
}
