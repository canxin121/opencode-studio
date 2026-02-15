export type PatchSeqState = {
  lastSeq: number
  outOfSync: boolean
  sawReset: boolean
}

export type PatchSeqDecision =
  | { action: 'apply'; next: PatchSeqState }
  | { action: 'ignore-duplicate'; next: PatchSeqState }
  | { action: 'enter-out-of-sync'; next: PatchSeqState; reason: 'gap' | 'reset' }

function normalizeSeq(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return n > 0 ? n : 0
}

export function nextPatchSeqState(state: PatchSeqState, incomingSeqRaw: unknown): PatchSeqDecision {
  const incomingSeq = normalizeSeq(incomingSeqRaw)
  const lastSeq = normalizeSeq(state.lastSeq)
  if (incomingSeq <= 0) {
    // No numeric seq available: allow apply (store might still handle id-based cursors).
    return { action: 'apply', next: state }
  }

  if (state.outOfSync) {
    return { action: 'enter-out-of-sync', next: state, reason: 'gap' }
  }

  if (lastSeq > 0 && incomingSeq === lastSeq) {
    return { action: 'ignore-duplicate', next: state }
  }

  const expected = lastSeq > 0 ? lastSeq + 1 : null
  const reset = lastSeq > 0 && incomingSeq < lastSeq
  const gap = expected !== null && incomingSeq !== expected
  if (reset || gap) {
    return {
      action: 'enter-out-of-sync',
      reason: reset ? 'reset' : 'gap',
      next: {
        lastSeq,
        outOfSync: true,
        sawReset: state.sawReset || reset,
      },
    }
  }

  return {
    action: 'apply',
    next: {
      lastSeq: incomingSeq,
      outOfSync: false,
      sawReset: state.sawReset,
    },
  }
}
