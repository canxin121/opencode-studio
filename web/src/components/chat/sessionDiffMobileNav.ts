export type SessionDiffMobileView = 'list' | 'detail'

export function resolveSessionDiffNavigationView(input: {
  isNarrowViewport: boolean
  hasDiffEntries: boolean
  selectedDiffPath: string
  mobileView: SessionDiffMobileView
}): 'split' | SessionDiffMobileView {
  if (!input.isNarrowViewport) return 'split'
  if (!input.hasDiffEntries) return 'list'
  if (input.mobileView === 'detail' && input.selectedDiffPath) return 'detail'
  return 'list'
}
