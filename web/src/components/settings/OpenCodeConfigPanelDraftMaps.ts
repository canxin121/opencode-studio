type DraftValue = unknown
type JsonObject = Record<string, DraftValue>
type GetPath = (obj: DraftValue, path: string) => DraftValue
type SetPath = (obj: DraftValue, path: string, value: DraftValue) => void
type DeletePath = (obj: DraftValue, path: string) => void
type IsPlainObject = (v: DraftValue) => v is JsonObject
type IsEmptyValue = (v: DraftValue) => boolean

export function useOpenCodeConfigPanelDraftMaps(opts: {
  draft: { value: DraftValue }
  getPath: GetPath
  setPath: SetPath
  deletePath: DeletePath
  isPlainObject: IsPlainObject
  isEmptyValue: IsEmptyValue
  markDirty: () => void
}) {
  const { draft, getPath, setPath, deletePath, isPlainObject, isEmptyValue, markDirty } = opts

  function getMap(path: string): JsonObject {
    const value = getPath(draft.value, path)
    return isPlainObject(value) ? value : {}
  }

  function ensureMap(path: string): JsonObject {
    const value = getPath(draft.value, path)
    if (!isPlainObject(value)) {
      setPath(draft.value, path, {})
      markDirty()
      const next = getPath(draft.value, path)
      return isPlainObject(next) ? next : {}
    }
    return value
  }

  function ensureEntry(mapPath: string, key: string): JsonObject {
    const map = ensureMap(mapPath)
    const existing = map[key]
    if (!isPlainObject(existing)) {
      const next: JsonObject = {}
      map[key] = next
      markDirty()
      return next
    }
    return existing
  }

  function setEntryField(mapPath: string, key: string, field: string, value: DraftValue) {
    const map = ensureMap(mapPath)
    const entry = ensureEntry(mapPath, key)
    if (isEmptyValue(value)) {
      delete entry[field]
    } else {
      entry[field] = value
    }
    if (Object.keys(entry).length === 0) {
      delete map[key]
    }
    if (Object.keys(map).length === 0) {
      deletePath(draft.value, mapPath)
    }
    markDirty()
  }

  function removeEntry(mapPath: string, key: string) {
    const map = getMap(mapPath)
    if (map[key]) {
      delete map[key]
      markDirty()
    }
    if (Object.keys(map).length === 0) {
      deletePath(draft.value, mapPath)
    }
  }

  return {
    getMap,
    ensureMap,
    ensureEntry,
    setEntryField,
    removeEntry,
  }
}
