import type { JsonValue as JsonLike } from '@/types/json'

export function normalizeSidebarSeq(value: JsonLike | undefined): number {
  const seq = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  if (seq <= 0) return 0
  return seq
}

export function mergeSidebarSeqBaseline(currentSeq: number, bootstrapSeq: JsonLike | undefined): number {
  const current = normalizeSidebarSeq(currentSeq)
  const bootstrap = normalizeSidebarSeq(bootstrapSeq)
  if (bootstrap <= 0) return current
  return Math.max(current, bootstrap)
}

type SidebarSeqBootstrapOptions = {
  currentSeq: number
  bootstrapSeq: JsonLike | undefined
  outOfSync: boolean
  sawReset: boolean
}

export function resolveSidebarSeqAfterBootstrap(opts: SidebarSeqBootstrapOptions): number {
  const current = normalizeSidebarSeq(opts.currentSeq)
  const bootstrap = normalizeSidebarSeq(opts.bootstrapSeq)

  // When the SSE stream baseline reset (typically backend restart), accept
  // bootstrap as the new floor so patch replay can recover.
  if (opts.outOfSync && opts.sawReset) {
    return bootstrap
  }

  return mergeSidebarSeqBaseline(current, bootstrap)
}
