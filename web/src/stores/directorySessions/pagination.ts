export function normalizePage(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function isDirectoryAggregatePageSatisfied(
  cachedPage: number | null | undefined,
  targetPage: number,
): boolean {
  return normalizePage(cachedPage) === normalizePage(targetPage)
}

export function shouldReloadExpandedDirectoryAggregate(input: {
  attempted: boolean
  hasCache: boolean
  cachedPage: number | null | undefined
  targetPage: number
}): boolean {
  if (!input.attempted) return true
  if (!input.hasCache) return true
  return !isDirectoryAggregatePageSatisfied(input.cachedPage, input.targetPage)
}
