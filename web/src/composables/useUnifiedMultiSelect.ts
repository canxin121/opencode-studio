import { computed, ref } from 'vue'

export function useUnifiedMultiSelect() {
  const enabled = ref(false)
  const selectedIds = ref<Set<string>>(new Set())

  const selectedCount = computed(() => selectedIds.value.size)
  const selectedList = computed(() => Array.from(selectedIds.value))

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function setEnabled(next: boolean) {
    if (!next) clearSelection()
    enabled.value = next
  }

  function toggleEnabled() {
    setEnabled(!enabled.value)
  }

  function isSelected(id: string) {
    return selectedIds.value.has(id)
  }

  function toggleSelected(id: string) {
    const normalized = (id || '').trim()
    if (!normalized) return
    const next = new Set(selectedIds.value)
    if (next.has(normalized)) {
      next.delete(normalized)
    } else {
      next.add(normalized)
    }
    selectedIds.value = next
  }

  function retain(ids: Iterable<string>) {
    const allow = new Set(Array.from(ids, (id) => (id || '').trim()).filter(Boolean))
    const next = new Set<string>()
    for (const id of selectedIds.value) {
      if (allow.has(id)) next.add(id)
    }
    if (next.size !== selectedIds.value.size) {
      selectedIds.value = next
    }
  }

  return {
    enabled,
    selectedIds,
    selectedCount,
    selectedList,
    setEnabled,
    toggleEnabled,
    clearSelection,
    isSelected,
    toggleSelected,
    retain,
  }
}
