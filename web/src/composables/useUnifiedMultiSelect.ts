import { computed, ref } from 'vue'

type MultiSelectInteractionModifiers = {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

function normalizeId(value: string): string {
  return String(value || '').trim()
}

function normalizeUniqueIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = normalizeId(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function useUnifiedMultiSelect() {
  const enabled = ref(false)
  const selectedIds = ref<Set<string>>(new Set())
  const anchorId = ref('')

  const selectedCount = computed(() => selectedIds.value.size)
  const selectedList = computed(() => Array.from(selectedIds.value))

  function setAnchor(nextId: string) {
    anchorId.value = normalizeId(nextId)
  }

  function replaceSelected(ids: Iterable<string>) {
    const normalized = normalizeUniqueIds(ids)
    selectedIds.value = new Set(normalized)
    setAnchor(normalized[normalized.length - 1] || '')
  }

  function clearSelection() {
    selectedIds.value = new Set()
    setAnchor('')
  }

  function setEnabled(next: boolean) {
    if (!next) clearSelection()
    enabled.value = next
  }

  function toggleEnabled() {
    setEnabled(!enabled.value)
  }

  function isSelected(id: string) {
    const normalized = normalizeId(id)
    if (!normalized) return false
    return selectedIds.value.has(normalized)
  }

  function toggleSelected(id: string) {
    const normalized = normalizeId(id)
    if (!normalized) return
    const next = new Set(selectedIds.value)
    if (next.has(normalized)) {
      next.delete(normalized)
    } else {
      next.add(normalized)
    }
    selectedIds.value = next
    setAnchor(normalized)
  }

  function selectAll(ids: Iterable<string>) {
    replaceSelected(ids)
  }

  function invertSelection(ids: Iterable<string>) {
    const scope = normalizeUniqueIds(ids)
    if (!scope.length) return

    const scopeSet = new Set(scope)
    const next = new Set<string>()

    for (const id of selectedIds.value) {
      if (!scopeSet.has(id)) next.add(id)
    }

    for (const id of scope) {
      if (!selectedIds.value.has(id)) next.add(id)
    }

    selectedIds.value = next
    setAnchor(scope[scope.length - 1] || '')
  }

  function selectRange(targetId: string, orderedIds: Iterable<string>, opts?: { additive?: boolean }) {
    const target = normalizeId(targetId)
    if (!target) return

    const ordered = normalizeUniqueIds(orderedIds)
    if (!ordered.length) {
      replaceSelected([target])
      return
    }

    const targetIndex = ordered.indexOf(target)
    if (targetIndex < 0) {
      replaceSelected([target])
      return
    }

    const anchor = normalizeId(anchorId.value)
    const anchorIndex = anchor ? ordered.indexOf(anchor) : -1
    const fromIndex = anchorIndex >= 0 ? anchorIndex : targetIndex
    const start = Math.min(fromIndex, targetIndex)
    const end = Math.max(fromIndex, targetIndex)
    const range = ordered.slice(start, end + 1)

    if (opts?.additive) {
      const next = new Set(selectedIds.value)
      for (const id of range) {
        next.add(id)
      }
      selectedIds.value = next
    } else {
      selectedIds.value = new Set(range)
    }

    setAnchor(target)
  }

  function selectByInteraction(
    id: string,
    orderedIds: Iterable<string>,
    modifiers?: MultiSelectInteractionModifiers | null,
  ) {
    const target = normalizeId(id)
    if (!target) return

    const shift = Boolean(modifiers?.shiftKey)
    const additive = Boolean(modifiers?.ctrlKey || modifiers?.metaKey)
    if (shift) {
      selectRange(target, orderedIds, { additive })
      return
    }

    toggleSelected(target)
  }

  function retain(ids: Iterable<string>) {
    const allow = new Set(normalizeUniqueIds(ids))
    const next = new Set<string>()
    for (const id of selectedIds.value) {
      if (allow.has(id)) next.add(id)
    }
    if (next.size !== selectedIds.value.size) {
      selectedIds.value = next
    }

    if (anchorId.value && !allow.has(anchorId.value)) {
      const entries = Array.from(next)
      setAnchor(entries.length > 0 ? entries[entries.length - 1] || '' : '')
    }
  }

  return {
    enabled,
    anchorId,
    selectedIds,
    selectedCount,
    selectedList,
    setEnabled,
    toggleEnabled,
    clearSelection,
    setAnchor,
    isSelected,
    toggleSelected,
    selectAll,
    invertSelection,
    selectRange,
    selectByInteraction,
    retain,
  }
}
