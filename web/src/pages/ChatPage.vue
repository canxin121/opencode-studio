<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RiFileLine, RiFileTextLine, RiFileUploadLine, RiScissorsLine, RiSearchLine } from '@remixicon/vue'

import ChatPageView from './chat/ChatPageView.vue'
import type { ChatPageViewContext } from './chat/chatPageViewContext'

import { copyTextToClipboard } from '@/lib/clipboard'
import { readSessionIdFromFullPath, readSessionIdFromQuery } from '@/app/navigation/sessionQuery'
import { useChatStore } from '@/stores/chat'
import { useDirectoryStore } from '@/stores/directory'
import { useOpencodeConfigStore } from '@/stores/opencodeConfig'
import { useSessionActivityStore } from '@/stores/sessionActivity'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useToastsStore } from '@/stores/toasts'

import { useMessageStreaming } from '@/composables/chat/useMessageStreaming'
import { useChatAttachments } from './chat/useChatAttachments'
import { useChatScrollNav } from './chat/useChatScrollNav'
import { useChatComposerLayout } from './chat/useChatComposerLayout'
import { useChatModelSelection } from './chat/useChatModelSelection'
import { useChatCommands } from './chat/useChatCommands'
import { useChatSessionActions } from './chat/useChatSessionActions'
import { useChatRunUi } from './chat/useChatRunUi'
import { useChatRenderBlocks } from './chat/useChatRenderBlocks'
import { useChatMessageActions } from './chat/useChatMessageActions'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import type { MessageEntry } from '@/types/chat'
import type { JsonObject, JsonValue } from '@/types/json'
import {
  DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS,
  isKnownChatToolActivityType,
  normalizeChatActivityDefaultExpanded,
  normalizeChatToolActivityFilters,
  type ChatActivityExpandKey,
} from '@/lib/chatActivity'

type ComposerActionItem = { id: string; label: string; description?: string; icon?: Component; disabled?: boolean }

type ComposerExpose = {
  shellEl?: HTMLDivElement | { value: HTMLDivElement | null } | null
  textareaEl?: HTMLTextAreaElement | { value: HTMLTextAreaElement | null } | null
  openFilePicker?: () => void
}

type OptionMenuExpose = {
  containsTarget?: (target: Node | null) => boolean
  focusSearch?: () => void
}

type OutgoingMessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; filename: string; url: string }
  | { type: 'file'; mime: string; filename: string; serverPath: string }

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const directoryStore = useDirectoryStore()
const opencodeConfig = useOpencodeConfigStore()
const activity = useSessionActivityStore()
const settings = useSettingsStore()
const ui = useUiStore()
const toasts = useToastsStore()

const orphanDraft = ref('')
const draft = computed<string>({
  get() {
    const sid = chat.selectedSessionId
    if (!sid) return orphanDraft.value
    return chat.getComposerDraft(sid)
  },
  set(value) {
    const sid = chat.selectedSessionId
    if (!sid) {
      orphanDraft.value = value
      return
    }
    chat.setComposerDraft(sid, value)
  },
})
const sending = ref(false)

const composerRef = ref<ComposerExpose | null>(null)
const attachments = useChatAttachments({ toasts, composerRef })
const {
  attachedFiles,
  attachProjectDialogOpen,
  attachProjectPath,
  formatBytes,
  handleDrop,
  handlePaste,
  handleFileInputChange,
  removeAttachment,
  clearAttachments,
  openFilePicker,
  openProjectAttachDialog,
  addProjectAttachment,
} = attachments

const editorFullscreen = ref(false)
const editorClosing = ref(false)

const sessionActionsMenuRef = ref<OptionMenuExpose | null>(null)

const composerActionMenuOpen = ref(false)
const composerActionMenuQuery = ref('')
const composerActionMenuAnchorRef = ref<HTMLElement | null>(null)

const composerActionItems = computed<ComposerActionItem[]>(() => [
  {
    id: 'compact',
    label: 'Compact session',
    description: 'Summarize with the selected model',
    icon: RiScissorsLine,
    disabled: !chat.selectedSessionId || compactBusy.value,
  },
  {
    id: 'init',
    label: 'Initialize AGENTS.md',
    description: 'Insert /init command into chat input',
    icon: RiFileTextLine,
  },
  {
    id: 'review',
    label: 'Review changes',
    description: 'Insert /review command into chat input',
    icon: RiSearchLine,
  },
  {
    id: 'attach-local',
    label: 'Attach from computer',
    description: 'Upload local files',
    icon: RiFileUploadLine,
  },
  {
    id: 'attach-project',
    label: 'Attach from project',
    description: 'Select a file from this repo',
    icon: RiFileLine,
  },
])

const filteredComposerActionItems = computed<ComposerActionItem[]>(() => {
  const q = composerActionMenuQuery.value.trim().toLowerCase()
  const list = composerActionItems.value
  if (!q) return list
  return list.filter((item) => {
    const label = item.label.toLowerCase()
    const desc = String(item.description || '').toLowerCase()
    return label.includes(q) || desc.includes(q) || item.id.includes(q)
  })
})

const composerActionMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'composer-actions',
    items: filteredComposerActionItems.value as OptionMenuItem[],
  },
])

const sessionDirectory = computed(() => chat.selectedSessionDirectory || directoryStore.currentDirectory || '')
const composerFullscreenActive = computed(() => editorFullscreen.value || editorClosing.value)
const sessionTitle = computed(() => {
  const s = asRecord(chat.selectedSession)
  const title = typeof s?.title === 'string' ? s.title.trim() : ''
  const slug = typeof s?.slug === 'string' ? s.slug.trim() : ''
  const id = typeof s?.id === 'string' ? s.id.trim() : ''
  return title || slug || id
})
const sessionShareUrl = computed(() => {
  const s = asRecord(chat.selectedSession)
  const share = getRecord(s, 'share')
  const url = typeof share.url === 'string' ? share.url.trim() : ''
  return url
})

const composerControlsRef = ref<HTMLDivElement | null>(null)
const composerPickerRef = ref<OptionMenuExpose | null>(null)
const composerPickerOpen = ref<null | 'agent' | 'model' | 'variant'>(null)
const modelPickerQuery = ref('')
const agentPickerQuery = ref('')
const variantPickerQuery = ref('')

const pageRef = ref<HTMLElement | null>(null)
const composerBarRef = ref<HTMLElement | null>(null)

const agentTriggerRef = ref<HTMLElement | null>(null)
const modelTriggerRef = ref<HTMLElement | null>(null)
const variantTriggerRef = ref<HTMLElement | null>(null)

const composerPickerStyle = ref<Record<string, string>>({ left: '8px' })

// Composer sizing + fullscreen layout.
const COMPOSER_DIVIDER_HIT_PX = 12
const composerShellHeight = ref(0)

let modelSelection: ReturnType<typeof useChatModelSelection>

type ModelSlugPickerOption = { value?: string; providerId?: string; modelId?: string }
type AgentPickerOption = { name?: string; description?: string }

function getComposerTextareaEl(composer: ComposerExpose | null): HTMLTextAreaElement | null {
  const textarea = composer?.textareaEl
  if (!textarea) return null
  return textarea instanceof HTMLTextAreaElement ? textarea : textarea.value
}

function asRecord(value: JsonValue): JsonObject {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : {}
}

function getRecord(value: JsonValue, key: string): JsonObject {
  const root = asRecord(value)
  const nested = root[key]
  return typeof nested === 'object' && nested !== null ? (nested as JsonObject) : {}
}

const chatCommands = useChatCommands({
  sessionDirectory,
  draft,
  composerRef,
  composerPickerOpen,
  getSelectedAgent: () => String(modelSelection?.selectedAgent?.value || ''),
  setAgentFromCommand: (agent) => modelSelection?.chooseAgent?.(agent),
  setModelSlugFromCommand: (slug) => modelSelection?.chooseModelSlug?.(slug),
  onSend: send,
})

const {
  commandOpen,
  commandQuery,
  commandIndex,
  loadCommands,
  insertCommand,
  handleDraftInput,
  handleDraftKeydown: handleDraftKeydownInner,
} = chatCommands

modelSelection = useChatModelSelection({
  chat,
  ui,
  opencodeConfig,
  sessionDirectory,
  composerControlsRef,
  composerPickerOpen,
  composerPickerStyle,
  agentTriggerRef,
  modelTriggerRef,
  variantTriggerRef,
  modelPickerQuery,
  agentPickerQuery,
  closeComposerActionMenu,
  commandOpen,
  commandQuery,
  commandIndex,
})

const composerPickerTitle = computed(() => {
  if (composerPickerOpen.value === 'model') return 'Model'
  if (composerPickerOpen.value === 'agent') return 'Agent'
  if (composerPickerOpen.value === 'variant') return 'Thinking'
  return 'Options'
})

const composerPickerSearchable = computed(() => {
  return Boolean(composerPickerOpen.value)
})

const composerPickerSearchPlaceholder = computed(() => {
  if (composerPickerOpen.value === 'model') return 'Search models'
  if (composerPickerOpen.value === 'agent') return 'Search agents'
  if (composerPickerOpen.value === 'variant') return 'Search variants'
  return 'Search options'
})

const composerPickerQuery = computed(() => {
  if (composerPickerOpen.value === 'model') return modelPickerQuery.value
  if (composerPickerOpen.value === 'agent') return agentPickerQuery.value
  if (composerPickerOpen.value === 'variant') return variantPickerQuery.value
  return ''
})

function setComposerPickerQuery(value: string) {
  const next = String(value || '')
  if (composerPickerOpen.value === 'model') {
    modelPickerQuery.value = next
    return
  }
  if (composerPickerOpen.value === 'agent') {
    agentPickerQuery.value = next
    return
  }
  if (composerPickerOpen.value === 'variant') {
    variantPickerQuery.value = next
  }
}

const composerPickerHelperText = computed(() => '')

const composerPickerEmptyText = computed(() => {
  if (composerPickerOpen.value === 'model') return 'No models found.'
  if (composerPickerOpen.value === 'agent') return 'No agents found.'
  if (composerPickerOpen.value === 'variant') return 'No variants found.'
  return 'No options found.'
})

const composerPickerGroups = computed<OptionMenuGroup[]>(() => {
  if (composerPickerOpen.value === 'model') {
    const groups: OptionMenuGroup[] = [
      {
        id: 'model-default',
        title: 'Default',
        collapsible: false,
        items: [
          {
            id: 'model:default',
            label: 'Auto (OpenCode default)',
            description: 'Let OpenCode choose the default model',
            checked: !modelSelection.selectedModelSlug.value,
            keywords: 'auto default model',
          },
        ],
      },
    ]

    const byProvider = new Map<string, OptionMenuItem[]>()
    for (const opt of modelSelection.filteredModelSlugOptions.value as ModelSlugPickerOption[]) {
      const providerId = String(opt?.providerId || '').trim() || 'Other'
      const modelId = String(opt?.modelId || '').trim() || String(opt?.value || '').trim()
      const value = String(opt?.value || '').trim()
      if (!value) continue
      const list = byProvider.get(providerId) || []
      list.push({
        id: `model:${value}`,
        label: modelId || value,
        description: providerId,
        checked: value === modelSelection.selectedModelSlug.value,
        keywords: `${value} ${providerId} ${modelId}`,
        monospace: true,
      })
      byProvider.set(providerId, list)
    }

    for (const providerId of Array.from(byProvider.keys()).sort((a, b) => a.localeCompare(b))) {
      groups.push({
        id: `provider:${providerId}`,
        title: providerId,
        subtitle: `${byProvider.get(providerId)?.length || 0} model(s)`,
        collapsible: true,
        items: byProvider.get(providerId) || [],
      })
    }

    return groups
  }

  if (composerPickerOpen.value === 'agent') {
    return [
      {
        id: 'agent-default',
        title: 'Default',
        items: [
          {
            id: 'agent:default',
            label: 'Auto (OpenCode default)',
            description: 'Let OpenCode choose the default agent',
            checked: !modelSelection.selectedAgent.value,
            keywords: 'auto default agent',
          },
        ],
      },
      {
        id: 'agents',
        title: 'Agents',
        subtitle: `${modelSelection.filteredAgentsForPicker.value.length} available`,
        items: (modelSelection.filteredAgentsForPicker.value as AgentPickerOption[]).map((agent) => ({
          id: `agent:${agent.name}`,
          label: String(agent.name || ''),
          description: String(agent.description || ''),
          checked: String(agent.name || '') === modelSelection.selectedAgent.value,
          keywords: `${agent.name || ''} ${agent.description || ''}`,
        })),
      },
    ]
  }

  if (composerPickerOpen.value === 'variant') {
    const query = variantPickerQuery.value.trim().toLowerCase()
    const variantItems = (modelSelection.variantOptions.value as string[])
      .filter((variant) => {
        if (!query) return true
        return String(variant || '').toLowerCase().includes(query)
      })
      .map((variant) => ({
        id: `variant:${variant}`,
        label: variant,
        checked: variant === modelSelection.selectedVariant.value,
        keywords: variant,
      }))

    return [
      {
        id: 'variant-default',
        title: 'Default',
        items: [
          {
            id: 'variant:default',
            label: 'Default',
            description: 'Use model default thinking profile',
            checked: !modelSelection.selectedVariant.value,
            keywords: 'default variant thinking',
          },
        ],
      },
      {
        id: 'variants',
        title: 'Variants',
        subtitle: `${variantItems.length} available`,
        items: variantItems,
      },
    ]
  }

  return []
})

function closeComposerPickerMenu() {
  composerPickerOpen.value = null
  modelPickerQuery.value = ''
  agentPickerQuery.value = ''
  variantPickerQuery.value = ''
}

function setComposerPickerOpen(next: boolean) {
  if (!next) closeComposerPickerMenu()
}

function handleComposerPickerSelect(item: OptionMenuItem) {
  const id = String(item.id || '')
  if (id === 'model:default') {
    void modelSelection.chooseModelDefault()
    return
  }
  if (id === 'agent:default') {
    void modelSelection.chooseAgentDefault()
    return
  }
  if (id === 'variant:default') {
    void modelSelection.chooseVariantDefault()
    return
  }
  if (id.startsWith('model:')) {
    void modelSelection.chooseModelSlug(id.slice('model:'.length))
    return
  }
  if (id.startsWith('agent:')) {
    void modelSelection.chooseAgent(id.slice('agent:'.length))
    return
  }
  if (id.startsWith('variant:')) {
    void modelSelection.chooseVariant(id.slice('variant:'.length))
  }
}

const scrollNav = useChatScrollNav({
  chat,
  ui,
  getRevertId: () => (revertState.value?.messageID ? String(revertState.value.messageID) : ''),
  composerFullscreenActive,
  composerShellHeight,
  composerDividerHitPx: COMPOSER_DIVIDER_HIT_PX,
})

const {
  loadingOlder,
  scrollEl,
  contentEl,
  bottomEl,
  isAtBottom,
  pendingInitialScrollSessionId,
  requestInitialScroll,
  scrollToBottom,
  scheduleScrollToBottom,
  scrollToBottomOnceAfterLoad,
  handleScroll,
  navigableMessageIds,
  navIndex,
  navBottomOffset,
  navTotalLabel,
  navPrev,
  navNext,
} = scrollNav

const composerLayout = useChatComposerLayout({
  ui,
  editorFullscreen,
  editorClosing,
  composerFullscreenActive,
  composerShellHeight,
  pageRef,
  composerBarRef,
  scrollEl,
  composerRef,
  commandOpen,
  composerPickerOpen,
  modelPickerQuery,
  scrollToBottom,
})

const {
  composerTargetHeight,
  handleComposerResize,
  toggleEditorFullscreen,
  closeEditorFullscreen,
  applyComposerUserHeight,
  resetComposerHeight,
} = composerLayout

function handleDraftKeydown(e: KeyboardEvent) {
  if (composerFullscreenActive.value && e.key === 'Escape' && !commandOpen.value) {
    e.preventDefault()
    closeEditorFullscreen()
    return
  }
  handleDraftKeydownInner(e)
}

type RevertDiffFile = { filename: string; additions: number; deletions: number }
type RevertState = { messageID: string; diff: string; diffFiles: RevertDiffFile[]; revertedUserCount: number }

function parseDiffFiles(diffText: string): RevertDiffFile[] {
  const t = (diffText || '').trim()
  if (!t) return []

  const lines = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const byFile = new Map<string, { additions: number; deletions: number }>()
  let current: string | null = null

  function normalizeFilename(raw: string): string {
    const v = (raw || '').trim()
    if (!v || v === '/dev/null') return ''
    return v.replace(/^[ab]\//, '')
  }

  function ensure(name: string) {
    const filename = normalizeFilename(name)
    if (!filename) return ''
    if (!byFile.has(filename)) byFile.set(filename, { additions: 0, deletions: 0 })
    return filename
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const parts = line.split(' ')
      const a = parts[2] || ''
      const b = parts[3] || ''
      current = ensure(b || a) || null
      continue
    }
    if (line.startsWith('+++ ')) {
      const name = line.replace(/^\+\+\+\s+/, '')
      current = ensure(name) || current
      continue
    }

    if (!current) continue
    const record = byFile.get(current)
    if (!record) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      record.additions += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      record.deletions += 1
    }
  }

  const out: RevertDiffFile[] = []
  for (const [filename, counts] of byFile.entries()) {
    out.push({ filename, additions: counts.additions, deletions: counts.deletions })
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename))
  return out
}

const revertState = computed<RevertState | null>(() => {
  const s = asRecord(chat.selectedSession)
  const rev = getRecord(s, 'revert')
  const messageID = typeof rev?.messageID === 'string' ? rev.messageID.trim() : ''
  if (!messageID) return null

  const diff = typeof rev?.diff === 'string' ? rev.diff : ''
  const diffFiles = parseDiffFiles(diff).slice(0, 12)
  const revertedUserCount = chat.messages.filter((m: MessageEntry) => {
    const id = typeof m?.info?.id === 'string' ? m.info.id : ''
    const role = String(m?.info?.role || '')
    return role === 'user' && id && id >= messageID
  }).length

  return { messageID, diff, diffFiles, revertedUserCount }
})

const revertMarkerBusy = ref(false)

function nextUserMessageAfter(boundaryId: string): string {
  const bid = (boundaryId || '').trim()
  if (!bid) return ''
  for (const m of chat.messages as MessageEntry[]) {
    const id = typeof m?.info?.id === 'string' ? m.info.id : ''
    const role = String(m?.info?.role || '')
    if (role === 'user' && id && id > bid) return id
  }
  return ''
}

async function handleRedoFromRevertMarker() {
  const sid = chat.selectedSessionId
  const rev = revertState.value
  if (!sid || !rev?.messageID) return

  revertMarkerBusy.value = true
  try {
    const nextUser = nextUserMessageAfter(rev.messageID)
    if (nextUser) {
      await chat.revertToMessage(sid, nextUser, { restoreComposer: false })
    } else {
      await chat.unrevertSession(sid)
    }
    await chat.refreshMessages(sid, { silent: true })
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    revertMarkerBusy.value = false
  }
}

async function handleUnrevertFromRevertMarker() {
  const sid = chat.selectedSessionId
  if (!sid) return
  revertMarkerBusy.value = true
  try {
    await chat.unrevertSession(sid)
    await chat.refreshMessages(sid, { silent: true })
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    revertMarkerBusy.value = false
  }
}

const settingsData = computed<JsonObject>(() => asRecord(settings.data))

const activityAutoCollapseOnIdle = computed(() => settingsData.value.chatActivityAutoCollapseOnIdle !== false)

const activityDefaultExpandedKeys = computed<ChatActivityExpandKey[]>(() => {
  const s = settingsData.value
  if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityDefaultExpanded')) {
    return normalizeChatActivityDefaultExpanded(s.chatActivityDefaultExpanded)
  }
  return DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS.slice()
})

const activityDefaultExpandedToolSet = computed<Set<string>>(() => {
  const s = settingsData.value
  if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityDefaultExpandedToolFilters')) {
    return new Set(normalizeChatToolActivityFilters(s.chatActivityDefaultExpandedToolFilters))
  }
  return new Set()
})

function activityExpandKeyForPart(part: JsonObject): ChatActivityExpandKey | '' {
  const t = String(part?.type || '').trim().toLowerCase()
  if (t === 'tool' || (!t && typeof part?.tool === 'string')) return 'tool'
  if (t === 'reasoning' || t === 'thinking' || t === 'reasoning_content' || t === 'reasoning_details') return 'thinking'
  if (t.includes('justification')) return 'justification'
  return (t as ChatActivityExpandKey) || ''
}

function activityInitiallyExpandedForPart(part: JsonObject): boolean {
  const key = activityExpandKeyForPart(part)
  if (!key) return false
  if (key === 'tool') {
    const toolId = typeof part?.tool === 'string' ? part.tool.trim().toLowerCase() : ''
    if (!toolId) return activityDefaultExpandedToolSet.value.has('unknown')
    if (activityDefaultExpandedToolSet.value.has(toolId)) return true
    if (isKnownChatToolActivityType(toolId)) return false
    return activityDefaultExpandedToolSet.value.has('unknown')
  }
  return activityDefaultExpandedKeys.value.includes(key)
}

const showThinking = computed(() => Boolean(settingsData.value.showReasoningTraces))
const showJustification = computed(() => Boolean(settingsData.value.showTextJustificationActivity))
const showTimestamps = computed(() => settingsData.value.showChatTimestamps !== false)

const renderBlocksApi = useChatRenderBlocks({
  chat,
  settings,
  showThinking,
  showJustification,
  revertState,
  formatTime,
})

const {
  renderBlocks,
  getTextParts,
  isReasoningPart,
  isJustificationPart,
  isMetaPart,
  MAX_VISIBLE_ACTIVITY_COLLAPSED,
  activityExpandedByBlockKey,
  activityCollapseSignal,
  collapseAllActivities,
  isActivityExpanded,
  setActivityExpanded,
} = renderBlocksApi

const sessionActions = useChatSessionActions({
  chat,
  toasts,
  sessionTitle,
  sessionShareUrl,
  showThinking,
  showJustification,
  modelSelection: {
    shareDisabled: modelSelection.shareDisabled,
    selectedProviderId: modelSelection.selectedProviderId,
    selectedModelId: modelSelection.selectedModelId,
    effectiveDefaults: modelSelection.effectiveDefaults,
  },
  copyToClipboard,
})

const {
  renameDialogOpen,
  renameDraft,
  renameBusy,
  compactBusy,
  openRenameDialog,
  saveRename,
  copyTranscript,
  exportTranscript,
  handleShareSession,
  copyShareLink,
  openShareLink,
  handleUnshareSession,
  handleCompactSession,
} = sessionActions

const stream = useMessageStreaming({
  selectedSessionId: computed(() => chat.selectedSessionId || null),
  messages: computed(() => chat.messages),
  revertBoundaryId: computed(() => (revertState.value?.messageID ? String(revertState.value.messageID) : null)),
})

const {
  awaitingAssistant,
  pendingSendAt,
  showOptimisticUser,
  resetForSessionSwitch,
  beginOptimisticSend,
  markOptimisticSent,
  clearOnSendFailure,
} = stream

// vue-tsc's template narrowing can be finicky around `Ref<T | null>` even when
// the runtime checks are correct. Keep this relaxed for now.
const optimisticUser = stream.optimisticUser

function closeComposerActionMenu() {
  composerActionMenuOpen.value = false
  composerActionMenuAnchorRef.value = null
  composerActionMenuQuery.value = ''
}

function toggleComposerActionMenu(event?: MouseEvent | PointerEvent) {
  if (composerActionMenuOpen.value) {
    closeComposerActionMenu()
    return
  }
  composerActionMenuOpen.value = true
  composerActionMenuAnchorRef.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  composerActionMenuQuery.value = ''
  commandOpen.value = false
  commandQuery.value = ''
  commandIndex.value = 0
  closeComposerPickerMenu()
  // Desktop: focus search for quick filtering. Mobile: don't auto-focus (avoid IME popup).
  if (!ui.isMobilePointer) {
    void nextTick(() => sessionActionsMenuRef.value?.focusSearch?.())
  }
}

function runComposerActionMenu(item: ComposerActionItem | OptionMenuItem) {
  if (item.disabled) return
  closeComposerActionMenu()
  handleSessionActionRequest(item.id)
}

async function copyToClipboard(text: string) {
  const ok = await copyTextToClipboard(String(text || ''))
  if (!ok) throw new Error('Copy failed')
}

function stringifyForClipboard(value: JsonValue): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

async function handleCopySessionError() {
  const sid = String(chat.selectedSessionId || '').trim()
  const selectedError = chat.selectedSessionError
  if (!selectedError) {
    toasts.push('error', 'No session error to copy')
    return
  }

  const detail = selectedError.error
  const lines: string[] = []
  if (sid) lines.push(`sessionID: ${sid}`)

  const at = Number(selectedError.at || 0)
  if (Number.isFinite(at) && at > 0) {
    lines.push(`time: ${new Date(at).toISOString()}`)
  }

  const classification = String(detail.classification || '').trim()
  if (classification) lines.push(`classification: ${classification}`)

  const code = String(detail.code || '').trim()
  if (code) lines.push(`code: ${code}`)

  const name = String(detail.name || '').trim()
  if (name) lines.push(`name: ${name}`)

  const message = String(detail.message || '').trim()
  if (message) lines.push(`message: ${message}`)

  const rendered = String(detail.rendered || '').trim()
  if (rendered && rendered !== message) lines.push(`rendered: ${rendered}`)

  lines.push('raw:')
  lines.push(stringifyForClipboard(detail.raw as JsonValue))

  try {
    await copyToClipboard(lines.join('\n'))
    toasts.push('success', 'Copied error details')
  } catch {
    toasts.push('error', 'Failed to copy error details')
  }
}

const messageActions = useChatMessageActions({
  chat,
  toasts,
  route,
  router,
  sessionDirectory,
  draft,
  attachedFiles,
  clearAttachments,
  composerRef,
  getTextParts,
  copyToClipboard,
  scrollToBottom,
})

const { copiedMessageId, revertBusyMessageId, handleCopyMessage, handleForkFromMessage, handleRevertFromMessage } =
  messageActions

function isStreamingAssistantMessage(
  message: { info?: { role?: string; finish?: string; error?: unknown } } | null | undefined,
): boolean {
  if (!message?.info) return false
  const role = String(message.info.role || '')
  if (role !== 'assistant') return false
  if (message.info.error) return false
  const finish = typeof message.info.finish === 'string' ? message.info.finish.trim() : ''
  return !finish
}

let commandPointerHandler: ((event: MouseEvent | TouchEvent) => void) | null = null

function formatTime(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const runUi = useChatRunUi({
  chat,
  activity,
  toasts,
  modelSelection,
  draft,
  attachedFiles,
  sending,
  awaitingAssistant,
  pendingSendAt,
  renderBlocks,
  getRevertId: () => (revertState.value?.messageID ? String(revertState.value.messageID) : ''),
  onSend: send,
  collapseAllActivities,
  activityAutoCollapseOnIdle,
})

const {
  currentPhase,
  retryStatus,
  retryCountdownLabel,
  retryNextLabel,
  sessionUsage,
  formatCompactNumber,
  showAssistantPlaceholder,
  sessionEnded,
  aborting,
  canAbort,
  abortRun,
  composerPrimaryAction,
  composerPrimaryDisabled,
  handleComposerPrimaryAction,
} = runUi

function handleSessionActionRequest(actionId: string) {
  const insertBuiltInCommand = (name: string) => {
    insertCommand({ name, isBuiltIn: true, scope: 'session' })
  }

  switch (actionId) {
    case 'rename':
      openRenameDialog()
      break
    case 'share':
      void handleShareSession()
      break
    case 'unshare':
      void handleUnshareSession()
      break
    case 'copy-share':
      void copyShareLink()
      break
    case 'open-share':
      openShareLink()
      break
    case 'copy-transcript':
      void copyTranscript()
      break
    case 'export-transcript':
      void exportTranscript()
      break
    case 'compact':
      void handleCompactSession()
      break
    case 'init':
      insertBuiltInCommand('init')
      break
    case 'review':
      insertBuiltInCommand('review')
      break
    case 'attach-local':
      openFilePicker()
      break
    case 'attach-project':
      openProjectAttachDialog()
      break
    default:
      break
  }
}

watch(
  () => chat.selectedSessionId,
  () => {
    requestInitialScroll(chat.selectedSessionId)

    // Keep existing session behavior: agent/model are driven by the session's run config.
    // For a brand new session (no messages yet), applySessionSelection() will fall back to
    // OpenCode defaults.
    modelSelection.resetSelectionForSessionSwitch()
    modelSelection.applySessionSelection()
    activityExpandedByBlockKey.value = {}
    activityCollapseSignal.value += 1
    navIndex.value = Math.max(0, navigableMessageIds.value.length - 1)
    resetForSessionSwitch()
    revertBusyMessageId.value = ''
    editorFullscreen.value = false
    editorClosing.value = false
    applyComposerUserHeight()

    // Ensure chips reflect the session's resolved run config even when messages are cached
    // and no reactive length change occurs.
    modelSelection.applySessionSelection()
  },
)

// Single entry/session-switch bottom landing: keep it post-flush to avoid racing DOM.
watch(
  () => [
    pendingInitialScrollSessionId.value,
    scrollEl.value,
    contentEl.value,
    bottomEl.value,
    chat.messagesLoading,
    chat.messages.length,
  ],
  () => {
    const sid = pendingInitialScrollSessionId.value
    if (!sid) return
    void scrollToBottomOnceAfterLoad(sid)
  },
  { flush: 'post' },
)

watch(
  () => chat.messages.length,
  () => {
    if (isAtBottom.value) {
      navIndex.value = Math.max(0, navigableMessageIds.value.length - 1)
    }
  },
)

async function send() {
  const sid = chat.selectedSessionId
  const text = draft.value.trim()
  const filesSnapshot = attachedFiles.value.slice()
  const draftSnapshot = draft.value
  if (!sid || (!text && filesSnapshot.length === 0)) return

  // UX: if the editor is expanded, collapse it on send.
  if (editorFullscreen.value && !editorClosing.value) {
    closeEditorFullscreen()
  }

  sending.value = true
  beginOptimisticSend({
    sessionId: sid,
    text,
    files: filesSnapshot.map((f) => ({ filename: f.filename, mime: f.mime, url: f.url, serverPath: f.serverPath })),
  })

  // UX: clear the composer immediately on send.
  // If the request fails, we restore it in the catch block.
  draft.value = ''
  clearAttachments()
  commandOpen.value = false
  commandQuery.value = ''
  await nextTick()
  scrollToBottom('smooth')
  try {
    const parts: OutgoingMessagePart[] = []
    if (text) parts.push({ type: 'text', text })
    for (const f of filesSnapshot) {
      const url = typeof f.url === 'string' ? f.url : ''
      if (url) {
        parts.push({ type: 'file', mime: f.mime, url, filename: f.filename })
      } else if (f.serverPath) {
        parts.push({ type: 'file', mime: f.mime, filename: f.filename, serverPath: f.serverPath })
      }
    }

    await chat.sendMessage(sid, {
      providerID: modelSelection.selectedProviderId.value || undefined,
      modelID: modelSelection.selectedModelId.value || undefined,
      agent: modelSelection.selectedAgent.value || undefined,
      variant: modelSelection.selectedVariant.value || undefined,
      parts,
    })

    // Mark the optimistic message as sent (generation may still be running).
    markOptimisticSent(sid)
  } catch (e) {
    // Keep UI consistent if send fails.
    clearOnSendFailure()

    // Restore composer content on failure.
    draft.value = draftSnapshot
    attachedFiles.value = filesSnapshot
    throw e
  } finally {
    sending.value = false
  }
}

const lastMessageKey = computed(() => {
  const last = chat.messages[chat.messages.length - 1]
  if (!last) return ''
  const lastPart = last.parts[last.parts.length - 1]
  const part = (lastPart || {}) as { text?: string; content?: string }
  const textLen =
    typeof part.text === 'string'
      ? String(part.text).length
      : typeof part.content === 'string'
        ? String(part.content).length
        : 0
  return `${last.info.id}:${last.parts.length}:${lastPart?.id || ''}:${textLen}`
})

watch(
  () => lastMessageKey.value,
  () => {
    // Preserve user scroll position if they scrolled up.
    if (pendingInitialScrollSessionId.value) return
    if (!isAtBottom.value) return
    scheduleScrollToBottom()
  },
)

const lastHandledSessionActionSeq = ref(0)

watch(
  // Session actions can be requested from the ChatSidebar while ChatPage
  // is unmounted (mobile session switcher). Make the watcher immediate so a
  // pending request is handled on mount.
  () => ui.sessionActionSeq,
  (seq) => {
    if (!seq) return
    if (seq === lastHandledSessionActionSeq.value) return
    const actionId = ui.sessionActionId
    if (!actionId) return
    lastHandledSessionActionSeq.value = seq
    handleSessionActionRequest(actionId)
    ui.clearSessionActionRequest()
  },
  { immediate: true, flush: 'post' },
)

onMounted(async () => {
  // MainLayout already refreshes these, but keep Chat resilient on direct navigation.
  if (!chat.sessions.length) await chat.refreshSessions().catch(() => {})

  const sidFromQuery = readSessionIdFromQuery(route.query) || readSessionIdFromFullPath(route.fullPath)
  if (sidFromQuery && sidFromQuery !== chat.selectedSessionId) {
    await chat.selectSession(sidFromQuery).catch(() => {})
  }

  const sid = (chat.selectedSessionId || '').trim()
  if (sid && !pendingInitialScrollSessionId.value) {
    requestInitialScroll(sid)
  }

  await modelSelection.loadProvidersAndAgents()
  modelSelection.applySessionSelection()
  await loadCommands()
  navIndex.value = Math.max(0, navigableMessageIds.value.length - 1)

  commandPointerHandler = (event: MouseEvent | TouchEvent) => {
    const target = event.target as Node | null
    if (!target) return

    if (composerActionMenuOpen.value) {
      if (sessionActionsMenuRef.value?.containsTarget?.(target)) return
      if (composerActionMenuAnchorRef.value && composerActionMenuAnchorRef.value.contains(target)) return
      closeComposerActionMenu()
    }

    // Keep menus open when interacting within them.
    if (composerPickerRef.value?.containsTarget?.(target)) return
    if (composerControlsRef.value && composerControlsRef.value.contains(target)) return

    // Clicking anywhere else closes picker panels.
    closeComposerPickerMenu()

    // Don't dismiss command suggestions while the user is still interacting
    // with the textarea.
    const textarea = getComposerTextareaEl(composerRef.value)
    if (textarea && textarea.contains(target)) return
    commandOpen.value = false
  }
  document.addEventListener('pointerdown', commandPointerHandler, true)
})

watch(
  () => sessionDirectory.value,
  () => {
    void loadCommands()
    void modelSelection.loadProvidersAndAgents()
  },
)

// Template is rendered by ./chat/ChatPageView.vue. Keep this file under 1000 LOC by
// passing a context bag (refs + handlers) to the view.
const viewCtx = {
  // Stores / environment.
  chat,
  ui,

  // Template refs.
  pageRef,
  scrollEl,
  contentEl,
  bottomEl,
  composerBarRef,
  composerRef,
  composerControlsRef,
  composerPickerRef,
  modelTriggerRef,
  variantTriggerRef,
  agentTriggerRef,
  sessionActionsMenuRef,

  // Composer + attachments.
  draft,
  attachedFiles,
  formatBytes,
  handleDrop,
  handlePaste,
  handleDraftInput,
  handleDraftKeydown,
  handleFileInputChange,
  removeAttachment,
  clearAttachments,
  composerFullscreenActive,
  composerTargetHeight,
  handleComposerResize,
  resetComposerHeight,
  toggleEditorFullscreen,

  // Header.
  sessionEnded,
  canAbort,
  retryStatus,
  retryCountdownLabel,
  retryNextLabel,
  abortRun,

  // Messages.
  renderBlocks,
  pendingInitialScrollSessionId,
  loadingOlder,
  showTimestamps,
  formatTime,
  copiedMessageId,
  revertBusyMessageId,
  isStreamingAssistantMessage,
  showAssistantPlaceholder,
  revertMarkerBusy,
  currentPhase,
  awaitingAssistant,
  optimisticUser,
  showOptimisticUser,
  handleForkFromMessage,
  handleRevertFromMessage,
  handleCopyMessage,
  handleCopySessionError,
  handleRedoFromRevertMarker,
  handleUnrevertFromRevertMarker,

  // Activity rendering.
  activityInitiallyExpandedForPart,
  activityCollapseSignal,
  MAX_VISIBLE_ACTIVITY_COLLAPSED,
  isActivityExpanded,
  setActivityExpanded,
  isReasoningPart,
  isJustificationPart,
  isMetaPart,

  // Scroll + nav.
  handleScroll,
  isAtBottom,
  navigableMessageIds,
  navBottomOffset,
  navIndex,
  navTotalLabel,
  navPrev,
  navNext,
  scrollToBottom,

  // Composer action menu.
  composerActionMenuOpen,
  composerActionMenuQuery,
  composerActionMenuGroups,
  toggleComposerActionMenu,
  closeComposerActionMenu,
  runComposerActionMenu,

  // Model/agent/variant selection + picker.
  composerPickerTitle,
  composerPickerSearchable,
  composerPickerSearchPlaceholder,
  composerPickerQuery,
  setComposerPickerQuery,
  composerPickerHelperText,
  composerPickerEmptyText,
  composerPickerGroups,
  setComposerPickerOpen,
  handleComposerPickerSelect,
  ...modelSelection,

  // Send/stop.
  sessionUsage,
  formatCompactNumber,
  composerPrimaryAction,
  composerPrimaryDisabled,
  handleComposerPrimaryAction,
  aborting,
  sending,

  // Dialogs.
  renameDialogOpen,
  renameDraft,
  renameBusy,
  saveRename,
  attachProjectDialogOpen,
  attachProjectPath,
  sessionDirectory,
  addProjectAttachment,
} satisfies ChatPageViewContext

onBeforeUnmount(() => {
  if (commandPointerHandler) {
    document.removeEventListener('pointerdown', commandPointerHandler, true)
    commandPointerHandler = null
  }
})
</script>

<template>
  <ChatPageView :ctx="viewCtx" />
</template>
