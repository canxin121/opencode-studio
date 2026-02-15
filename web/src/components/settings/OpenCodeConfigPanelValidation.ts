import type { ComputedRef } from 'vue'

type Severity = 'error' | 'warning'
type ValidationValue = unknown
type ValidationRecord = Record<string, ValidationValue>

type ValidationIssue = {
  path: string
  message: string
  severity: Severity
  [k: string]: ValidationValue
}

function asRecord(value: ValidationValue): ValidationRecord {
  return typeof value === 'object' && value !== null ? (value as ValidationRecord) : {}
}

// Keep this shape loose so it matches the panel's draft/validation types.
type AddIssue = (out: ValidationIssue[], path: string, message: string, severity: Severity) => void
type GetPath = (obj: ValidationValue, path: string) => ValidationValue
type IsPlainObject = (v: ValidationValue) => v is ValidationRecord
type GetMap = (path: string) => ValidationRecord

export function createOpenCodeConfigPanelValidation(opts: {
  draft: { value: ValidationValue }
  getPath: GetPath
  getMap: GetMap
  isPlainObject: IsPlainObject
  addIssue: AddIssue
  modelWarning: ComputedRef<string>
  smallModelWarning: ComputedRef<string>
  defaultAgentWarning: ComputedRef<string>
  providerListConflict: ComputedRef<string[]>
  BUILTIN_LSP_IDS: Set<string>
  modelFormatWarning: (value: string) => string
}) {
  const {
    draft,
    getPath,
    getMap,
    isPlainObject,
    addIssue,
    modelWarning,
    smallModelWarning,
    defaultAgentWarning,
    providerListConflict,
    BUILTIN_LSP_IDS,
    modelFormatWarning,
  } = opts

  return function runClientValidation(): ValidationIssue[] {
    const out: ValidationIssue[] = []

    // Model slug format.
    if (modelWarning.value) addIssue(out, 'model', modelWarning.value, 'error')
    if (smallModelWarning.value) addIssue(out, 'small_model', smallModelWarning.value, 'error')

    // Default agent must exist and be primary (not hidden/subagent).
    if (defaultAgentWarning.value) addIssue(out, 'default_agent', defaultAgentWarning.value, 'error')

    // Enabled/disabled provider conflict.
    if (providerListConflict.value.length > 0) {
      addIssue(
        out,
        'enabled_providers',
        `Conflicts with disabled_providers: ${providerListConflict.value.join(', ')}`,
        'error',
      )
      addIssue(
        out,
        'disabled_providers',
        `Conflicts with enabled_providers: ${providerListConflict.value.join(', ')}`,
        'error',
      )
    }

    // Permissions: ensure values are strings or pattern maps.
    const perm = getPath(draft.value, 'permission')
    if (perm !== undefined && !isPlainObject(perm)) {
      addIssue(out, 'permission', 'Expected an object mapping tool id -> allow/ask/deny or a pattern map', 'error')
    }

    // LSP: custom servers require extensions (mirrors server-side validate).
    const lsp = getPath(draft.value, 'lsp')
    if (isPlainObject(lsp)) {
      for (const [id, cfg] of Object.entries(lsp)) {
        const serverId = String(id || '').trim()
        if (!serverId) continue
        if (BUILTIN_LSP_IDS.has(serverId)) continue
        if (!cfg || typeof cfg !== 'object') continue

        const cfgRecord = asRecord(cfg)
        const disabled = cfgRecord.disabled === true
        if (disabled) continue

        const extensions = cfgRecord.extensions
        if (
          !Array.isArray(extensions) ||
          extensions.filter((s) => typeof s === 'string' && s.trim()).length === 0
        ) {
          addIssue(out, `lsp.${serverId}.extensions`, `Custom LSP server '${serverId}' requires extensions`, 'error')
        }
      }
    }

    // Commands: template required; model format if provided.
    const cmdMap = getMap('command')
    for (const [name, cfg] of Object.entries(cmdMap)) {
      const id = String(name || '').trim()
      if (!id) continue
      const c = asRecord(cfg)
      const tpl = typeof c?.template === 'string' ? c.template : ''
      if (!tpl.trim()) {
        addIssue(out, `command.${id}.template`, 'Command template is required', 'error')
      }
      const m = typeof c?.model === 'string' ? c.model : ''
      const mw = modelFormatWarning(m)
      if (mw) {
        addIssue(out, `command.${id}.model`, mw, 'error')
      }
    }

    // Agents: model format; warn about hidden/subagent mismatch.
    const agMap = getMap('agent')
    for (const [name, cfg] of Object.entries(agMap)) {
      const id = String(name || '').trim()
      if (!id) continue
      const a = asRecord(cfg)
      const m = typeof a?.model === 'string' ? a.model : ''
      const mw = modelFormatWarning(m)
      if (mw) {
        addIssue(out, `agent.${id}.model`, mw, 'error')
      }
      const mode = typeof a?.mode === 'string' ? a.mode : ''
      const hidden = a?.hidden === true
      if (mode === 'subagent' && !hidden) {
        addIssue(out, `agent.${id}.hidden`, 'Subagent is usually hidden from autocomplete (recommended)', 'warning')
      }
      if (mode !== 'subagent' && hidden) {
        addIssue(
          out,
          `agent.${id}.hidden`,
          'Hidden is intended for subagents; consider setting mode=subagent',
          'warning',
        )
      }
    }

    return out
  }
}
