export type SessionDiffMobileView = 'list' | 'detail'

export function resolveSessionDiffNavigationView(input: {
  hasDiffEntries: boolean
  selectedDiffPath: string
  mobileView: SessionDiffMobileView
}): SessionDiffMobileView {
  if (!input.hasDiffEntries) return 'list'
  if (input.mobileView === 'detail' && input.selectedDiffPath) return 'detail'
  return 'list'
}
