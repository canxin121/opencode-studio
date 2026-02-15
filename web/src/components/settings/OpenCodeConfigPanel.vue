<script setup lang="ts">
import { computed, reactive, ref, toRef, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import { opencodeSections } from './opencodeSections'

import {
  BUILTIN_LSP_IDS,
  FRONTMATTER_SKELETON,
  KEYBIND_GROUPS,
  MODALITIES,
  PROMPT_SKELETON,
  PROVIDER_OPTION_KEYS,
} from './opencode/constants'

import {
  cloneConfig,
  deletePath,
  getPath,
  isEmptyValue,
  isPlainObject,
  listToText,
  parseNumberInput,
  setPath,
  textToList,
} from './ConfigUtils'

import OpenCodeSectionGeneral from './opencode/sections/OpenCodeSectionGeneral.vue'
import OpenCodeSectionInstructions from './opencode/sections/OpenCodeSectionInstructions.vue'
import OpenCodeSectionProviders from './opencode/sections/OpenCodeSectionProviders.vue'
import OpenCodeSectionTui from './opencode/sections/OpenCodeSectionTui.vue'
import OpenCodeSectionServer from './opencode/sections/OpenCodeSectionServer.vue'
import OpenCodeSectionCommands from './opencode/sections/OpenCodeSectionCommands.vue'
import OpenCodeSectionAgents from './opencode/sections/OpenCodeSectionAgents.vue'
import OpenCodeSectionPermissions from './opencode/sections/OpenCodeSectionPermissions.vue'
import OpenCodeSectionMcp from './opencode/sections/OpenCodeSectionMcp.vue'
import OpenCodeSectionFormatter from './opencode/sections/OpenCodeSectionFormatter.vue'
import OpenCodeSectionKeybinds from './opencode/sections/OpenCodeSectionKeybinds.vue'
import OpenCodeSectionCompaction from './opencode/sections/OpenCodeSectionCompaction.vue'
import OpenCodeSectionExperimental from './opencode/sections/OpenCodeSectionExperimental.vue'
import OpenCodeSectionEnterprise from './opencode/sections/OpenCodeSectionEnterprise.vue'

import { provideOpencodeConfigPanelContext } from './opencode/opencodeConfigContext'

import { useOpencodeDraft } from './opencode/useOpencodeDraft'

import { apiJson } from '@/lib/api'
import { reloadOpenCodeConfig } from '@/lib/reload'
import { matchPattern } from '@/lib/opencodePermission'

import { useOpenCodeConfigPanelProviderHealth } from './OpenCodeConfigPanelProviderHealth'
import {
  addTagsToList,
  createStringListSetter,
  normalizeStringList,
  removeFromList,
} from './OpenCodeConfigPanelListUtils'
import { useOpenCodeConfigPanelProvidersDerived } from './OpenCodeConfigPanelProvidersDerived'
import { useOpenCodeConfigPanelProvidersLists } from './OpenCodeConfigPanelProvidersLists'
import { useOpenCodeConfigPanelToolOptions } from './OpenCodeConfigPanelToolOptions'
import { useOpenCodeConfigPanelPermissionsPreset } from './OpenCodeConfigPanelPermissionsPreset'
import { useOpenCodeConfigPanelPermissionPatterns } from './OpenCodeConfigPanelPermissionPatterns'
import { useOpenCodeConfigPanelAgentPermissionPatterns } from './OpenCodeConfigPanelAgentPermissionPatterns'
import { useOpenCodeConfigPanelOptionLists } from './OpenCodeConfigPanelOptionLists'
import { useOpenCodeConfigPanelProviderOptions } from './OpenCodeConfigPanelProviderOptions'
import { useOpenCodeConfigPanelEntries } from './OpenCodeConfigPanelEntries'
import { useOpenCodeConfigPanelProviderModels } from './OpenCodeConfigPanelProviderModels'
import { useOpenCodeConfigPanelMcpFormatterLsp } from './OpenCodeConfigPanelMcpFormatterLsp'
import { useOpenCodeConfigPanelDraftMaps } from './OpenCodeConfigPanelDraftMaps'
import { useOpenCodeConfigPanelFields } from './OpenCodeConfigPanelFields'
import { createOpenCodeConfigPanelValidation } from './OpenCodeConfigPanelValidation'
import { PERMISSION_QUICK_GROUPS } from './OpenCodeConfigPanelPermissionQuickGroups'
import { useOpenCodeConfigPanelPersistence } from './OpenCodeConfigPanelPersistence'
import type { RemoteModel } from './OpenCodeConfigPanelOptionTypes'
import type { JsonValue as JsonLike } from '@/types/json'

import { refDebounced } from '@vueuse/core'
import { RiArrowGoBackLine, RiRefreshLine, RiRestartLine, RiSave3Line } from '@remixicon/vue'

import { useDirectoryStore } from '@/stores/directory'
import { useOpencodeConfigStore, type OpencodeConfigScope } from '@/stores/opencodeConfig'
import { useToastsStore } from '@/stores/toasts'

const props = defineProps<{ activeSection?: string }>()

type JsonObject = Record<string, JsonLike>
type AgentRow = [string, JsonObject]

const configStore = useOpencodeConfigStore()
const directoryStore = useDirectoryStore()
const toasts = useToastsStore()

const scope = ref<OpencodeConfigScope>(configStore.scope || 'user')

const directory = computed(() => directoryStore.currentDirectory || '')
const activePath = computed(() => configStore.activePath || '')
const canWrite = computed(() => scope.value !== 'project' || Boolean(directory.value))

const {
  draft,
  dirty,
  localError,
  syncDraft,
  markDirty,
  setOrClear,
  jsonBuffers,
  ensureJsonBuffer,
  applyJsonBuffer,
  refreshJsonBuffer,
  applyAllJsonBuffers,
  validationIssues,
  addIssue,
  issuesForPathPrefix,
  issueText,
  parseServerErrorMessage,
  mapServerErrorToIssues,
  lastSaveOkAt,
  lastSaveError,
  lastSaveErrorAt,
  loadSaveMeta,
  persistSaveMeta,
  resetSection,
} = useOpencodeDraft({
  activePath,
  configData: toRef(configStore, 'data'),
  configError: toRef(configStore, 'error'),
  toasts,
  onInvalidate: invalidateDraftDiff,
})

const setStringList = createStringListSetter(setOrClear)

const newCommandName = ref('')
const newCommandTemplate = ref('')
const newAgentName = ref('')
const selectedAgentId = ref<string | null>(null)
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const newProviderId = ref('')
const agentEditorTab = ref<'basics' | 'prompt' | 'permissions' | 'json'>('basics')

const commandFilter = ref('')
const agentFilter = ref('')
const commandFilterDebounced = refDebounced(commandFilter, 150)
const agentFilterDebounced = refDebounced(agentFilter, 150)

const modalities = MODALITIES

const activeSectionId = computed(() => {
  const raw = (props.activeSection || '').trim()
  const valid = opencodeSections.find((s) => s.id === raw)
  return valid ? valid.id : opencodeSections[0]!.id
})

function isSectionVisible(id: string): boolean {
  return id === activeSectionId.value
}

// Section-collapse controls are intentionally disabled in this panel.
function isSectionOpen(_id: string): boolean {
  return true
}

function toggleSection(_id: string) {
  // Sections are intentionally always expanded in settings UI.
}

// Diff preview removed for simplicity.

// No-op diff invalidation placeholder (diff UI removed).
function invalidateDraftDiff() {}

watch(
  () => dirty.value,
  () => invalidateDraftDiff(),
)

// Effective preview removed.

const providerOptionKeys = PROVIDER_OPTION_KEYS

const keybindGroups = KEYBIND_GROUPS

const { getMap, ensureMap, ensureEntry, setEntryField, removeEntry } = useOpenCodeConfigPanelDraftMaps({
  draft,
  getPath,
  setPath,
  deletePath,
  isPlainObject,
  isEmptyValue,
  markDirty,
})

const fields = useOpenCodeConfigPanelFields({
  draft,
  getPath,
  setPath,
  deletePath,
  setOrClear,
  normalizeStringList,
  setStringList,
  isPlainObject,
  ensureMap,
  markDirty,
})

const actionDisabled = computed(() => !dirty.value || !canWrite.value)
const resetDisabled = computed(() => !dirty.value)

const commandsList = computed(() => Object.entries(getMap('command')).sort(([a], [b]) => a.localeCompare(b)))
const agentsList = computed(() => Object.entries(getMap('agent')).sort(([a], [b]) => a.localeCompare(b)))
const providersList = computed(() => Object.entries(getMap('provider')).sort(([a], [b]) => a.localeCompare(b)))
const filteredProvidersList = computed(() => {
  const q = providerFilterDebounced.value.trim().toLowerCase()
  if (!q) return providersList.value
  return providersList.value.filter(([id]) => id.toLowerCase().includes(q))
})
const mcpFormatterLsp = useOpenCodeConfigPanelMcpFormatterLsp({ getMap, ensureEntry, markDirty })

const filteredCommandsList = computed(() => {
  const q = commandFilterDebounced.value.trim().toLowerCase()
  if (!q) return commandsList.value
  return commandsList.value.filter(([id, cmd]) => {
    const hay = `${id} ${JSON.stringify(cmd || {})}`.toLowerCase()
    return hay.includes(q)
  })
})

const filteredAgentsList = computed(() => {
  const q = agentFilterDebounced.value.trim().toLowerCase()
  if (!q) return agentsList.value
  return agentsList.value.filter(([id, agent]) => {
    const hay = `${id} ${JSON.stringify(agent || {})}`.toLowerCase()
    return hay.includes(q)
  })
})

const selectedAgentRows = computed(() => {
  const id = selectedAgentId.value
  if (!id) return [] as AgentRow[]
  return [[id, getAgentEntry(id)] as AgentRow]
})

watch(selectedAgentId, () => {
  agentEditorTab.value = 'basics'
})

watch(
  agentsList,
  (list) => {
    const id = selectedAgentId.value
    if (!id) return
    if (!list.some(([aid]) => aid === id)) {
      selectedAgentId.value = null
    }
  },
  { immediate: true },
)

function addCommand() {
  const name = newCommandName.value.trim()
  const template = newCommandTemplate.value.trim()
  if (!name) return
  if (!template) {
    toasts.push('error', 'Command template is required')
    return
  }
  const entry = ensureEntry('command', name)
  entry.template = template
  dirty.value = true
  newCommandName.value = ''
  newCommandTemplate.value = ''
}

function addAgent() {
  let name = newAgentName.value.trim()
  if (name.startsWith('@')) name = name.slice(1).trim()
  if (!name) return
  ensureEntry('agent', name)
  dirty.value = true
  newAgentName.value = ''
  selectedAgentId.value = name
}

function addProvider() {
  const id = newProviderId.value.trim()
  if (!id) return
  ensureEntry('provider', id)
  dirty.value = true
  selectedProviderId.value = id
  providerListOpen.value[id] = true
  newProviderId.value = ''
}

function providerEntry(id: string, ensure = true): JsonObject {
  if (ensure) {
    return ensureEntry('provider', id)
  }
  const existing = getMap('provider')[id]
  return isPlainObject(existing) ? existing : {}
}

const providerOptions = useOpenCodeConfigPanelProviderOptions({
  providerEntry,
  providerOptionKeys,
  isPlainObject,
  isEmptyValue,
  parseNumberInput,
  markDirty,
})

const providerModelsEditor = useOpenCodeConfigPanelProviderModels({
  providerEntry,
  selectedProviderId,
  selectedModelId,
  isPlainObject,
  isEmptyValue,
  parseNumberInput,
  markDirty,
})

// Provider model/variant editing helpers extracted to './OpenCodeConfigPanelProviderModels'.

function isProviderOpen(providerId: string): boolean {
  const state = providerListOpen.value[providerId]
  if (typeof state === 'boolean') return state
  return selectedProviderId.value === providerId
}

function toggleProviderOpen(providerId: string) {
  providerListOpen.value[providerId] = !isProviderOpen(providerId)
}

function selectProvider(providerId: string) {
  selectedProviderId.value = providerId
  selectedModelId.value = null
  providerListOpen.value[providerId] = true
}

function selectProviderModel(providerId: string, modelId: string) {
  selectedProviderId.value = providerId
  selectedModelId.value = modelId
  providerListOpen.value[providerId] = true
}

function removeProvider(providerId: string) {
  removeEntry('provider', providerId)
  if (selectedProviderId.value === providerId) {
    selectedProviderId.value = null
    selectedModelId.value = null
  }
  if (providerListOpen.value[providerId] != null) {
    delete providerListOpen.value[providerId]
  }
}

// Provider option/map/timeout helpers extracted to './OpenCodeConfigPanelProviderOptions'.

// MCP/LSP helpers extracted to './OpenCodeConfigPanelMcpFormatterLsp'.

// Permission preset/bulk/test helpers extracted to './OpenCodeConfigPanelPermissionsPreset'.

const optionLists = useOpenCodeConfigPanelOptionLists({
  draft,
  providersList,
  defaultAgent: fields.defaultAgent,
  model: fields.model,
  smallModel: fields.smallModel,
  apiJson,
  dirQuery,
  toasts,
})

function modelFormatWarning(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (!v.includes('/')) return 'Expected format: provider/model'
  const parts = v.split('/').filter(Boolean)
  if (parts.length < 2) return 'Expected format: provider/model'
  return ''
}

const providerHealth = useOpenCodeConfigPanelProviderHealth({
  apiJson,
  dirQuery,
  providersList,
  providersRemote: optionLists.providersRemote,
  draft,
  getPath,
  normalizeStringList,
  getProviderOption: providerOptions.getProviderOption,
  toasts,
})

const refreshProviderHealth = providerHealth.refreshProviderHealth

async function refreshOptionLists(opts: { toast?: boolean } = {}) {
  await optionLists.refreshOptionLists(opts)
  // Update provider env presence + sources after refreshing providers.
  void refreshProviderHealth()
}

async function copyText(value: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(value)
    toasts.push('success', okMsg)
  } catch {
    toasts.push('error', 'Failed to copy to clipboard')
  }
}

const providerConflictPolicy = ref<'last-change-wins' | 'enabled-wins' | 'disabled-wins' | 'keep-conflict'>(
  'last-change-wins',
)

const bulkProviderSelection = ref<string[]>([])
const bulkProviderInput = ref('')

// agent permission editor state is provided by useOpenCodeConfigPanelAgentPermissionPatterns.

const providerFilter = ref('')
const providerFilterDebounced = refDebounced(providerFilter, 150)
const providerListOpen = ref<Record<string, boolean>>({})
const showProviderBrowse = ref(false)
const showAdvancedProviderLists = ref(false)
const enabledProviderInput = ref('')
const disabledProviderInput = ref('')

const toolFilter = ref('')
const toolFilterDebounced = refDebounced(toolFilter, 150)

const newPermissionTool = ref('')
const newPermissionAction = ref<'allow' | 'ask' | 'deny' | 'default'>('ask')

const permissionPreset = ref<'safe' | 'power' | 'readonly' | ''>('')
const permissionPresetMode = ref<'merge' | 'replace'>('merge')

const permissionBulkAction = ref<'allow' | 'ask' | 'deny'>('ask')
const permissionBulkTarget = ref<'selection' | 'tag' | 'all_known' | 'all_via_star'>('selection')
const permissionBulkTag = ref<'filesystem' | 'exec' | 'network' | 'other'>('filesystem')
const permissionBulkSelection = ref<string[]>([])
const permissionBulkInput = ref('')
const permissionBulkClearOthers = ref(false)

const permissionTestTool = ref('*')
const permissionTestInput = ref('')

const jsoncWarnEnabled = ref(true)
const isJsoncActivePath = computed(() => (activePath.value || '').toLowerCase().endsWith('.jsonc'))
const JSONC_WARN_KEY = 'opencode-studio.opencode.warnJsoncRewrite'

// Pattern editor types/state live in dedicated helper modules.

const permissionQuickGroups = PERMISSION_QUICK_GROUPS

const providersDerived = useOpenCodeConfigPanelProvidersDerived({
  draft,
  getPath,
  setStringList,
  providersRemote: optionLists.providersRemote,
  providersList,
  providerFilterDebounced,
  selectedProviderId,
  selectedModelId,
  providerListOpen,
  providerModels: providerModelsEditor.providerModels,
  providerModelIds: providerModelsEditor.providerModelIds,
  isPlainObject,
})

const runClientValidation = createOpenCodeConfigPanelValidation({
  draft,
  getPath,
  getMap,
  isPlainObject,
  addIssue,
  modelWarning: optionLists.modelWarning,
  smallModelWarning: optionLists.smallModelWarning,
  defaultAgentWarning: optionLists.defaultAgentWarning,
  providerListConflict: providersDerived.providerListConflict,
  BUILTIN_LSP_IDS,
  modelFormatWarning,
})

const toolOptions = useOpenCodeConfigPanelToolOptions({
  draft,
  getPath,
  setStringList,
  toolIdsRemote: optionLists.toolIdsRemote,
  toolFilterDebounced,
})

const providersLists = useOpenCodeConfigPanelProvidersLists({
  providerConflictPolicy,
  enabledProvidersArr: providersDerived.enabledProvidersArr,
  disabledProvidersArr: providersDerived.disabledProvidersArr,
  enabledProviderInput,
  disabledProviderInput,
  bulkProviderSelection,
  bulkProviderInput,
  providerIdOptions: providersDerived.providerIdOptions,
})

const {
  ensurePermissionMap,
  setPermissionRule,
  toolIdsByTag,
  applyPermissionPreset,
  addPermissionBulkSelectionTags,
  selectPermissionBulkByTag,
  applyPermissionBulk,
  permissionTestToolOptions,
  permissionTestResult,
} = useOpenCodeConfigPanelPermissionsPreset({
  draft,
  getPath,
  setPath,
  deletePath,
  isPlainObject,
  refreshJsonBuffer,
  matchPattern,
  toolIdOptions: toolOptions.toolIdOptions,
  permissionPreset,
  permissionPresetMode,
  permissionBulkAction,
  permissionBulkTarget,
  permissionBulkTag,
  permissionBulkSelection,
  permissionBulkInput,
  permissionBulkClearOthers,
  permissionTestTool,
  permissionTestInput,
  toasts,
  cloneConfig,
  markDirty,
})

const permissionPatterns = useOpenCodeConfigPanelPermissionPatterns({
  draft,
  isPlainObject,
  ensurePermissionMap,
  setPermissionRule,
  setPath,
  deletePath,
  refreshJsonBuffer,
  markDirty,
})

const permissionKnownKeys = [
  '*',
  'read',
  'edit',
  'glob',
  'grep',
  'list',
  'bash',
  'task',
  'skill',
  'external_directory',
  'lsp',
  'question',
  'webfetch',
  'websearch',
  'codesearch',
  'todowrite',
  'todoread',
  'doom_loop',
]

const customPermissionKeys = computed(() => {
  const map = ensurePermissionMap()
  const out: string[] = []
  for (const key of Object.keys(map)) {
    if (permissionKnownKeys.includes(key)) continue
    out.push(key)
  }
  return out.sort((a, b) => a.localeCompare(b))
})

function addCustomPermissionRule() {
  const tool = newPermissionTool.value.trim()
  if (!tool) return
  setPermissionRule(tool, newPermissionAction.value)
  newPermissionTool.value = ''
}

function isKnownProviderId(id: string): boolean {
  const v = String(id || '').trim()
  if (!v) return false
  return providersDerived.providerIdOptions.value.includes(v)
}

// Provider list helpers extracted to './OpenCodeConfigPanelProvidersDerived' and './OpenCodeConfigPanelProvidersLists'.

function addInstructionsTags(raw: string) {
  const next = addTagsToList(fields.instructionsArr.value, raw)
  if (next.length === fields.instructionsArr.value.length) return
  fields.instructionsArr.value = next
  fields.instructionsInput.value = ''
}

function addSkillsPathsTags(raw: string) {
  const next = addTagsToList(fields.skillsPathsArr.value, raw)
  if (next.length === fields.skillsPathsArr.value.length) return
  fields.skillsPathsArr.value = next
  fields.skillsPathsInput.value = ''
}

function addPluginsTags(raw: string) {
  const next = addTagsToList(fields.pluginsArr.value, raw)
  if (next.length === fields.pluginsArr.value.length) return
  fields.pluginsArr.value = next
  fields.pluginsInput.value = ''
}

function addServerCorsTags(raw: string) {
  const next = addTagsToList(fields.serverCorsArr.value, raw)
  if (next.length === fields.serverCorsArr.value.length) return
  fields.serverCorsArr.value = next
  fields.serverCorsInput.value = ''
}

function addWatcherIgnoreTags(raw: string) {
  const next = addTagsToList(fields.watcherIgnoreArr.value, raw)
  if (next.length === fields.watcherIgnoreArr.value.length) return
  fields.watcherIgnoreArr.value = next
  fields.watcherIgnoreInput.value = ''
}

// isProviderSelectable provided by OpenCodeConfigPanelProvidersLists.

// providerRemoteInfo/providerRequiredEnv/providerEnvMissing are provided by OpenCodeConfigPanelProviderHealth.

// Provider env/health utilities extracted to './OpenCodeConfigPanelProviderHealth'.

// Bulk provider list helpers provided by OpenCodeConfigPanelProvidersLists.

const entries = useOpenCodeConfigPanelEntries({
  getMap,
  ensureEntry,
  ensureMap,
  isPlainObject,
  markDirty,
  refreshJsonBuffer,
  copyText,
  toasts,
  setEntryField,
})

const {
  getAgentEntry,
  copyEntryJson,
  importEntryJson,
  setCommandEditorRef,
  insertCommandSnippet,
  insertAgentPromptSnippet,
} = entries

const entriesCtx = {
  copyEntryJson,
  importEntryJson,
  setCommandEditorRef,
  insertCommandSnippet,
  insertAgentPromptSnippet,
}

function commandAgentOptions(): string[] {
  return optionLists.agentOptions.value.map((a) => a.name)
}

function commandModelMeta(slug: string | undefined): RemoteModel | undefined {
  const s = String(slug || '').trim()
  if (!s) return undefined
  return optionLists.modelMetaBySlug.value.get(s)
}

function agentPermissionMap(agentId: string, ensure = false): JsonObject {
  const entry = getAgentEntry(agentId, ensure)
  const perm = entry.permission
  if (isPlainObject(perm)) return perm as JsonObject
  if (ensure) {
    entry.permission = {}
    dirty.value = true
    return entry.permission as JsonObject
  }
  return {}
}

function setAgentPermissionMap(agentId: string, next: JsonObject) {
  setEntryField('agent', agentId, 'permission', next)
  refreshJsonBuffer(`agent:${agentId}:permission`)
}

const agentPermissionPatterns = useOpenCodeConfigPanelAgentPermissionPatterns({
  isPlainObject,
  agentPermissionMap,
  setAgentPermissionMap,
})

// Agent permission pattern editor logic extracted to './OpenCodeConfigPanelAgentPermissionPatterns'.

// Permission pattern editor logic extracted to './OpenCodeConfigPanelPermissionPatterns'.

// vue-tsc build mode can mis-detect template usage for some bindings.
// These `void` references keep noUnusedLocals from failing the build.
void toolOptions.filteredToolIdOptions
void customPermissionKeys
void addCustomPermissionRule
void jsoncWarnEnabled
void isJsoncActivePath
void permissionPatterns.permissionPatternCount
void filteredCommandsList
void filteredAgentsList
void providersLists.isProviderSelectable
void providerHealth.providerEnvMissing
void providerHealth.toggleProviderApiKey
void providerHealth.copyProviderApiKey
void providersLists.applyBulkEnableOnly
void providersLists.applyBulkDisableAllExcept
void providersLists.addBulkProviderTags

function dirQuery(): string {
  const dir = directory.value.trim()
  return dir ? `?directory=${encodeURIComponent(dir)}` : ''
}

// Remote option lists, model metadata, and warnings extracted to './OpenCodeConfigPanelOptionLists'.

const { refresh, reloadOpenCode, save, resetDraft, reloading, requiresJsoncRewriteConfirm } =
  useOpenCodeConfigPanelPersistence({
    configStore,
    scope,
    directory,
    activePath,
    draft,
    syncDraft,
    refreshOptionLists: () => (optionLists.optionsLoaded.value ? refreshOptionLists() : Promise.resolve()),
    runClientValidation,
    validationIssues,
    applyAllJsonBuffers,
    providerListConflict: providersDerived.providerListConflict,
    isJsoncActivePath,
    jsoncWarnEnabled,
    JSONC_WARN_KEY,
    loadSaveMeta,
    persistSaveMeta,
    lastSaveOkAt,
    lastSaveError,
    lastSaveErrorAt,
    parseServerErrorMessage,
    mapServerErrorToIssues,
    toasts,
    reloadOpenCodeConfig,
  })

// Provide a shared context so section templates can be split into smaller SFCs
// without prop drilling.
const panelContext = reactive({
    // Section UI
    isSectionOpen,
    toggleSection,

    // Field bindings (general/tui/server/compaction/experimental toggles)
    ...fields,

    // Option list-derived warnings/formatters
    ...optionLists,
    issueText,
    resetSection,

    // Instructions helpers
    addInstructionsTags,
    addSkillsPathsTags,
    addPluginsTags,

    // Server & Watcher helpers
    addServerCorsTags,
    addWatcherIgnoreTags,

    // Providers
    providerFilter,
    showProviderBrowse,
    showAdvancedProviderLists,
    providerConflictPolicy,
    providersList,
    filteredProvidersList,
    enabledProviderInput,
    disabledProviderInput,
    bulkProviderSelection,
    bulkProviderInput,
    removeFromList,
    removeProvider,
    addProvider,
    newProviderId,
    toggleProviderOpen,
    selectProvider,
    selectProviderModel,
    selectedProviderId,
    selectedModelId,
    isKnownProviderId,
    isProviderOpen,
    ...providersDerived,
    ...providersLists,
    ...providerModelsEditor,
    ...providerOptions,
    ...providerHealth,
    ensureJsonBuffer,
    applyJsonBuffer,
    listToText,
    textToList,
    setEntryField,
    modalities,
    refreshOptionLists,

    // Shared draft helpers
    scope,
    draft,
    jsonBuffers,
    getPath,
    setOrClear,
    removeEntry,
    parseNumberInput,
    markDirty,
    issuesForPathPrefix,

    // Commands
    commandFilter,
    filteredCommandsList,
    newCommandName,
    newCommandTemplate,
    addCommand,
    ...entriesCtx,

    // Agents
    agentFilter,
    filteredAgentsList,
    newAgentName,
    selectedAgentId,
    selectedAgentRows,
    agentEditorTab,
    addAgent,
    PROMPT_SKELETON,
    FRONTMATTER_SKELETON,
    commandModelMeta,
    ...agentPermissionPatterns,

    // Permissions
    permissionQuickGroups,
    customPermissionKeys,
    newPermissionTool,
    newPermissionAction,
    addCustomPermissionRule,
    permissionPreset,
    permissionPresetMode,
    applyPermissionPreset,
    permissionBulkTarget,
    permissionBulkAction,
    permissionBulkClearOthers,
    permissionBulkTag,
    permissionBulkSelection,
    permissionBulkInput,
    addPermissionBulkSelectionTags,
    selectPermissionBulkByTag,
    applyPermissionBulk,
    permissionTestToolOptions,
    permissionTestTool,
    permissionTestInput,
    permissionTestResult,
    toolFilter,
    toolIdsByTag,
    ...toolOptions,
    ...permissionPatterns,
    setPermissionRule,

    // MCP/Formatter/LSP
    ...mcpFormatterLsp,

    // Keybinds
    keybindGroups,

    // Experimental
})

provideOpencodeConfigPanelContext(panelContext)

export type OpenCodeConfigPanelProvidedContext = typeof panelContext
</script>

<template>
  <div class="oc-config space-y-6">
    <div class="sticky top-2 z-20 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <select
            v-model="scope"
            class="h-9 rounded-lg border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="user">User config</option>
            <option value="project">Project config</option>
            <option value="custom">Custom (OPENCODE_CONFIG)</option>
          </select>
          <Button variant="ghost" size="sm" @click="refresh" :disabled="configStore.loading" title="Refresh">
            <RiRefreshLine class="h-4 w-4" />
          </Button>
        </div>

        <div class="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" @click="resetDraft" :disabled="resetDisabled" title="Reset">
            <RiArrowGoBackLine class="h-4 w-4" />
          </Button>

          <ConfirmPopover
            title="Reload OpenCode now?"
            description="Apply the updated config to the running OpenCode process."
            confirm-text="Reload"
            cancel-text="Cancel"
            @confirm="reloadOpenCode"
          >
            <Button variant="outline" size="sm" :disabled="reloading" title="Reload OpenCode">
              <RiRestartLine class="h-4 w-4" />
            </Button>
          </ConfirmPopover>

          <ConfirmPopover
            v-if="requiresJsoncRewriteConfirm()"
            title="Rewrite .jsonc as JSON?"
            description="Saving from this UI rewrites .jsonc as JSON and removes comments/trailing commas."
            confirm-text="Save"
            cancel-text="Cancel"
            @confirm="() => void save({ allowJsoncRewrite: true })"
          >
            <Button size="sm" :disabled="actionDisabled" title="Save">
              <RiSave3Line class="h-4 w-4" />
            </Button>
          </ConfirmPopover>
          <Button v-else size="sm" @click="save" :disabled="actionDisabled" title="Save">
            <RiSave3Line class="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div v-if="scope === 'project' && !directory" class="pt-2 text-xs text-amber-600">
        Project scope requires an active directory.
      </div>
    </div>

    <!-- Shared suggestion lists (available even if sections are collapsed) -->
    <datalist id="opencode-model-slug-options">
      <option v-for="slug in optionLists.modelSlugOptions" :key="`model-opt:${slug}`" :value="slug" />
    </datalist>
    <datalist id="opencode-agent-name-options">
      <option v-for="name in commandAgentOptions()" :key="`agent-opt:${name}`" :value="name" />
    </datalist>
    <datalist id="opencode-tool-id-options">
      <option v-for="id in toolOptions.toolIdOptions" :key="`tool-opt:${id}`" :value="id" />
    </datalist>

    <div
      v-if="validationIssues.length"
      class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-semibold">Validation</div>
        <Button size="sm" variant="ghost" @click="validationIssues = []">Clear</Button>
      </div>
      <div class="mt-1 text-xs">
        {{ validationIssues.filter((i) => i.severity === 'error').length }} errors,
        {{ validationIssues.filter((i) => i.severity === 'warning').length }} warnings
      </div>
      <div class="mt-2 grid gap-1 text-xs">
        <div v-for="(i, idx) in validationIssues.slice(0, 10)" :key="`issue:${idx}`" class="break-all">
          <span class="font-mono">{{ i.path }}</span
          >: {{ i.message }}
        </div>
        <div v-if="validationIssues.length > 10" class="text-xs text-muted-foreground">
          … ({{ validationIssues.length - 10 }} more)
        </div>
      </div>
    </div>

    <div v-if="localError" class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
      {{ localError }}
    </div>

    <div class="space-y-6 min-w-0">
      <OpenCodeSectionGeneral v-if="isSectionVisible('general')" />

      <OpenCodeSectionInstructions v-if="isSectionVisible('instructions')" />

      <OpenCodeSectionProviders v-if="isSectionVisible('providers')" />

      <OpenCodeSectionTui v-if="isSectionVisible('tui')" />

      <OpenCodeSectionServer v-if="isSectionVisible('server')" />

      <OpenCodeSectionCommands v-if="isSectionVisible('commands')" />

      <OpenCodeSectionAgents v-if="isSectionVisible('agents')" />

      <OpenCodeSectionPermissions v-if="isSectionVisible('permissions')" />

      <OpenCodeSectionMcp v-if="isSectionVisible('mcp')" />

      <OpenCodeSectionFormatter v-if="isSectionVisible('formatter')" />

      <OpenCodeSectionKeybinds v-if="isSectionVisible('keybinds')" />

      <OpenCodeSectionCompaction v-if="isSectionVisible('compaction')" />

      <OpenCodeSectionExperimental v-if="isSectionVisible('experimental')" />

      <OpenCodeSectionEnterprise v-if="isSectionVisible('enterprise')" />
    </div>
  </div>
</template>

<style scoped>
.oc-config :deep(section[id]) {
  border: 1px solid oklch(var(--border) / 0.55);
  border-radius: calc(var(--radius) + 2px);
  background: oklch(var(--background));
}

.oc-config :deep(.sticky.top-2) {
  border: 1px solid oklch(var(--border) / 0.55);
  border-radius: calc(var(--radius) + 2px);
  background: oklch(var(--background) / 0.96);
}

.oc-config :deep(.rounded-md.border.border-border.p-3) {
  border: 0;
  border-left: 1px solid oklch(var(--border) / 0.32);
  border-radius: 0;
  background: transparent;
  padding-left: 0.75rem;
}

.oc-config :deep(.rounded-md.border.border-border.p-3 .rounded-md.border.border-border.p-3) {
  border-left-color: oklch(var(--border) / 0.2);
  background: transparent;
}

/* Hide per-section top action button groups (reset/collapse/etc.). */
.oc-config :deep(section[id] > div:first-child > div:last-child) {
  display: none;
}

.oc-config :deep(input[type='checkbox']),
.oc-config :deep(input[type='radio']) {
  accent-color: oklch(var(--muted-foreground));
}

/* Ensure even plain <button> elements get a pressed-state cue. */
.oc-config button {
  transition: transform 80ms ease;
}

.oc-config button:active:not([disabled]) {
  transform: scale(0.98);
}
</style>
