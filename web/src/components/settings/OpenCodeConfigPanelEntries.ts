import { ref } from 'vue'
import type { ToastKind } from '@/stores/toasts'

type Kind = 'agent' | 'command'
type EntryValue = unknown
type JsonObject = Record<string, EntryValue>
type MapGetter = (kind: Kind) => JsonObject
type EnsureEntry = (kind: Kind, id: string) => JsonObject
type EnsureMap = (kind: Kind) => JsonObject
type IsPlainObject = (v: EntryValue) => v is JsonObject
type CommandEditorHandle = { insertText?: (text: string) => void } | null

export function useOpenCodeConfigPanelEntries(opts: {
  getMap: MapGetter
  ensureEntry: EnsureEntry
  ensureMap: EnsureMap
  isPlainObject: IsPlainObject
  markDirty: () => void
  refreshJsonBuffer: (id: string) => void
  copyText: (value: string, okMsg: string) => Promise<void>
  toasts: { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }
  setEntryField: (kind: Kind, id: string, field: string, value: EntryValue) => void
}) {
  const {
    getMap,
    ensureEntry,
    ensureMap,
    isPlainObject,
    markDirty,
    refreshJsonBuffer,
    copyText,
    toasts,
    setEntryField,
  } = opts

  // Editor refs used by command editor panels.
  const commandEditors = ref<Record<string, CommandEditorHandle>>({})

  function asEditorHandle(value: EntryValue): CommandEditorHandle {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { insertText?: EntryValue }
    if (candidate.insertText && typeof candidate.insertText !== 'function') return null
    return candidate as CommandEditorHandle
  }

  function asObject(value: EntryValue): JsonObject | null {
    return isPlainObject(value) ? value : null
  }

  function setCommandEditorRef(id: string, el: EntryValue) {
    commandEditors.value = { ...commandEditors.value, [id]: asEditorHandle(el) }
  }

  function insertCommandSnippet(id: string, text: string) {
    const editor = commandEditors.value[id]
    editor?.insertText?.(text)
  }

  function getCommandEntry(commandId: string): JsonObject {
    const m = getMap('command')
    const v = m[commandId]
    return isPlainObject(v) ? v : {}
  }

  function getAgentEntry(agentId: string, ensure = false): JsonObject {
    if (ensure) {
      return ensureEntry('agent', agentId)
    }
    const m = getMap('agent')
    const v = m[agentId]
    return isPlainObject(v) ? v : {}
  }

  async function copyEntryJson(kind: Kind, id: string) {
    const entry = kind === 'agent' ? getAgentEntry(id) : getCommandEntry(id)
    await copyText(JSON.stringify(entry, null, 2), `Copied ${kind} JSON`)
  }

  function importEntryJson(kind: Kind, id: string) {
    const raw = window.prompt(`Paste ${kind} JSON to import into '${id}'`, '')
    if (!raw) return
    let parsedRaw: EntryValue
    try {
      parsedRaw = JSON.parse(raw)
    } catch {
      toasts.push('error', 'Invalid JSON')
      return
    }

    let entry: JsonObject | null = null
    const parsed = asObject(parsedRaw)
    if (parsed) {
      // Allow wrapper format: { agent: { name: {...} } } or { command: { name: {...} } }
      const wrapperKey = kind
      const wrapper = parsed[wrapperKey]
      const wrapperObj = asObject(wrapper)
      if (wrapperObj) {
        const direct = asObject(wrapperObj[id])
        if (direct) {
          entry = direct
        } else {
          const keys = Object.keys(wrapperObj)
          const firstKey = keys[0]
          const first = firstKey ? asObject(wrapperObj[firstKey]) : null
          if (keys.length === 1 && firstKey && first) {
            entry = first
          }
        }
      } else {
        entry = parsed
      }
    }

    if (!isPlainObject(entry)) {
      toasts.push('error', `Expected a JSON object for ${kind} entry`)
      return
    }

    const map = ensureMap(kind)
    map[id] = entry
    markDirty()

    // Refresh JSON buffers that may be showing stale data.
    if (kind === 'agent') {
      refreshJsonBuffer(`agent:${id}:options`)
      refreshJsonBuffer(`agent:${id}:permission`)
    }
    toasts.push('success', `Imported ${kind} JSON into ${id}`)
  }

  function insertAgentPromptSnippet(agentId: string, snippet: string) {
    const agent = getAgentEntry(agentId)
    const base = String(agent?.prompt || '')
    const next = base ? (base.endsWith('\n') ? base + snippet : base + '\n' + snippet) : snippet
    setEntryField('agent', agentId, 'prompt', next)
  }

  return {
    commandEditors,
    setCommandEditorRef,
    insertCommandSnippet,
    getCommandEntry,
    getAgentEntry,
    copyEntryJson,
    importEntryJson,
    insertAgentPromptSnippet,
  }
}
