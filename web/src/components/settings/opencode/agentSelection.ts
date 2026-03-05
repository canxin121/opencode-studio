export function pickEffectiveAgentId(
  selectedId: string | null,
  filteredAgentIds: readonly string[],
  allAgentIds: readonly string[],
): string | null {
  if (selectedId && allAgentIds.includes(selectedId)) {
    return selectedId
  }
  if (filteredAgentIds.length > 0) {
    return filteredAgentIds[0] ?? null
  }
  return allAgentIds[0] ?? null
}
