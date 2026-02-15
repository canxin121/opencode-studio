import { computed, type Ref } from 'vue'

import { addTagsToList, normalizeStringList } from './OpenCodeConfigPanelListUtils'
import type { ToastKind } from '@/stores/toasts'
import type { JsonValue as JsonLike } from '@/types/json'

type JsonObject = Record<string, JsonLike>
type PermissionAction = 'allow' | 'ask' | 'deny'
type PermissionTag = 'filesystem' | 'exec' | 'network' | 'other'

export type PermissionEvalStep = {
  key: string
  kind: 'direct' | 'pattern' | 'absent'
  matched?: string
  action?: 'allow' | 'ask' | 'deny'
}

export function useOpenCodeConfigPanelPermissionsPreset(opts: {
  draft: Ref<JsonLike>
  getPath: (obj: JsonLike, path: string) => JsonLike
  setPath: (obj: JsonLike, path: string, value: JsonLike) => void
  deletePath: (obj: JsonLike, path: string) => void
  isPlainObject: (value: JsonLike) => value is JsonObject
  refreshJsonBuffer: (id: string) => void
  matchPattern: (pattern: string, input: string) => boolean

  toolIdOptions: Ref<string[]>

  permissionPreset: Ref<'safe' | 'power' | 'readonly' | ''>
  permissionPresetMode: Ref<'merge' | 'replace'>
  permissionBulkAction: Ref<'allow' | 'ask' | 'deny'>
  permissionBulkTarget: Ref<'selection' | 'tag' | 'all_known' | 'all_via_star'>
  permissionBulkTag: Ref<'filesystem' | 'exec' | 'network' | 'other'>
  permissionBulkSelection: Ref<string[]>
  permissionBulkInput: Ref<string>
  permissionBulkClearOthers: Ref<boolean>
  permissionTestTool: Ref<string>
  permissionTestInput: Ref<string>

  toasts: { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }
  cloneConfig: <T>(value: T) => T
  markDirty: () => void
}) {
  function ensurePermissionMap(): JsonObject {
    const value = opts.getPath(opts.draft.value, 'permission')
    if (typeof value === 'string') {
      return { '*': value }
    }
    if (opts.isPlainObject(value)) return value
    return {}
  }

  function setPermissionRule(key: string, action: string) {
    const map = ensurePermissionMap()
    if (action === 'default') {
      delete map[key]
    } else {
      map[key] = action
    }
    if (Object.keys(map).length === 0) {
      opts.deletePath(opts.draft.value, 'permission')
    } else {
      opts.setPath(opts.draft.value, 'permission', map)
    }
    opts.markDirty()
    opts.refreshJsonBuffer('permission')
  }

  function permissionPresetMap(kind: 'safe' | 'power' | 'readonly'): Record<string, PermissionAction> {
    if (kind === 'power') {
      return { '*': 'allow' }
    }

    if (kind === 'readonly') {
      return {
        '*': 'deny',
        read: 'allow',
        list: 'allow',
        glob: 'allow',
        grep: 'allow',
        codesearch: 'allow',
        webfetch: 'ask',
        websearch: 'ask',
        edit: 'deny',
        bash: 'deny',
        task: 'deny',
        external_directory: 'deny',
      }
    }

    // safe
    return {
      '*': 'ask',
      read: 'allow',
      list: 'allow',
      glob: 'allow',
      grep: 'allow',
      // Keep network/tool execution gated.
      webfetch: 'ask',
      websearch: 'ask',
      codesearch: 'ask',
      edit: 'ask',
      bash: 'ask',
      task: 'ask',
      external_directory: 'ask',
    }
  }

  const permissionCurrentMap = computed<JsonObject>(() => ensurePermissionMap())

  const permissionPresetAppliedMap = computed<JsonObject>(() => {
    const sel = opts.permissionPreset.value
    if (!sel) return permissionCurrentMap.value
    const preset = permissionPresetMap(sel)
    if (opts.permissionPresetMode.value === 'replace') return preset
    // merge
    return { ...permissionCurrentMap.value, ...preset }
  })

  function applyPermissionPreset() {
    const sel = opts.permissionPreset.value
    if (!sel) return
    const next = opts.cloneConfig(permissionPresetAppliedMap.value)
    if (Object.keys(next).length === 0) {
      opts.deletePath(opts.draft.value, 'permission')
    } else {
      opts.setPath(opts.draft.value, 'permission', next)
    }
    opts.markDirty()
    opts.refreshJsonBuffer('permission')
    opts.toasts.push('success', `Applied permission preset: ${sel} (${opts.permissionPresetMode.value})`)
  }

  function toolCapabilityTags(id: string): PermissionTag[] {
    const s = String(id || '').trim()
    if (!s) return ['other']
    if (['read', 'edit', 'glob', 'grep', 'list', 'external_directory', 'lsp'].includes(s)) return ['filesystem']
    if (['bash', 'task', 'skill', 'doom_loop'].includes(s)) return ['exec']
    if (['webfetch', 'websearch', 'codesearch'].includes(s)) return ['network']
    return ['other']
  }

  const toolIdsByTag = computed(() => {
    const map: Record<PermissionTag, string[]> = { filesystem: [], exec: [], network: [], other: [] }
    for (const id of opts.toolIdOptions.value) {
      for (const tag of toolCapabilityTags(id)) {
        map[tag]?.push(id)
      }
    }
    for (const k of ['filesystem', 'exec', 'network', 'other'] as PermissionTag[]) {
      map[k] = normalizeStringList(map[k]).sort((a, b) => a.localeCompare(b))
    }
    return map
  })

  function addPermissionBulkSelectionTags(raw: string) {
    opts.permissionBulkSelection.value = addTagsToList(opts.permissionBulkSelection.value, raw)
    opts.permissionBulkInput.value = ''
  }

  function selectPermissionBulkByTag(tag: 'filesystem' | 'exec' | 'network' | 'other') {
    opts.permissionBulkSelection.value = toolIdsByTag.value[tag]
  }

  function applyPermissionBulk() {
    const action: PermissionAction = opts.permissionBulkAction.value
    const target = opts.permissionBulkTarget.value

    const map = ensurePermissionMap()

    if (target === 'all_via_star') {
      // Set '*' and optionally clear everything else.
      map['*'] = action
      if (opts.permissionBulkClearOthers.value) {
        for (const k of Object.keys(map)) {
          if (k !== '*') delete map[k]
        }
      }
      opts.setPath(opts.draft.value, 'permission', map)
      opts.markDirty()
      opts.refreshJsonBuffer('permission')
      opts.toasts.push('success', `Set permission.* = ${action}`)
      return
    }

    let ids: string[] = []
    if (target === 'all_known') {
      ids = opts.toolIdOptions.value.slice()
    } else if (target === 'tag') {
      ids = toolIdsByTag.value[opts.permissionBulkTag.value]
    } else {
      ids = opts.permissionBulkSelection.value.slice()
    }
    ids = normalizeStringList(ids).filter((id) => id !== '*')
    if (ids.length === 0) {
      opts.toasts.push('error', 'No tools selected for bulk apply')
      return
    }

    if (opts.permissionBulkClearOthers.value) {
      for (const k of Object.keys(map)) {
        if (k === '*') continue
        delete map[k]
      }
    }

    for (const id of ids) {
      map[id] = action
    }
    opts.setPath(opts.draft.value, 'permission', map)
    opts.markDirty()
    opts.refreshJsonBuffer('permission')
    opts.toasts.push('success', `Applied ${action} to ${ids.length} tools`)
  }

  function evalPermissionForKey(map: JsonObject, key: string, input: string): PermissionEvalStep {
    const v = map[key]
    if (v === undefined) return { key, kind: 'absent' }
    if (v === 'allow' || v === 'ask' || v === 'deny') return { key, kind: 'direct', matched: '(direct)', action: v }
    if (opts.isPlainObject(v)) {
      let winner: PermissionEvalStep = { key, kind: 'pattern' }
      for (const pattern of Object.keys(v)) {
        if (pattern === '__originalKeys') continue
        const action = v[pattern]
        if (action !== 'allow' && action !== 'ask' && action !== 'deny') continue
        if (opts.matchPattern(pattern, input)) {
          // last match wins
          winner = { key, kind: 'pattern', matched: pattern, action }
        }
      }
      return winner.action ? winner : { key, kind: 'pattern' }
    }
    return { key, kind: 'absent' }
  }

  const permissionTestToolOptions = computed(() => {
    const set = new Set<string>()
    set.add('*')
    for (const id of opts.toolIdOptions.value) set.add(id)
    for (const k of Object.keys(ensurePermissionMap())) set.add(k)
    return Array.from(set.values()).sort((a, b) => {
      if (a === '*') return -1
      if (b === '*') return 1
      return a.localeCompare(b)
    })
  })

  const permissionTestResult = computed(() => {
    const map = ensurePermissionMap()
    const tool = opts.permissionTestTool.value.trim() || '*'
    const input = opts.permissionTestInput.value

    const steps: PermissionEvalStep[] = []
    const primary = evalPermissionForKey(map, tool, input)
    steps.push(primary)
    let effective: PermissionEvalStep | null = primary.action ? primary : null

    if (!effective && tool !== '*') {
      const star = evalPermissionForKey(map, '*', input)
      steps.push(star)
      if (star.action) effective = star
    }

    return {
      tool,
      input,
      steps,
      action: effective?.action || 'default',
      matched: effective?.matched || '(none)',
      source: effective ? `permission.${effective.key}` : 'default',
      note: 'Matching is best-effort glob semantics; OpenCode runtime may differ.',
    }
  })

  return {
    addPermissionBulkSelectionTags,
    applyPermissionBulk,
    applyPermissionPreset,
    ensurePermissionMap,
    permissionCurrentMap,
    permissionPresetAppliedMap,
    permissionTestResult,
    permissionTestToolOptions,
    selectPermissionBulkByTag,
    setPermissionRule,
    toolIdsByTag,
  }
}
