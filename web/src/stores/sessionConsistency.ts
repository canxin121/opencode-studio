export type SessionPayloadConsistency = {
  degraded: boolean
  staleReads?: number
  transientSkips?: number
  parseSkips?: number
  ioSkips?: number
  fallbackSummaries?: number
  retryAfterMs?: number
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

export function parseSessionPayloadConsistency(value: unknown): SessionPayloadConsistency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const payload = value as Record<string, unknown>
  if (payload.degraded !== true) return undefined

  return {
    degraded: true,
    staleReads: toNonNegativeInt(payload.staleReads),
    transientSkips: toNonNegativeInt(payload.transientSkips),
    parseSkips: toNonNegativeInt(payload.parseSkips),
    ioSkips: toNonNegativeInt(payload.ioSkips),
    fallbackSummaries: toNonNegativeInt(payload.fallbackSummaries),
    retryAfterMs: toNonNegativeInt(payload.retryAfterMs),
  }
}
