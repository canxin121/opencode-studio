import { ref, type Ref } from 'vue'

import type { PatternEntry, PatternEditorState } from './OpenCodeConfigPanelPatternTypes'

type ConfigValue = unknown
type JsonObject = Record<string, ConfigValue>
type PermissionAction = 'allow' | 'ask' | 'deny'

export function useOpenCodeConfigPanelPermissionPatterns(opts: {
  draft: Ref<ConfigValue>
  isPlainObject: (value: ConfigValue) => value is JsonObject
  ensurePermissionMap: () => JsonObject
  setPermissionRule: (key: string, action: string) => void
  setPath: (obj: ConfigValue, path: string, value: ConfigValue) => void
  deletePath: (obj: ConfigValue, path: string) => void
  refreshJsonBuffer: (id: string) => void
  markDirty: () => void
}) {
  const permissionPatternEditors = ref<Record<string, PatternEditorState>>({})

  function permissionRuleValue(key: string): string {
    const map = opts.ensurePermissionMap()
    const v = map[key]
    if (typeof v === 'string') return v
    if (opts.isPlainObject(v)) return 'pattern'
    return 'default'
  }

  function permissionRuleKind(key: string): 'default' | 'action' | 'pattern' {
    const v = opts.ensurePermissionMap()[key]
    if (typeof v === 'string') return 'action'
    if (opts.isPlainObject(v)) return 'pattern'
    return 'default'
  }

  function ensurePermissionPatternEditor(key: string): PatternEditorState {
    const existing = permissionPatternEditors.value[key]
    if (existing) return existing

    const v = opts.ensurePermissionMap()[key]
    const entries: PatternEntry[] = []
    if (typeof v === 'string') {
      const action = v === 'allow' || v === 'deny' || v === 'ask' ? v : 'ask'
      entries.push({ pattern: '*', action })
    } else if (opts.isPlainObject(v)) {
      for (const [pattern, action] of Object.entries(v)) {
        if (pattern === '__originalKeys') continue
        const a = typeof action === 'string' ? action : ''
        if (a !== 'allow' && a !== 'ask' && a !== 'deny') continue
        entries.push({ pattern: String(pattern), action: a })
      }
    } else {
      entries.push({ pattern: '*', action: 'ask' })
    }

    const state: PatternEditorState = { open: false, entries, error: null }
    permissionPatternEditors.value = { ...permissionPatternEditors.value, [key]: state }
    return state
  }

  function togglePermissionPatternEditor(key: string) {
    const state = ensurePermissionPatternEditor(key)
    state.open = !state.open
    state.error = null
  }

  function resetPermissionPatternEditor(key: string) {
    const next = { ...permissionPatternEditors.value }
    delete next[key]
    permissionPatternEditors.value = next
    const state = ensurePermissionPatternEditor(key)
    state.open = true
  }

  function addPatternRow(key: string) {
    const state = ensurePermissionPatternEditor(key)
    state.entries.push({ pattern: '', action: 'ask' })
  }

  function removePatternRow(key: string, idx: number) {
    const state = ensurePermissionPatternEditor(key)
    state.entries.splice(idx, 1)
  }

  function movePatternRow(key: string, idx: number, dir: -1 | 1) {
    const state = ensurePermissionPatternEditor(key)
    const next = idx + dir
    if (next < 0 || next >= state.entries.length) return
    const row = state.entries[idx]
    if (!row) return
    state.entries.splice(idx, 1)
    state.entries.splice(next, 0, row)
  }

  function setPermissionPatternMap(key: string, entries: PatternEntry[]) {
    const map = opts.ensurePermissionMap()
    const obj: Record<string, string> = {}
    for (const e of entries) {
      const p = String(e.pattern || '').trim()
      if (!p) continue
      obj[p] = e.action
    }
    if (Object.keys(obj).length === 0) {
      delete map[key]
    } else {
      map[key] = obj
    }
    if (Object.keys(map).length === 0) {
      opts.deletePath(opts.draft.value, 'permission')
    } else {
      opts.setPath(opts.draft.value, 'permission', map)
    }
    opts.markDirty()
    opts.refreshJsonBuffer('permission')
  }

  function permissionPatternCount(key: string): number {
    const v = opts.ensurePermissionMap()[key]
    if (!opts.isPlainObject(v)) return 0
    return Object.keys(v).filter((k) => k !== '__originalKeys').length
  }

  function applyPermissionPatternEditor(key: string) {
    const state = ensurePermissionPatternEditor(key)
    const cleaned: PatternEntry[] = []
    const seen = new Set<string>()
    for (const row of state.entries) {
      const pattern = String(row.pattern || '').trim()
      if (!pattern) continue
      if (seen.has(pattern)) {
        // Duplicate patterns are ambiguous; require unique keys.
        state.error = `Duplicate pattern: ${pattern}`
        return
      }
      seen.add(pattern)
      cleaned.push({ pattern, action: row.action })
    }
    if (cleaned.length === 0) {
      opts.setPermissionRule(key, 'default')
      state.error = null
      return
    }
    setPermissionPatternMap(key, cleaned)
    state.error = null
  }

  function onPermissionSelectChange(key: string, value: string) {
    if (value === 'pattern') {
      // Convert action/default to a trivial pattern map, then open editor.
      const kind = permissionRuleKind(key)
      if (kind !== 'pattern') {
        const current = opts.ensurePermissionMap()[key]
        const action: PermissionAction =
          current === 'allow' || current === 'deny' || current === 'ask' ? current : 'ask'
        setPermissionPatternMap(key, [{ pattern: '*', action }])
      }
      togglePermissionPatternEditor(key)
      return
    }
    opts.setPermissionRule(key, value)
  }

  function onPermissionPatternKeydown(key: string, idx: number, row: PatternEntry, e: KeyboardEvent) {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      movePatternRow(key, idx, -1)
      return
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      movePatternRow(key, idx, 1)
      return
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      applyPermissionPatternEditor(key)
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      togglePermissionPatternEditor(key)
      return
    }

    if (e.key === 'Enter') {
      // Convenience: when on the last row, add another row.
      const state = ensurePermissionPatternEditor(key)
      const last = state.entries.length - 1
      if (idx === last) {
        e.preventDefault()
        addPatternRow(key)
      }
      return
    }

    if (e.key === 'Backspace') {
      const state = ensurePermissionPatternEditor(key)
      if (state.entries.length > 1 && !String(row.pattern || '').trim()) {
        // Allow removing empty rows quickly.
        removePatternRow(key, idx)
      }
    }
  }

  return {
    permissionPatternEditors,
    permissionPatternCount,
    permissionRuleValue,
    onPermissionSelectChange,
    onPermissionPatternKeydown,
    togglePermissionPatternEditor,
    applyPermissionPatternEditor,
    resetPermissionPatternEditor,
    addPatternRow,
    movePatternRow,
    removePatternRow,
  }
}
