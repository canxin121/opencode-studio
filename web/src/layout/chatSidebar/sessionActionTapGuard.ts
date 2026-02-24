const POINTER_DOWN_MAX_AGE_MS = 750

export function shouldAcceptSessionActionTap(event: MouseEvent, pointerDownAtMs: number): boolean {
  if (event.detail === 0) return true
  if (!Number.isFinite(pointerDownAtMs) || pointerDownAtMs <= 0) return false
  return Date.now() - pointerDownAtMs <= POINTER_DOWN_MAX_AGE_MS
}
