export type DeviceInfo = {
  // Width-based layout switch (used for layout decisions).
  isMobile: boolean
  // Coarse-pointer + narrow width (used for touch-specific UX).
  isMobilePointer: boolean

  // Explicit signals (used for finer-grained decisions).
  isNarrow: boolean
  isCoarsePointer: boolean
}

function safeMatchMedia(query: string): boolean {
  try {
    return Boolean(window.matchMedia && window.matchMedia(query).matches)
  } catch {
    return false
  }
}

export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return { isMobile: false, isMobilePointer: false, isNarrow: false, isCoarsePointer: false }
  }

  // Avoid forcing the full "mobile layout" too early (e.g. 1024px tablet / narrow desktop windows).
  // Keep touch-specific tweaks a bit wider than the layout breakpoint.
  const isNarrowLayout = safeMatchMedia('(max-width: 900px)')
  const isNarrowTouch = safeMatchMedia('(max-width: 1024px)')
  const isCoarsePointer = safeMatchMedia('(pointer: coarse)')
  const isMobilePointer = isNarrowTouch && isCoarsePointer
  return {
    // Keep the stable field names for UI state.
    isMobile: isNarrowLayout,
    isMobilePointer,
    isNarrow: isNarrowLayout,
    isCoarsePointer,
  }
}

export function applyDeviceClasses(info: DeviceInfo) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('mobile-pointer', info.isMobilePointer)
  root.classList.toggle('device-mobile', info.isMobile)
  root.classList.toggle('device-desktop', !info.isMobile)
}
