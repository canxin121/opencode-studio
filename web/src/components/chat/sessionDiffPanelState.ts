export type SessionDiffPanelView = 'loading' | 'error' | 'empty' | 'list'

export function resolveSessionDiffPanelView(input: {
  loading: boolean
  error: string | null
  diffCount: number
  diffLoaded: boolean
  hasSummaryChanges: boolean
}): SessionDiffPanelView {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  if (input.diffCount > 0) return 'list'
  if (input.hasSummaryChanges && !input.diffLoaded) return 'loading'
  return 'empty'
}
