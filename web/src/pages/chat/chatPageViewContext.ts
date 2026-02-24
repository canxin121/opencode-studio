import type { CSSProperties, ComputedRef, Ref } from 'vue'

import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import type { RenderBlock } from '@/components/chat/MessageList.vue'
import type { OptimisticUserMessage } from '@/composables/chat/useMessageStreaming'
import type { AttachedFile } from '@/pages/chat/useChatAttachments'
import type { ChatMount } from '@/plugins/host/mounts'
import type { MessageEntry } from '@/types/chat'
import type { JsonObject } from '@/types/json'

type DynamicRecord = JsonObject

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>

type MessageRecordLike = {
  info?: {
    id?: string
    role?: string
    finish?: string
    time?: { created?: number }
    agent?: string
    modelID?: string
  }
  parts?: DynamicRecord[]
}

type ContainsTargetExpose = { containsTarget?: (target: Node | null) => boolean }

type ComposerExpose = {
  shellEl?: HTMLDivElement | { value: HTMLDivElement | null } | null
  textareaEl?: HTMLTextAreaElement | { value: HTMLTextAreaElement | null } | null
  openFilePicker?: () => void
}

type RetryStatusLike = {
  type: 'retry'
  next: number
  attempt: number
  message: string
} | null

type AttentionLike = { kind: 'permission' | 'question'; payload: DynamicRecord } | null

type SessionUsageLike = {
  tokensLabel: string
  percentUsed: number | null
  costLabel?: string
  tokensValue?: number | null
}

type SessionErrorLike = {
  at: number
  error: {
    message: string
    rendered?: string
    code?: string
    name?: string
    classification?: string
  }
} | null

export type ChatPageViewContext = {
  pageRef: Ref<HTMLElement | null>
  scrollEl: Ref<HTMLElement | null>
  contentEl: Ref<HTMLElement | null>
  bottomEl: Ref<HTMLElement | null>
  composerBarRef: Ref<HTMLElement | null>
  composerRef: Ref<ComposerExpose | null>
  composerControlsRef: Ref<HTMLElement | null>
  composerPickerRef: Ref<ContainsTargetExpose | null>
  modelTriggerRef: Ref<HTMLElement | null>
  variantTriggerRef: Ref<HTMLElement | null>
  agentTriggerRef: Ref<HTMLElement | null>
  sessionActionsMenuRef: Ref<ContainsTargetExpose | null>

  chat: {
    selectedSessionId: string | null
    selectedAttention: AttentionLike
    selectedHistory: { exhausted: boolean }
    selectedSessionError: SessionErrorLike
    messages: MessageEntry[]
    messagesLoading: boolean
    messagesError: string | null
    clearSessionError: (sessionId: string) => void
  }
  ui: {
    isMobile: boolean
    isMobilePointer: boolean
    isSessionSwitcherOpen: boolean
    setSessionSwitcherOpen: (open: boolean) => void
  }
  attachedFiles: MaybeRef<AttachedFile[]>
  attachmentsBusy: MaybeRef<boolean>
  attachmentsPanelOpen: MaybeRef<boolean>
  draft: MaybeRef<string>

  chatSidebarPluginMounts: MaybeRef<ChatMount[]>
  chatOverlayBottomPluginMounts: MaybeRef<ChatMount[]>

  renderBlocks: MaybeRef<RenderBlock[]>
  pendingInitialScrollSessionId: MaybeRef<string | null>
  loadingOlder: MaybeRef<boolean>
  showTimestamps: MaybeRef<boolean>
  formatTime: (ms?: number) => string
  copiedMessageId: MaybeRef<string>
  revertBusyMessageId: MaybeRef<string>
  revertMarkerBusy: MaybeRef<boolean>
  sessionEnded: MaybeRef<boolean>
  retryStatus: MaybeRef<RetryStatusLike>
  currentPhase: MaybeRef<string>
  awaitingAssistant: MaybeRef<boolean>
  showAssistantPlaceholder: MaybeRef<boolean>
  optimisticUser: MaybeRef<OptimisticUserMessage | null>
  showOptimisticUser: MaybeRef<boolean>

  activityInitiallyExpandedForPart: (part: DynamicRecord) => boolean
  activityCollapseSignal: MaybeRef<number>
  MAX_VISIBLE_ACTIVITY_COLLAPSED: number
  isActivityExpanded: (key: string) => boolean
  setActivityExpanded: (key: string, expanded: boolean) => void
  isReasoningPart: (part: DynamicRecord) => boolean
  isJustificationPart: (part: DynamicRecord) => boolean
  isMetaPart: (part: DynamicRecord) => boolean

  handleScroll: (event?: Event) => void
  isAtBottom: MaybeRef<boolean>
  navigableMessageIds: MaybeRef<string[]>
  navBottomOffset: MaybeRef<string>
  navIndex: MaybeRef<number>
  navTotalLabel: MaybeRef<string>
  navPrev: () => void
  navNext: () => void
  scrollToBottom: (behavior?: ScrollBehavior) => void

  composerFullscreenActive: MaybeRef<boolean>
  // When true, the top pane is force-collapsed so the fullscreen composer stays pinned to the top.
  // This prevents transient mobile viewport metric changes (IME/toolbars) from briefly revealing
  // the message list and making the composer "jump".
  composerSplitTopCollapsed: MaybeRef<boolean>
  composerTargetHeight: MaybeRef<number>
  handleComposerResize: (height: number) => void
  resetComposerHeight: () => void
  toggleEditorFullscreen: () => void
  formatBytes: (bytes: number) => string
  handleDrop: (event: DragEvent) => void | Promise<void>
  handlePaste: (event: ClipboardEvent) => void | Promise<void>
  handleDraftInput: () => void
  handleDraftKeydown: (event: KeyboardEvent) => void
  handleFileInputChange: (event: Event | FileList) => void | Promise<void>
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  openFilePicker: () => void
  openProjectAttachDialog: () => void
  toggleAttachmentsPanel: () => void
  setAttachmentsPanelOpen: (open: boolean) => void
  closeAttachmentsPanel: () => void

  canAbort: MaybeRef<boolean>
  retryCountdownLabel: MaybeRef<string>
  retryNextLabel: MaybeRef<string>
  abortRun: () => void | Promise<void>

  composerActionMenuOpen: MaybeRef<boolean>
  composerActionMenuQuery: MaybeRef<string>
  composerActionMenuGroups: MaybeRef<OptionMenuGroup[]>
  toggleComposerActionMenu: () => void
  closeComposerActionMenu: () => void
  runComposerActionMenu: (item: OptionMenuItem) => void | Promise<void>

  composerPickerOpen: MaybeRef<null | 'agent' | 'model' | 'variant'>
  composerPickerStyle: MaybeRef<CSSProperties>
  composerPickerTitle: MaybeRef<string>
  composerPickerSearchable: MaybeRef<boolean>
  composerPickerSearchPlaceholder: MaybeRef<string>
  composerPickerQuery: MaybeRef<string>
  setComposerPickerQuery: (query: string) => void
  composerPickerHelperText: MaybeRef<string>
  composerPickerEmptyText: MaybeRef<string>
  composerPickerGroups: MaybeRef<OptionMenuGroup[]>
  setComposerPickerOpen: (open: boolean) => void
  handleComposerPickerSelect: (item: OptionMenuItem) => void
  hasVariantsForSelection: MaybeRef<boolean>

  modelHint: MaybeRef<string>
  modelChipLabelMobile: MaybeRef<string>
  modelChipLabel: MaybeRef<string>
  toggleComposerPicker: (kind: 'agent' | 'model' | 'variant') => void
  variantHint: MaybeRef<string>
  variantChipLabel: MaybeRef<string>
  agentHint: MaybeRef<string>
  agentChipLabel: MaybeRef<string>

  sessionUsage: MaybeRef<SessionUsageLike | null>
  formatCompactNumber: (value: number) => string
  showComposerStopAction: MaybeRef<boolean>
  composerStopDisabled: MaybeRef<boolean>
  composerPrimaryDisabled: MaybeRef<boolean>
  handleComposerPrimaryAction: () => void
  handleComposerStopAction: () => void
  aborting: MaybeRef<boolean>
  sending: MaybeRef<boolean>

  renameDialogOpen: MaybeRef<boolean>
  renameDraft: MaybeRef<string>
  renameBusy: MaybeRef<boolean>
  saveRename: () => void | Promise<void>
  attachProjectDialogOpen: MaybeRef<boolean>
  attachProjectPath: MaybeRef<string>
  sessionDirectory: MaybeRef<string>
  addProjectAttachment: () => void | Promise<void>

  isStreamingAssistantMessage: (message: MessageRecordLike | null | undefined) => boolean
  handleCopySessionError: () => void | Promise<void>
  handleForkFromMessage: (messageId: string) => void
  handleRevertFromMessage: (messageId: string) => void
  handleCopyMessage: (message: MessageRecordLike) => void
  handleRedoFromRevertMarker: () => void
  handleUnrevertFromRevertMarker: () => void
}
