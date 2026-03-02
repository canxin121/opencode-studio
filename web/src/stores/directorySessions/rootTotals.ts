type RootTotalDeltaInput = {
  previousDirectoryId: string
  nextDirectoryId: string
  previousParentId: string | null
  nextParentId: string | null
  hadPrevious: boolean
  trustAsNewRoot?: boolean
}

function normalizeId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRoot(parentId: string | null): boolean {
  return !normalizeId(parentId)
}

function addDelta(out: Record<string, number>, directoryId: string, delta: number) {
  const did = normalizeId(directoryId)
  if (!did || !Number.isFinite(delta) || delta === 0) return
  out[did] = (out[did] || 0) + Math.floor(delta)
  if (!out[did]) delete out[did]
}

export function computeRootTotalDeltas(input: RootTotalDeltaInput): Record<string, number> {
  const out: Record<string, number> = {}
  const previousDirectoryId = normalizeId(input.previousDirectoryId)
  const nextDirectoryId = normalizeId(input.nextDirectoryId)

  if (!input.hadPrevious) {
    if (input.trustAsNewRoot && nextDirectoryId && isRoot(input.nextParentId)) {
      addDelta(out, nextDirectoryId, 1)
    }
    return out
  }

  const previousIsRoot = isRoot(input.previousParentId)
  const nextIsRoot = isRoot(input.nextParentId)

  if (previousDirectoryId && nextDirectoryId && previousDirectoryId === nextDirectoryId) {
    if (previousIsRoot && !nextIsRoot) {
      addDelta(out, previousDirectoryId, -1)
    } else if (!previousIsRoot && nextIsRoot) {
      addDelta(out, previousDirectoryId, 1)
    }
    return out
  }

  if (previousDirectoryId && previousIsRoot) {
    addDelta(out, previousDirectoryId, -1)
  }

  // If previous directory is unknown, avoid optimistic increments to prevent drift.
  if (nextDirectoryId && nextIsRoot && previousDirectoryId) {
    addDelta(out, nextDirectoryId, 1)
  }

  return out
}

export function applyRootTotalDelta(totalRoots: number, delta: number): number {
  const base = typeof totalRoots === 'number' && Number.isFinite(totalRoots) ? Math.max(0, Math.floor(totalRoots)) : 0
  if (!Number.isFinite(delta) || delta === 0) return base
  return Math.max(0, base + Math.floor(delta))
}
