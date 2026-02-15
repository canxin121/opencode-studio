import type { GitStatusResponse } from '@/types/git'

export function joinFs(base: string, rel: string): string {
  const b = (base || '').trim().replace(/\/+$/g, '')
  const r = (rel || '').trim().replace(/^\/+/, '')
  if (!b) return ''
  if (!r || r === '.') return b
  return `${b}/${r}`
}

export function createEmptyStatusSummary(): GitStatusResponse {
  return {
    current: '',
    tracking: null,
    ahead: 0,
    behind: 0,
    files: [],
    diffStats: undefined,
    totalFiles: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    mergeCount: 0,
    offset: 0,
    limit: 0,
    hasMore: false,
    scope: 'all',
  }
}
