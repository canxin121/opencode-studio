import { ref } from 'vue'

import type { PatternEntry, PatternEditorState } from './OpenCodeConfigPanelPatternTypes'
import type { JsonValue as JsonLike } from '@/types/json'

type JsonObject = Record<string, JsonLike>
type PermissionAction = 'allow' | 'ask' | 'deny'

export function useOpenCodeConfigPanelAgentPermissionPatterns(opts: {
  isPlainObject: (value: JsonLike) => value is JsonObject
  agentPermissionMap: (agentId: string, ensure?: boolean) => JsonObject
  setAgentPermissionMap: (agentId: string, next: JsonObject) => void
}) {
  const agentPermissionNewTool = ref<Record<string, string>>({})
  const agentPermissionNewAction = ref<Record<string, PermissionAction>>({})
  const agentPermissionPatternEditors = ref<Record<string, PatternEditorState>>({})

  function agentPermissionRuleValue(agentId: string, key: string, ensure = false): string {
    const v = opts.agentPermissionMap(agentId, ensure)[key]
    if (typeof v === 'string') return v
    if (opts.isPlainObject(v)) return 'pattern'
    return 'default'
  }

  function agentPermissionPatternCount(agentId: string, key: string, ensure = false): number {
    const v = opts.agentPermissionMap(agentId, ensure)[key]
    if (!opts.isPlainObject(v)) return 0
    return Object.keys(v).filter((k) => k !== '__originalKeys').length
  }

  function agentPermEditorKey(agentId: string, key: string): string {
    return `${agentId}::${key}`
  }

  function ensureAgentPermissionPatternEditor(agentId: string, key: string): PatternEditorState {
    const ek = agentPermEditorKey(agentId, key)
    const existing = agentPermissionPatternEditors.value[ek]
    if (existing) return existing

    const v = opts.agentPermissionMap(agentId)[key]
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
    agentPermissionPatternEditors.value = { ...agentPermissionPatternEditors.value, [ek]: state }
    return state
  }

  function toggleAgentPermissionPatternEditor(agentId: string, key: string) {
    const ek = agentPermEditorKey(agentId, key)
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    state.open = !state.open
    state.error = null
    agentPermissionPatternEditors.value = { ...agentPermissionPatternEditors.value, [ek]: state }
  }

  function resetAgentPermissionPatternEditor(agentId: string, key: string) {
    const ek = agentPermEditorKey(agentId, key)
    const next = { ...agentPermissionPatternEditors.value }
    delete next[ek]
    agentPermissionPatternEditors.value = next
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    state.open = true
  }

  function setAgentPermissionPatternMap(agentId: string, key: string, entries: PatternEntry[]) {
    const map = { ...opts.agentPermissionMap(agentId) }
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
    opts.setAgentPermissionMap(agentId, map)
  }

  function applyAgentPermissionPatternEditor(agentId: string, key: string) {
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    const cleaned: PatternEntry[] = []
    const seen = new Set<string>()
    for (const row of state.entries) {
      const pattern = String(row.pattern || '').trim()
      if (!pattern) continue
      if (seen.has(pattern)) {
        state.error = `Duplicate pattern: ${pattern}`
        return
      }
      seen.add(pattern)
      cleaned.push({ pattern, action: row.action })
    }
    if (cleaned.length === 0) {
      // Remove rule and close.
      const map = { ...opts.agentPermissionMap(agentId) }
      delete map[key]
      opts.setAgentPermissionMap(agentId, map)
      state.error = null
      return
    }
    setAgentPermissionPatternMap(agentId, key, cleaned)
    state.error = null
  }

  function moveAgentPermissionPatternRow(agentId: string, key: string, idx: number, dir: -1 | 1) {
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    const next = idx + dir
    if (next < 0 || next >= state.entries.length) return
    const [row] = state.entries.splice(idx, 1)
    state.entries.splice(next, 0, row as PatternEntry)
  }

  function removeAgentPermissionPatternRow(agentId: string, key: string, idx: number) {
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    state.entries.splice(idx, 1)
  }

  function addAgentPermissionPatternRow(agentId: string, key: string) {
    const state = ensureAgentPermissionPatternEditor(agentId, key)
    state.entries.push({ pattern: '', action: 'ask' })
  }

  function onAgentPermissionSelectChange(agentId: string, key: string, value: string) {
    if (value === 'pattern') {
      const current = opts.agentPermissionMap(agentId)[key]
      const action: PermissionAction =
        current === 'allow' || current === 'deny' || current === 'ask' ? current : 'ask'
      const map = { ...opts.agentPermissionMap(agentId) }
      if (!opts.isPlainObject(map[key])) {
        map[key] = { '*': action }
        opts.setAgentPermissionMap(agentId, map)
      }
      toggleAgentPermissionPatternEditor(agentId, key)
      return
    }

    const map = { ...opts.agentPermissionMap(agentId) }
    if (value === 'default') {
      delete map[key]
    } else {
      map[key] = value
    }
    opts.setAgentPermissionMap(agentId, map)
  }

  function addAgentPermissionRule(agentId: string) {
    const tool = String(agentPermissionNewTool.value[agentId] || '').trim()
    const action = agentPermissionNewAction.value[agentId] || 'ask'
    if (!tool) return
    const map = { ...opts.agentPermissionMap(agentId) }
    map[tool] = action
    opts.setAgentPermissionMap(agentId, map)
    agentPermissionNewTool.value = { ...agentPermissionNewTool.value, [agentId]: '' }
  }

  function onAgentPermissionPatternKeydown(
    agentId: string,
    key: string,
    idx: number,
    row: PatternEntry,
    e: KeyboardEvent,
  ) {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      moveAgentPermissionPatternRow(agentId, key, idx, -1)
      return
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      moveAgentPermissionPatternRow(agentId, key, idx, 1)
      return
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      applyAgentPermissionPatternEditor(agentId, key)
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      toggleAgentPermissionPatternEditor(agentId, key)
      return
    }

    if (e.key === 'Enter') {
      const state = ensureAgentPermissionPatternEditor(agentId, key)
      const last = state.entries.length - 1
      if (idx === last) {
        e.preventDefault()
        addAgentPermissionPatternRow(agentId, key)
      }
      return
    }

    if (e.key === 'Backspace') {
      const state = ensureAgentPermissionPatternEditor(agentId, key)
      if (state.entries.length > 1 && !String(row.pattern || '').trim()) {
        removeAgentPermissionPatternRow(agentId, key, idx)
      }
    }
  }

  return {
    agentPermissionNewTool,
    agentPermissionNewAction,
    agentPermissionPatternEditors,
    agentPermissionPatternCount,
    agentPermissionRuleValue,
    toggleAgentPermissionPatternEditor,
    applyAgentPermissionPatternEditor,
    resetAgentPermissionPatternEditor,
    addAgentPermissionPatternRow,
    moveAgentPermissionPatternRow,
    removeAgentPermissionPatternRow,
    onAgentPermissionSelectChange,
    onAgentPermissionPatternKeydown,
    addAgentPermissionRule,
  }
}
