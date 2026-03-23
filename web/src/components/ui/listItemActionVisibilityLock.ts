const lockCountByFrame = new WeakMap<HTMLElement, number>()

function resolveListItemFrame(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  return el.closest('[data-oc-actions-lock-frame], [data-oc-list-item-frame]') as HTMLElement | null
}

export function lockListItemActionsForAnchor(anchorEl: HTMLElement | null): () => void {
  const frameEl = resolveListItemFrame(anchorEl)
  if (!frameEl) return () => {}

  const prev = lockCountByFrame.get(frameEl) || 0
  const next = prev + 1
  lockCountByFrame.set(frameEl, next)
  frameEl.dataset.ocActionsLocked = 'true'

  return () => {
    const current = lockCountByFrame.get(frameEl) || 0
    const remaining = current - 1
    if (remaining <= 0) {
      lockCountByFrame.delete(frameEl)
      delete frameEl.dataset.ocActionsLocked
      return
    }
    lockCountByFrame.set(frameEl, remaining)
  }
}
