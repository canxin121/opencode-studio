import { computed, ref } from 'vue'

type EntryValue = unknown
type ConfigEntry = Record<string, EntryValue>
type EnsureEntry = (mapPath: string, key: string) => ConfigEntry
type GetMap = (path: string) => ConfigEntry

function readType(entry: EntryValue): string {
  if (!entry || typeof entry !== 'object') return ''
  const type = (entry as ConfigEntry).type
  return typeof type === 'string' ? type : ''
}

export function useOpenCodeConfigPanelMcpFormatterLsp(opts: {
  getMap: GetMap
  ensureEntry: EnsureEntry
  markDirty: () => void
}) {
  const { getMap, ensureEntry, markDirty } = opts

  const newMcpName = ref('')
  const newFormatterId = ref('')
  const newLspId = ref('')

  const mcpList = computed(() => Object.entries(getMap('mcp')).sort(([a], [b]) => a.localeCompare(b)))
  const formatterList = computed(() => Object.entries(getMap('formatter')).sort(([a], [b]) => a.localeCompare(b)))
  const lspList = computed(() => Object.entries(getMap('lsp')).sort(([a], [b]) => a.localeCompare(b)))

  function addMcp() {
    const name = newMcpName.value.trim()
    if (!name) return
    const entry = ensureEntry('mcp', name)
    entry.enabled = true
    markDirty()
    newMcpName.value = ''
  }

  function addFormatter() {
    const id = newFormatterId.value.trim()
    if (!id) return
    ensureEntry('formatter', id)
    markDirty()
    newFormatterId.value = ''
  }

  function addLsp() {
    const id = newLspId.value.trim()
    if (!id) return
    const entry = ensureEntry('lsp', id)
    entry.command = []
    markDirty()
    newLspId.value = ''
  }

  function mcpType(entry: EntryValue): 'local' | 'remote' | 'toggle' {
    const type = readType(entry)
    if (type === 'local') return 'local'
    if (type === 'remote') return 'remote'
    return 'toggle'
  }

  function setMcpType(name: string, type: string) {
    const entry = ensureEntry('mcp', name)
    if (type === 'local') {
      entry.type = 'local'
      entry.command = entry.command || []
      delete entry.url
      delete entry.headers
      delete entry.oauth
    } else if (type === 'remote') {
      entry.type = 'remote'
      entry.url = entry.url || ''
      delete entry.command
      delete entry.environment
    } else {
      delete entry.type
      delete entry.command
      delete entry.url
      delete entry.environment
      delete entry.headers
      delete entry.oauth
      delete entry.timeout
    }
    markDirty()
  }

  function lspMode(entry: EntryValue): 'disabled' | 'config' {
    if (!entry || typeof entry !== 'object') return 'config'
    const rec = entry as ConfigEntry
    if (rec.disabled === true && !rec.command) return 'disabled'
    return 'config'
  }

  function setLspMode(name: string, mode: string) {
    const entry = ensureEntry('lsp', name)
    if (mode === 'disabled') {
      delete entry.command
      delete entry.extensions
      delete entry.env
      delete entry.initialization
      entry.disabled = true
    } else {
      if (entry.disabled === true && !entry.command) delete entry.disabled
      if (!Array.isArray(entry.command)) entry.command = []
    }
    markDirty()
  }

  return {
    newMcpName,
    newFormatterId,
    newLspId,
    mcpList,
    formatterList,
    lspList,
    addMcp,
    addFormatter,
    addLsp,
    mcpType,
    setMcpType,
    lspMode,
    setLspMode,
  }
}
