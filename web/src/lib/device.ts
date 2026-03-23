export type DeviceInfo = {
  // Legacy compact-layout switch (kept for existing call sites).
  isMobile: boolean
  // Legacy compact-touch switch (kept for existing call sites).
  isMobilePointer: boolean

  // Explicit signals (used for finer-grained decisions).
  isNarrow: boolean
  isCoarsePointer: boolean
  isCompactLayout: boolean
  isMobileDevice: boolean
  isTouchPointer: boolean
}

function safeMatchMedia(query: string): boolean {
  try {
    return Boolean(window.matchMedia && window.matchMedia(query).matches)
  } catch {
    return false
  }
}

function isLikelyMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false

  try {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    if (typeof uaData?.mobile === 'boolean') {
      return uaData.mobile
    }
  } catch {
    // ignore and fallback to UA sniffing
  }

  const ua = String(navigator.userAgent || '').toLowerCase()
  const mobileUa = /android|webos|iphone|ipod|blackberry|iemobile|opera mini|windows phone|mobile/i.test(ua)
  if (mobileUa) return true

  // iPadOS can report a desktop-like UA; treat touch-capable MacIntel as handheld.
  const isIPadDesktopUa = navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1
  return isIPadDesktopUa
}

function isDesktopContainerRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const invoke = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke
    return typeof invoke === 'function'
  } catch {
    return false
  }
}

export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isMobilePointer: false,
      isNarrow: false,
      isCoarsePointer: false,
      isCompactLayout: false,
      isMobileDevice: false,
      isTouchPointer: false,
    }
  }

  // Split signals by semantics:
  // - layout: width breakpoints
  // - input: pointer capabilities
  // - device: handheld intent (UA + touch-first heuristics)
  const isCompactLayout = safeMatchMedia('(max-width: 900px)')
  const isNarrowTouch = safeMatchMedia('(max-width: 1024px)')
  const isTouchPointer = safeMatchMedia('(pointer: coarse)')
  const hasHover = safeMatchMedia('(hover: hover)')
  const hasMobileUserAgent = isLikelyMobileUserAgent()
  const isDesktopContainer = isDesktopContainerRuntime()
  const isMobileDevice = !isDesktopContainer && (hasMobileUserAgent || (isTouchPointer && !hasHover))

  // Legacy fields kept intentionally for existing usage sites.
  const isMobile = isCompactLayout
  const isMobilePointer = isNarrowTouch && isTouchPointer

  return {
    isMobile,
    isMobilePointer,
    isNarrow: isCompactLayout,
    isCoarsePointer: isTouchPointer,
    isCompactLayout,
    isMobileDevice,
    isTouchPointer,
  }
}

export function applyDeviceClasses(info: DeviceInfo) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('mobile-pointer', info.isMobilePointer)
  root.classList.toggle('touch-pointer', info.isTouchPointer)
  root.classList.toggle('device-mobile', info.isMobileDevice)
  root.classList.toggle('device-desktop', !info.isMobileDevice)
  root.classList.toggle('layout-compact', info.isCompactLayout)
  root.classList.toggle('layout-wide', !info.isCompactLayout)
}
