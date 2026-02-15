import { useUiStore } from '@/stores/ui'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 520

export function useDesktopSidebarResize() {
  const ui = useUiStore()

  function startDesktopSidebarResize(e: PointerEvent) {
    if (ui.isMobile || !ui.isSidebarOpen) return

    const startX = e.clientX
    const startW = ui.sidebarWidth

    const move = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)))
      ui.sidebarWidth = next
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return { startDesktopSidebarResize }
}
