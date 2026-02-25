<script setup lang="ts">
import { computed, ref, unref } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import {
  RiArrowDownLine,
  RiArrowDownDoubleLine,
  RiArrowUpLine,
  RiAttachmentLine,
  RiLoader4Line,
  RiMore2Line,
  RiSendPlane2Line,
  RiStackLine,
  RiStopCircleLine,
  RiUserLine,
  RiBrainAi3Line,
} from '@remixicon/vue'

import VerticalSplitPane from '@/components/ui/VerticalSplitPane.vue'
import MessageList from '@/components/chat/MessageList.vue'
import PluginChatMounts from '@/components/chat/PluginChatMounts.vue'
import PluginChatOverlayMounts from '@/components/chat/PluginChatOverlayMounts.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import Composer from '@/components/chat/Composer.vue'
import RenameSessionDialog from '@/components/chat/RenameSessionDialog.vue'
import AttachProjectDialog from '@/components/chat/AttachProjectDialog.vue'
import AttachmentsPanel from '@/components/chat/AttachmentsPanel.vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import ToolbarChipButton from '@/components/ui/ToolbarChipButton.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import type { ChatPageViewContext } from './chatPageViewContext'
import { hasDisplayableAssistantError } from './assistantError'
import { resolveComposerToolbarLayout } from './composerToolbarLayout'

// This view is template-only: it takes a context bag from ChatPage.
// Keep it "dumb" so we can aggressively split ChatPage logic into composables.
const props = defineProps<{ ctx: ChatPageViewContext }>()
const ctx = props.ctx

const { t } = useI18n()

const {
  // Template refs (these are refs created in ChatPage).
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

  // Stores / state.
  chat,
  ui,
  attachedFiles,
  attachmentsBusy,
  attachmentsPanelOpen,
  draft,
  chatSidebarPluginMounts,
  chatOverlayBottomPluginMounts,

  // Message list.
  renderBlocks,
  pendingInitialScrollSessionId,
  loadingOlder,
  showTimestamps,
  formatTime,
  copiedMessageId,
  revertBusyMessageId,
  revertMarkerBusy,
  sessionEnded,
  retryStatus,
  currentPhase,
  awaitingAssistant,
  showAssistantPlaceholder,
  optimisticUser,
  showOptimisticUser,

  // Activity.
  activityInitiallyExpandedForPart,
  activityCollapseSignal,
  MAX_VISIBLE_ACTIVITY_COLLAPSED,
  isActivityExpanded,
  setActivityExpanded,
  isReasoningPart,
  isJustificationPart,
  isMetaPart,

  // Scroll/nav.
  handleScroll,
  isAtBottom,
  navigableMessageIds,
  navBottomOffset,
  navIndex,
  navTotalLabel,
  navPrev,
  navNext,
  scrollToBottom,

  // Composer layout.
  composerFullscreenActive,
  composerSplitTopCollapsed,
  composerTargetHeight,
  handleComposerResize,
  resetComposerHeight,
  toggleEditorFullscreen,
  formatBytes,
  handleDrop,
  handlePaste,
  handleDraftInput,
  handleDraftKeydown,
  handleFileInputChange,
  removeAttachment,
  clearAttachments,
  openFilePicker,
  openProjectAttachDialog,
  toggleAttachmentsPanel,
  setAttachmentsPanelOpen,
  closeAttachmentsPanel,

  // Header actions.
  canAbort,
  retryCountdownLabel,
  retryNextLabel,
  abortRun,

  // Composer action menu.
  composerActionMenuOpen,
  composerActionMenuQuery,
  composerActionMenuGroups,
  toggleComposerActionMenu,
  closeComposerActionMenu,
  runComposerActionMenu,

  // Model/agent/variant picker.
  composerPickerOpen,
  composerPickerStyle,
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
  hasVariantsForSelection,

  // Chip labels.
  modelHint,
  modelChipLabelMobile,
  modelChipLabel,
  toggleComposerPicker,
  variantHint,
  variantChipLabel,
  agentHint,
  agentChipLabel,

  // Usage + primary action.
  sessionUsage,
  formatCompactNumber,
  showComposerStopAction,
  composerStopDisabled,
  composerPrimaryDisabled,
  handleComposerPrimaryAction,
  handleComposerStopAction,
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

  // Message actions.
  isStreamingAssistantMessage,
  handleForkFromMessage,
  handleRevertFromMessage,
  handleCopyMessage,
  handleCopySessionError,
  handleRedoFromRevertMarker,
  handleUnrevertFromRevertMarker,
} = ctx

const attachmentsTriggerRef = ref<HTMLElement | null>(null)
const { width: viewportWidth } = useWindowSize()

const composerToolbarLayout = computed(() => resolveComposerToolbarLayout(ui.isMobilePointer, viewportWidth.value))
const splitComposerChipRows = computed(() => composerToolbarLayout.value.splitChipRows)
const modelChipTextClass = computed(() =>
  splitComposerChipRows.value
    ? 'text-[11px] font-mono font-medium truncate max-w-[88px]'
    : 'text-[11px] sm:text-xs font-mono font-medium truncate max-w-[150px] sm:max-w-[220px]',
)
const variantChipTextClass = computed(() =>
  splitComposerChipRows.value
    ? 'text-[11px] font-mono font-medium truncate max-w-[64px]'
    : 'text-[11px] sm:text-xs font-mono font-medium truncate max-w-[96px] sm:max-w-[140px]',
)
const agentChipTextClass = computed(() =>
  splitComposerChipRows.value
    ? 'text-[11px] font-medium truncate max-w-[72px]'
    : 'text-[11px] sm:text-xs font-medium truncate max-w-[96px] sm:max-w-[140px]',
)

const attachmentsCount = computed(() => {
  const list = unref(attachedFiles)
  return Array.isArray(list) ? list.length : 0
})

const attachmentsCountLabel = computed(() => {
  const n = attachmentsCount.value
  if (n > 99) return '99+'
  return String(n)
})

function handleAttachProjectFromPanel() {
  closeAttachmentsPanel()
  openProjectAttachDialog()
}

const overlayReservePx = ref(0)

function handleOverlayReserve(px: number) {
  if (!Number.isFinite(px) || px <= 0) {
    overlayReservePx.value = 0
    return
  }
  overlayReservePx.value = Math.max(0, Math.floor(px))
}

// Compute the anchor element for the picker menu based on which picker is open.
// This ensures the menu appears right next to the button that triggered it.
const activePickerAnchor = computed(() => {
  const mode = unref(composerPickerOpen)
  if (mode === 'model') return unref(modelTriggerRef)
  if (mode === 'variant') return unref(variantTriggerRef)
  if (mode === 'agent') return unref(agentTriggerRef)
  return null
})

const timelineSessionError = computed(() => {
  if (!chat.selectedSessionError) return null
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (hasDisplayableAssistantError(messages[i]?.info)) {
      return null
    }
  }
  return chat.selectedSessionError
})

// `ref="..."` in templates doesn't count as usage for TS.
void pageRef
void scrollEl
void contentEl
void bottomEl
void composerBarRef
void composerRef
void composerControlsRef
void composerPickerRef
void modelTriggerRef
void variantTriggerRef
void agentTriggerRef
void sessionActionsMenuRef
</script>

<template>
  <section ref="pageRef" class="h-full min-h-0 flex flex-col overflow-hidden relative">
    <VerticalSplitPane
      :model-value="composerTargetHeight"
      :collapse-top="composerSplitTopCollapsed"
      @update:model-value="handleComposerResize"
      @dblclick="resetComposerHeight"
      :min-height="ui.isMobile ? 170 : 190"
      :disabled="ui.isMobile"
    >
      <template #top>
        <div
          ref="scrollEl"
          class="h-full min-h-0 chat-scroll flex-1 overflow-y-auto"
          data-scrollbar="chat"
          @scroll="handleScroll"
        >
          <div ref="contentEl" class="chat-message-column py-4">
            <MessageList
              :is-mobile="ui.isMobile"
              :selected-session-id="chat.selectedSessionId"
              :messages-loading="chat.messagesLoading"
              :messages-error="chat.messagesError"
              :session-error="timelineSessionError"
              :render-blocks="renderBlocks"
              :pending-initial-scroll-session-id="pendingInitialScrollSessionId"
              :loading-older="loadingOlder"
              :show-timestamps="showTimestamps"
              :format-time="formatTime"
              :copied-message-id="copiedMessageId"
              :revert-busy-message-id="revertBusyMessageId"
              :is-streaming-assistant-message="isStreamingAssistantMessage"
              :show-assistant-placeholder="showAssistantPlaceholder"
              :revert-marker-busy="revertMarkerBusy"
              :session-ended="sessionEnded"
              :retry-status="retryStatus"
              :current-phase="currentPhase"
              :awaiting-assistant="awaitingAssistant"
              :activity-initially-expanded-for-part="activityInitiallyExpandedForPart"
              :activity-collapse-signal="activityCollapseSignal"
              :max-visible-activity-collapsed="MAX_VISIBLE_ACTIVITY_COLLAPSED"
              :is-activity-expanded="isActivityExpanded"
              :set-activity-expanded="setActivityExpanded"
              :is-reasoning-part="isReasoningPart"
              :is-justification-part="isJustificationPart"
              :is-meta-part="isMetaPart"
              :optimistic-user="optimisticUser"
              :show-optimistic-user="showOptimisticUser"
              :open-mobile-sidebar="() => ui.setSessionSwitcherOpen(true)"
              @fork="handleForkFromMessage"
              @revert="handleRevertFromMessage"
              @copy="handleCopyMessage"
              @redo-from-revert="handleRedoFromRevertMarker"
              @unrevert-from-revert="handleUnrevertFromRevertMarker"
              @copySessionError="handleCopySessionError"
              @clearSessionError="chat.selectedSessionId ? chat.clearSessionError(chat.selectedSessionId) : undefined"
            />

            <div v-if="overlayReservePx > 0" :style="{ height: `${overlayReservePx}px` }" aria-hidden="true" />

            <div ref="bottomEl" class="h-px w-full" aria-hidden="true" />
          </div>
        </div>

        <!-- Floating message navigation (user messages only) -->
        <div
          v-if="
            !composerFullscreenActive &&
            !(ui.isMobile && ui.isSessionSwitcherOpen) &&
            (navigableMessageIds.length > 1 ||
              (!isAtBottom && chat.messages.length) ||
              (navigableMessageIds.length > 0 && !chat.selectedHistory.exhausted))
          "
          class="absolute right-3 z-20 flex flex-col items-center gap-2"
          :style="{ bottom: navBottomOffset }"
        >
          <Button
            v-if="navigableMessageIds.length > 1 || (navigableMessageIds.length > 0 && !chat.selectedHistory.exhausted)"
            size="icon"
            variant="outline"
            class="h-8 w-8 rounded-full bg-background/80 backdrop-blur"
            :aria-label="t('chat.page.nav.previousUserMessage')"
            :title="t('chat.page.nav.previousUserMessage')"
            @click="navPrev"
            :disabled="(navIndex <= 0 && chat.selectedHistory.exhausted) || loadingOlder"
          >
            <RiArrowUpLine class="h-4 w-4" />
          </Button>
          <Button
            v-if="navigableMessageIds.length > 1"
            size="icon"
            variant="outline"
            class="h-8 w-8 rounded-full bg-background/80 backdrop-blur"
            :title="t('chat.page.nav.nextUserMessage')"
            :aria-label="t('chat.page.nav.nextUserMessage')"
            @click="navNext"
            :disabled="navIndex >= navigableMessageIds.length - 1"
          >
            <RiArrowDownLine class="h-4 w-4" />
          </Button>

          <div
            v-if="navigableMessageIds.length > 0"
            class="text-[10px] text-muted-foreground/80 bg-background/80 backdrop-blur rounded-full px-2 py-0.5 border border-border/60 select-none"
          >
            {{ navIndex + 1 }} / {{ navTotalLabel }}
          </div>

          <!-- Keep this slot fixed so other controls don't move -->
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8 rounded-full bg-background/80 backdrop-blur"
            :title="t('chat.page.nav.bottom')"
            :aria-label="t('chat.page.nav.bottom')"
            :class="!isAtBottom && chat.messages.length ? '' : 'invisible pointer-events-none'"
            @click="scrollToBottom('smooth')"
          >
            <RiArrowDownDoubleLine class="h-4 w-4" />
          </Button>
        </div>

        <div
          v-if="chat.selectedSessionId && !ui.isSessionSwitcherOpen && !composerFullscreenActive"
          class="pointer-events-none absolute inset-x-0 bottom-2 z-30"
        >
          <div class="chat-column">
            <PluginChatOverlayMounts
              :mounts="chatOverlayBottomPluginMounts"
              :is-mobile-pointer="ui.isMobilePointer"
              @reserve-change="handleOverlayReserve"
            />
          </div>
        </div>
      </template>

      <template #bottom>
        <div
          ref="composerBarRef"
          class="h-full flex flex-col min-h-0 bg-background/85 backdrop-blur ios-keyboard-safe-area"
          :data-keyboard-avoid="composerFullscreenActive ? 'resize' : 'shift'"
        >
          <div class="chat-column flex flex-col min-h-0 h-full" :class="ui.isMobile ? 'py-2' : 'py-3'">
            <div class="relative flex flex-1 flex-col min-h-0">
              <ChatHeader
                :session-id="chat.selectedSessionId"
                :session-ended="sessionEnded"
                :can-abort="canAbort"
                :retry-status="retryStatus"
                :retry-countdown-label="retryCountdownLabel"
                :retry-next-label="retryNextLabel"
                :attention="chat.selectedAttention"
                :mobile-pointer="ui.isMobilePointer"
                @abort="abortRun"
              />
              <PluginChatMounts :mounts="chatSidebarPluginMounts" />

              <Composer
                ref="composerRef"
                v-model:draft="draft"
                :fullscreen="composerFullscreenActive"
                class="flex-1 shrink-0 sm:shrink min-h-min"
                @toggleFullscreen="toggleEditorFullscreen"
                @drop="handleDrop"
                @paste="handlePaste"
                @draftInput="handleDraftInput"
                @draftKeydown="handleDraftKeydown"
                @filesSelected="handleFileInputChange"
              >
                <template #controls>
                  <div ref="composerControlsRef" class="relative">
                    <OptionMenu
                      ref="composerPickerRef"
                      :open="Boolean(composerPickerOpen)"
                      :query="composerPickerQuery"
                      :groups="composerPickerGroups"
                      :title="composerPickerTitle"
                      :mobile-title="composerPickerTitle"
                      :searchable="composerPickerSearchable"
                      :search-placeholder="composerPickerSearchPlaceholder"
                      :empty-text="composerPickerEmptyText"
                      :helper-text="composerPickerHelperText"
                      :is-mobile-pointer="ui.isMobilePointer"
                      :desktop-fixed="true"
                      :desktop-style="composerPickerStyle"
                      :desktop-anchor-el="activePickerAnchor"
                      :paginated="composerPickerOpen === 'model' || composerPickerOpen === 'agent'"
                      :page-size="composerPickerOpen === 'model' ? 80 : 60"
                      pagination-mode="group"
                      :collapsible-groups="composerPickerOpen === 'model'"
                      desktop-placement="top-start"
                      desktop-class="w-[min(420px,calc(100%-1rem))]"
                      filter-mode="external"
                      @update:open="setComposerPickerOpen"
                      @update:query="setComposerPickerQuery"
                      @select="handleComposerPickerSelect"
                    />

                    <div
                      class="composer-controls-surface w-full flex flex-row items-center justify-between gap-2 rounded-b-xl border-t border-border/60 bg-background/60 p-2 sm:px-2.5"
                    >
                      <!-- Region 1: Attachments, Menu, Agent, Model, Variant -->
                      <div
                        class="flex-1 flex flex-nowrap items-center gap-1 sm:gap-1.5 min-w-0 overflow-x-auto oc-scrollbar-hidden [&>*]:shrink-0"
                        data-oc-keyboard-tap="blur"
                      >
                        <Tooltip v-if="!ui.isMobilePointer">
                          <ToolbarChipButton
                            ref="attachmentsTriggerRef"
                            :active="attachmentsPanelOpen"
                            :aria-label="t('chat.page.attachments')"
                            @mousedown.prevent
                            @click.stop="toggleAttachmentsPanel"
                          >
                            <RiAttachmentLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                            <span
                              v-if="attachmentsBusy"
                              class="inline-flex items-center justify-center h-5 w-5 rounded-full border border-border/60 bg-background/60"
                              aria-hidden="true"
                            >
                              <RiLoader4Line class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            </span>
                            <span
                              v-else-if="attachmentsCount > 0"
                              class="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full border border-border/60 bg-secondary/60 text-[10px] font-mono tabular-nums"
                              aria-hidden="true"
                            >
                              {{ attachmentsCountLabel }}
                            </span>
                          </ToolbarChipButton>
                          <template #content>
                            {{
                              attachmentsCount > 0
                                ? t('chat.page.attachmentsWithCount', { count: attachmentsCount })
                                : t('chat.page.attachments')
                            }}
                          </template>
                        </Tooltip>

                        <ToolbarChipButton
                          v-else
                          ref="attachmentsTriggerRef"
                          :active="attachmentsPanelOpen"
                          :title="t('chat.page.attachments')"
                          :aria-label="t('chat.page.attachments')"
                          @mousedown.prevent
                          @click.stop="toggleAttachmentsPanel"
                        >
                          <RiAttachmentLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          <span
                            v-if="attachmentsBusy"
                            class="inline-flex items-center justify-center h-5 w-5 rounded-full border border-border/60 bg-background/60"
                            aria-hidden="true"
                          >
                            <RiLoader4Line class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          </span>
                          <span
                            v-else-if="attachmentsCount > 0"
                            class="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full border border-border/60 bg-secondary/60 text-[10px] font-mono tabular-nums"
                            aria-hidden="true"
                          >
                            {{ attachmentsCountLabel }}
                          </span>
                        </ToolbarChipButton>

                        <IconButton
                          class="text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                          :class="[composerActionMenuOpen ? 'bg-secondary/60 text-foreground' : '']"
                          :title="t('chat.page.tools')"
                          :aria-label="t('chat.page.tools')"
                          @mousedown.prevent
                          @click.stop="toggleComposerActionMenu"
                        >
                          <RiMore2Line class="h-4 w-4" />
                        </IconButton>

                        <OptionMenu
                          ref="sessionActionsMenuRef"
                          :open="composerActionMenuOpen"
                          v-model:query="composerActionMenuQuery"
                          :groups="composerActionMenuGroups"
                          :title="t('chat.page.tools')"
                          :mobile-title="t('chat.page.tools')"
                          :searchable="true"
                          :search-placeholder="t('common.searchActions')"
                          :empty-text="t('common.noActionsFound')"
                          :is-mobile-pointer="ui.isMobilePointer"
                          desktop-placement="top-start"
                          desktop-class="w-64"
                          filter-mode="external"
                          @update:open="(v) => (!v ? closeComposerActionMenu() : undefined)"
                          @close="closeComposerActionMenu"
                          @select="runComposerActionMenu"
                        />

                        <!-- Agent Tooltip -->
                        <Tooltip v-if="!ui.isMobilePointer && agentHint">
                          <ToolbarChipButton
                            :active="composerPickerOpen === 'agent'"
                            :aria-label="t('chat.composer.picker.agentTitle')"
                            ref="agentTriggerRef"
                            @mousedown.prevent
                            @click.stop="toggleComposerPicker('agent')"
                          >
                            <RiUserLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                            <span :class="agentChipTextClass">{{ agentChipLabel }}</span>
                          </ToolbarChipButton>
                          <template #content>{{ agentHint }}</template>
                        </Tooltip>
                        <ToolbarChipButton
                          v-else
                          :active="composerPickerOpen === 'agent'"
                          :title="t('chat.composer.picker.agentTitle')"
                          :aria-label="t('chat.composer.picker.agentTitle')"
                          ref="agentTriggerRef"
                          @mousedown.prevent
                          @click.stop="toggleComposerPicker('agent')"
                        >
                          <RiUserLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          <span :class="agentChipTextClass">{{ agentChipLabel }}</span>
                        </ToolbarChipButton>

                        <!-- Model Tooltip -->
                        <Tooltip v-if="!ui.isMobilePointer && modelHint">
                          <ToolbarChipButton
                            :active="composerPickerOpen === 'model'"
                            :aria-label="t('chat.composer.picker.modelTitle')"
                            ref="modelTriggerRef"
                            @mousedown.prevent
                            @click.stop="toggleComposerPicker('model')"
                          >
                            <RiStackLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                            <span :class="modelChipTextClass">{{
                              ui.isMobilePointer ? modelChipLabelMobile : modelChipLabel
                            }}</span>
                          </ToolbarChipButton>
                          <template #content>{{ modelHint }}</template>
                        </Tooltip>
                        <ToolbarChipButton
                          v-else
                          :active="composerPickerOpen === 'model'"
                          :title="t('chat.composer.picker.modelTitle')"
                          :aria-label="t('chat.composer.picker.modelTitle')"
                          ref="modelTriggerRef"
                          @mousedown.prevent
                          @click.stop="toggleComposerPicker('model')"
                        >
                          <RiStackLine class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          <span :class="modelChipTextClass">{{
                            ui.isMobilePointer ? modelChipLabelMobile : modelChipLabel
                          }}</span>
                        </ToolbarChipButton>

                        <!-- Variant Tooltip -->
                        <Tooltip v-if="hasVariantsForSelection && !ui.isMobilePointer && variantHint">
                          <ToolbarChipButton
                            :active="composerPickerOpen === 'variant'"
                            :aria-label="t('chat.composer.picker.variantTitle')"
                            ref="variantTriggerRef"
                            @mousedown.prevent
                            @click.stop="toggleComposerPicker('variant')"
                          >
                            <RiBrainAi3Line class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                            <span :class="variantChipTextClass">{{ variantChipLabel }}</span>
                          </ToolbarChipButton>
                          <template #content>{{ variantHint }}</template>
                        </Tooltip>
                        <ToolbarChipButton
                          v-else-if="hasVariantsForSelection"
                          :active="composerPickerOpen === 'variant'"
                          :title="t('chat.composer.picker.variantTitle')"
                          :aria-label="t('chat.composer.picker.variantTitle')"
                          ref="variantTriggerRef"
                          @mousedown.prevent
                          @click.stop="toggleComposerPicker('variant')"
                        >
                          <RiBrainAi3Line class="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          <span :class="variantChipTextClass">{{ variantChipLabel }}</span>
                        </ToolbarChipButton>
                      </div>

                      <!-- Region 2: Tokens usage -->
                      <div
                        v-if="sessionUsage"
                        class="flex-none flex flex-col items-end justify-center text-[10px] leading-tight text-muted-foreground font-mono select-none sm:pr-2"
                      >
                        <span class="opacity-80">
                          {{
                            ui.isMobilePointer
                              ? formatCompactNumber(sessionUsage.tokensValue || 0)
                              : t('chat.page.usage.tokensSuffix', { value: sessionUsage.tokensLabel })
                          }}
                        </span>
                        <span class="inline-flex items-center gap-1 opacity-80">
                          <span v-if="sessionUsage.percentUsed !== null">{{ sessionUsage.percentUsed }}%</span>
                          <span
                            v-if="sessionUsage.costLabel && sessionUsage.costLabel !== '$0.00' && !ui.isMobilePointer"
                            class="text-[9px]"
                          >
                            {{ sessionUsage.costLabel }}
                          </span>
                        </span>
                      </div>

                      <!-- Region 3: Stop & Send Actions -->
                      <div class="flex-none flex items-center gap-1.5">
                        <Tooltip v-if="showComposerStopAction">
                          <Button
                            size="icon"
                            variant="outline"
                            class="h-8 w-8 text-destructive hover:text-destructive"
                            data-oc-keyboard-tap="blur"
                            :aria-label="t('chat.page.primary.stopRun')"
                            :disabled="composerStopDisabled"
                            @click="handleComposerStopAction"
                          >
                            <RiLoader4Line v-if="aborting" class="h-4 w-4 animate-spin" />
                            <RiStopCircleLine v-else class="h-4 w-4" />
                          </Button>
                          <template #content>{{ t('chat.page.primary.stopRun') }}</template>
                        </Tooltip>

                        <Tooltip>
                          <Button
                            size="icon"
                            class="h-8 w-8"
                            data-oc-keyboard-tap="blur"
                            :aria-label="t('chat.page.primary.sendMessage')"
                            :disabled="composerPrimaryDisabled"
                            @click="handleComposerPrimaryAction"
                          >
                            <RiLoader4Line v-if="sending" class="h-4 w-4 animate-spin" />
                            <RiSendPlane2Line v-else class="h-4 w-4" />
                          </Button>
                          <template #content>{{ t('chat.page.primary.send') }}</template>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </template>
              </Composer>
            </div>
          </div>
        </div>
      </template>
    </VerticalSplitPane>
  </section>

  <!-- Mobile tools and picker menus are handled by OptionMenu. -->

  <RenameSessionDialog
    :open="renameDialogOpen"
    v-model:draft="renameDraft"
    :busy="renameBusy"
    @update:open="(v) => (renameDialogOpen = v)"
    @save="saveRename"
  />

  <AttachProjectDialog
    :open="attachProjectDialogOpen"
    v-model:path="attachProjectPath"
    :base-path="sessionDirectory"
    :attached-count="attachedFiles.length"
    @update:open="(v) => (attachProjectDialogOpen = v)"
    @add="addProjectAttachment"
  />

  <AttachmentsPanel
    :open="attachmentsPanelOpen"
    :is-mobile-pointer="ui.isMobilePointer"
    :desktop-anchor-el="attachmentsTriggerRef"
    :attached-files="attachedFiles"
    :busy="attachmentsBusy"
    :format-bytes="formatBytes"
    @update:open="setAttachmentsPanelOpen"
    @remove="removeAttachment"
    @clear="clearAttachments"
    @attachLocal="openFilePicker"
    @attachProject="handleAttachProjectFromPanel"
  />
</template>

<style scoped>
.chat-scroll {
  /* Prevent browser scroll anchoring from fighting programmatic bottom pinning. */
  overflow-anchor: none;
  /* Avoid width reflow when the vertical scrollbar appears. */
  scrollbar-gutter: stable;
}

/* List motion (subtle reveal). */
.chatlist-enter-active,
.chatlist-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms ease;
}

.chatlist-enter-from,
.chatlist-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.activitylist-enter-active,
.activitylist-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms ease;
}

.activitylist-enter-from,
.activitylist-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
