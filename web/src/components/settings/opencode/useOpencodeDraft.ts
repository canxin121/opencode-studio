import { ref, type Ref } from 'vue'

import { cloneConfig, deletePath, getPath, isEmptyValue, setPath } from '../ConfigUtils'
import type { ToastKind } from '@/stores/toasts'
import { localStorageKeys } from '@/lib/persistence/storageKeys'
import type { JsonObject, JsonValue } from '@/types/json'

export type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' }

type DraftMetaValue = unknown
type DraftMetaRecord = Record<string, DraftMetaValue>

function asRecord(value: DraftMetaValue): DraftMetaRecord {
  return typeof value === 'object' && value !== null ? (value as DraftMetaRecord) : {}
}

export type JsonBufferPublic = {
  text: string
  error: string | null
}

type JsonBufferInternal = JsonBufferPublic & {
  get: () => JsonValue
  set: (value: JsonValue) => void
  fallback: JsonValue
}

type ToastsLike = {
  // Use a permissive signature so we can accept the pinia toasts store
  // without importing its types here.
  push: (kind: ToastKind, message: string, timeoutMs?: number) => void
}

const SAVE_META_KEY = localStorageKeys.settings.opencodeSaveMeta

export function useOpencodeDraft(opts: {
  activePath: Ref<string>
  configData: Ref<JsonObject | null | undefined>
  configError?: Ref<string | null | undefined>
  toasts?: ToastsLike
  onInvalidate?: () => void
}) {
  const draft = ref<JsonObject>({})
  const dirty = ref(false)
  const localError = ref<string | null>(null)

  const jsonBuffers = ref<Record<string, JsonBufferInternal>>({})

  const validationIssues = ref<ValidationIssue[]>([])

  const lastSaveOkAt = ref<number | null>(null)
  const lastSaveError = ref<string | null>(null)
  const lastSaveErrorAt = ref<number | null>(null)

  function invalidate() {
    try {
      opts.onInvalidate?.()
    } catch {
      // ignore
    }
  }

  function syncDraft() {
    draft.value = cloneConfig(opts.configData.value || {})
    dirty.value = false
    localError.value = opts.configError?.value ?? null
    jsonBuffers.value = {}
    invalidate()
  }

  function markDirty() {
    dirty.value = true
    invalidate()
  }

  function setOrClear(path: string, value: JsonValue) {
    if (isEmptyValue(value)) {
      deletePath(draft.value, path)
    } else {
      setPath(draft.value, path, value)
    }
    dirty.value = true
  }

  function ensureJsonBuffer(
    id: string,
    get: () => JsonValue,
    set: (value: JsonValue) => void,
    fallback: JsonValue,
  ): JsonBufferPublic {
    if (!jsonBuffers.value[id]) {
      jsonBuffers.value[id] = {
        text: '',
        error: null,
        get,
        set,
        fallback,
      }
      const current = get()
      jsonBuffers.value[id].text = JSON.stringify(current ?? fallback, null, 2)
    } else {
      jsonBuffers.value[id].get = get
      jsonBuffers.value[id].set = set
      jsonBuffers.value[id].fallback = fallback
    }
    return jsonBuffers.value[id]
  }

  function applyJsonBuffer(id: string): boolean {
    const buf = jsonBuffers.value[id]
    if (!buf) return true
    const raw = buf.text.trim()
    if (!raw) {
      buf.set(null)
      buf.error = null
      return true
    }
    try {
      const parsed = JSON.parse(raw)
      if (isEmptyValue(parsed)) {
        buf.set(null)
      } else {
        buf.set(parsed)
      }
      buf.error = null
      return true
    } catch (err) {
      buf.error = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  function refreshJsonBuffer(id: string) {
    const buf = jsonBuffers.value[id]
    if (!buf) return
    const current = buf.get()
    buf.text = JSON.stringify(current ?? buf.fallback, null, 2)
    buf.error = null
  }

  function applyAllJsonBuffers(): boolean {
    let ok = true
    for (const id of Object.keys(jsonBuffers.value)) {
      if (!applyJsonBuffer(id)) ok = false
    }
    return ok
  }

  function resetSection(sectionId: string) {
    const base = cloneConfig(opts.configData.value || {})

    const sectionPaths: Record<string, string[]> = {
      general: [
        '$schema',
        'theme',
        'username',
        'default_agent',
        'model',
        'small_model',
        'logLevel',
        'share',
        'autoupdate',
        'snapshot',
      ],
      instructions: ['instructions', 'skills', 'plugin'],
      providers: ['enabled_providers', 'disabled_providers', 'provider'],
      tui: ['tui'],
      server: ['server', 'watcher'],
      commands: ['command'],
      agents: ['agent'],
      permissions: ['permission'],
      mcp: ['mcp'],
      formatter: ['formatter', 'lsp'],
      keybinds: ['keybinds'],
      compaction: ['compaction'],
      experimental: ['experimental'],
      enterprise: ['enterprise'],
    }

    const paths = sectionPaths[sectionId] || []
    for (const p of paths) {
      const v = getPath(base, p)
      if (isEmptyValue(v)) {
        deletePath(draft.value, p)
      } else {
        setPath(draft.value, p, cloneConfig(v))
      }
    }

    // Refresh JSON buffer caches for related dynamic editors.
    const dropPrefixes: Record<string, string[]> = {
      providers: ['provider:', 'model:', 'variant:'],
      agents: ['agent:'],
      commands: ['command:'],
      permissions: ['permission'],
      mcp: ['mcp:'],
      formatter: ['formatter:'],
      server: ['server'],
      enterprise: ['enterprise'],
      experimental: ['experimental'],
    }

    const prefixes = dropPrefixes[sectionId] || []
    if (prefixes.length) {
      const next: Record<string, JsonBufferInternal> = {}
      for (const [k, v] of Object.entries(jsonBuffers.value)) {
        const shouldDrop = prefixes.some((pfx) => k === pfx || k.startsWith(pfx))
        if (!shouldDrop) next[k] = v
      }
      jsonBuffers.value = next
    }

    dirty.value = true
    opts.toasts?.push('success', `Reset section: ${sectionId}`)
  }

  function loadSaveMeta() {
    try {
      const raw = window.localStorage.getItem(SAVE_META_KEY)
      if (!raw) return
      const parsed = asRecord(JSON.parse(raw))
      const p = (opts.activePath.value || '').trim()
      const v = p ? asRecord(parsed[p]) : null
      if (typeof v?.okAt === 'number') lastSaveOkAt.value = v.okAt
      if (typeof v?.err === 'string') lastSaveError.value = v.err
      if (typeof v?.errAt === 'number') lastSaveErrorAt.value = v.errAt
    } catch {
      // ignore
    }
  }

  function persistSaveMeta() {
    try {
      const p = (opts.activePath.value || '').trim()
      if (!p) return
      const raw = window.localStorage.getItem(SAVE_META_KEY)
      const parsed = raw ? asRecord(JSON.parse(raw)) : {}
      parsed[p] = { okAt: lastSaveOkAt.value, err: lastSaveError.value, errAt: lastSaveErrorAt.value }
      window.localStorage.setItem(SAVE_META_KEY, JSON.stringify(parsed))
    } catch {
      // ignore
    }
  }

  function addIssue(out: ValidationIssue[], path: string, message: string, severity: 'error' | 'warning' = 'error') {
    const p = String(path || '').trim() || '(root)'
    const msg = String(message || '').trim()
    if (!msg) return
    out.push({ path: p, message: msg, severity })
  }

  function issuesForPathPrefix(prefix: string): ValidationIssue[] {
    const pfx = String(prefix || '').trim()
    if (!pfx) return []
    return validationIssues.value.filter((i) => i.path === pfx || i.path.startsWith(`${pfx}.`))
  }

  function issueText(prefix: string): string {
    const list = issuesForPathPrefix(prefix).filter((i) => i.severity === 'error')
    return list.length ? list[0]!.message : ''
  }

  function parseServerErrorMessage(err: DraftMetaValue): string {
    if (!err) return ''
    if (err instanceof Error) {
      // Some ApiError messages already include the body.
      const msg = (err.message || '').trim()
      if (!msg) return ''
      try {
        const parsed = JSON.parse(msg)
        const e = asRecord(parsed).error
        if (typeof e === 'string' && e.trim()) return e.trim()
      } catch {
        // not json
      }
      return msg
    }
    const s = String(err).trim()
    return s
  }

  function mapServerErrorToIssues(serverMessage: string): ValidationIssue[] {
    const out: ValidationIssue[] = []
    const msg = (serverMessage || '').trim()
    if (!msg) return out

    // Match OpenCode Studio server validate output.
    const m = msg.match(/custom LSP server '([^']+)' requires extensions/)
    if (m && m[1]) {
      addIssue(out, `lsp.${m[1]}.extensions`, msg, 'error')
      return out
    }

    // Serde unknown/missing field patterns (best effort).
    const unknown = msg.match(/unknown field `([^`]+)`/)
    if (unknown && unknown[1]) {
      addIssue(out, unknown[1], msg, 'error')
      return out
    }
    const missing = msg.match(/missing field `([^`]+)`/)
    if (missing && missing[1]) {
      addIssue(out, missing[1], msg, 'error')
      return out
    }

    addIssue(out, '(server)', msg, 'error')
    return out
  }

  function setValidationIssues(issues: ValidationIssue[]) {
    validationIssues.value = Array.isArray(issues) ? issues : []
  }

  function clearValidationIssues() {
    validationIssues.value = []
  }

  return {
    // Draft state
    draft,
    dirty,
    localError,
    syncDraft,
    markDirty,
    setOrClear,

    // JSON editing buffers
    jsonBuffers,
    ensureJsonBuffer,
    applyJsonBuffer,
    refreshJsonBuffer,
    applyAllJsonBuffers,

    // Validation issues (collection + helpers)
    validationIssues,
    setValidationIssues,
    clearValidationIssues,
    issuesForPathPrefix,
    issueText,
    addIssue,
    parseServerErrorMessage,
    mapServerErrorToIssues,

    // Save meta persistence
    lastSaveOkAt,
    lastSaveError,
    lastSaveErrorAt,
    loadSaveMeta,
    persistSaveMeta,

    // Section reset
    resetSection,
  }
}
