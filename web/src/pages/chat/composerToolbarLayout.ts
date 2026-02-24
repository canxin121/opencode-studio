export const COMPOSER_TOOLBAR_WRAP_MAX_WIDTH = 430

export function shouldWrapComposerToolbar(isMobilePointer: boolean, viewportWidth: number): boolean {
  if (!isMobilePointer) return false
  if (!Number.isFinite(viewportWidth)) return false
  return Math.floor(viewportWidth) <= COMPOSER_TOOLBAR_WRAP_MAX_WIDTH
}
