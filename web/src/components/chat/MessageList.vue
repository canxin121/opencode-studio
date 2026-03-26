<script setup lang="ts">
import { RiCheckLine, RiFileLine, RiLoader4Line, RiSparkling2Line, RiTimeLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import ToolInvocation from '@/components/ui/ToolInvocation.vue'
import ReasoningInvocation from '@/components/ui/ReasoningInvocation.vue'
import MetaInvocation from '@/components/ui/MetaInvocation.vue'
import Button from '@/components/ui/Button.vue'
import ToolbarChipButton from '@/components/ui/ToolbarChipButton.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import MessageItem from '@/components/chat/MessageItem.vue'
import type {
  MessageLike,
  MessagePartLike,
  RenderBlock,
  RetryStatusLike,
  SessionErrorLike,
} from '@/components/chat/messageList.types'
import { formatTimeHMS } from '@/i18n/intl'
import type { OptimisticUserMessage } from '@/composables/chat/useMessageStreaming'
import { buildWorkspaceRawFileUrl, extractWorkspacePathFromFileUrl, mediaKindFromHref } from '@/lib/workspaceLinks'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  isCompactLayout: boolean
  selectedSessionId: string | null
  messagesLoading: boolean
  messagesError: string | null
  sessionError?: SessionErrorLike
  renderBlocks: RenderBlock[]
  pendingInitialScrollSessionId: string | null
  loadingOlder: boolean

  // Message UI
  showTimestamps: boolean
  formatTime: (ms?: number) => string
  copiedMessageId: string
  revertBusyMessageId: string
  isStreamingAssistantMessage: (message: MessageLike) => boolean
  showAssistantPlaceholder: boolean

  // Revert marker
  revertMarkerBusy: boolean

  // Activity UI
  sessionEnded: boolean
  retryStatus: RetryStatusLike
  currentPhase: string
  awaitingAssistant: boolean
  activityInitiallyExpandedForPart: (part: MessagePartLike) => boolean
  activityCollapseSignal: number
  maxVisibleActivityCollapsed: number
  isActivityExpanded: (key: string) => boolean
  setActivityExpanded: (key: string, expanded: boolean) => void
  isReasoningPart: (part: MessagePartLike) => boolean
  isJustificationPart: (part: MessagePartLike) => boolean
  isMetaPart: (part: MessagePartLike) => boolean

  optimisticUser: OptimisticUserMessage | null
  showOptimisticUser: boolean
  openMobileSidebar?: () => void | Promise<void>
}>()

const emit = defineEmits<{
  (e: 'fork', messageId: string): void
  (e: 'revert', messageId: string): void
  (e: 'copy', message: MessageLike): void
  (e: 'redoFromRevert'): void
  (e: 'unrevertFromRevert'): void
  (e: 'copySessionError'): void
  (e: 'clearSessionError'): void
}>()

const { t } = useI18n()
const directoryStore = useDirectoryStore()
const ui = useUiStore()

type OptimisticFile = OptimisticUserMessage['files'][number]

function resolveWorkspacePathForOptimisticFile(file: OptimisticFile): string {
  const workspaceRoot = String(directoryStore.currentDirectory || '').trim()
  if (!workspaceRoot) return ''

  const serverPath = typeof file?.serverPath === 'string' ? file.serverPath.trim() : ''
  if (serverPath) {
    return extractWorkspacePathFromFileUrl(serverPath, workspaceRoot) || ''
  }

  const url = typeof file?.url === 'string' ? file.url.trim() : ''
  if (!url) return ''
  return extractWorkspacePathFromFileUrl(url, workspaceRoot) || ''
}

function openOptimisticFile(file: OptimisticFile) {
  const targetPath = resolveWorkspacePathForOptimisticFile(file)
  if (targetPath) {
    ui.requestWorkspaceDockFile(targetPath, 'open')
    return
  }

  const url = typeof file?.url === 'string' ? file.url.trim() : ''
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function optimisticFileClickable(file: OptimisticFile): boolean {
  return Boolean(resolveWorkspacePathForOptimisticFile(file) || String(file?.url || '').trim())
}

function optimisticFileLabel(file: OptimisticFile): string {
  const name = String(file?.filename || '').trim()
  if (name) return name
  const url = String(file?.url || '').trim()
  if (!url) return String(t('chat.messageItem.fileFallback'))
  if (url.startsWith('data:')) return String(t('chat.messageItem.attachmentFallback'))
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last || String(t('chat.messageItem.fileFallback'))
  } catch {
    return String(t('chat.messageItem.fileFallback'))
  }
}

function optimisticFilePreviewUrl(file: OptimisticFile): string {
  const url = typeof file?.url === 'string' ? file.url.trim() : ''
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url

  const workspaceRoot = String(directoryStore.currentDirectory || '').trim()
  if (!workspaceRoot) return url

  const path = resolveWorkspacePathForOptimisticFile(file)
  if (!path) return url
  return buildWorkspaceRawFileUrl(workspaceRoot, path)
}

function isOptimisticImageFile(file: OptimisticFile): boolean {
  if (String(file?.mime || '').startsWith('image/')) return true
  const filename = typeof file?.filename === 'string' ? file.filename : ''
  if (mediaKindFromHref(filename) === 'image') return true
  return mediaKindFromHref(typeof file?.url === 'string' ? file.url : '') === 'image'
}

function isOptimisticVideoFile(file: OptimisticFile): boolean {
  if (String(file?.mime || '').startsWith('video/')) return true
  const filename = typeof file?.filename === 'string' ? file.filename : ''
  if (mediaKindFromHref(filename) === 'video') return true
  return mediaKindFromHref(typeof file?.url === 'string' ? file.url : '') === 'video'
}

function isOptimisticAudioFile(file: OptimisticFile): boolean {
  if (String(file?.mime || '').startsWith('audio/')) return true
  const filename = typeof file?.filename === 'string' ? file.filename : ''
  if (mediaKindFromHref(filename) === 'audio') return true
  return mediaKindFromHref(typeof file?.url === 'string' ? file.url : '') === 'audio'
}

function optimisticImageFiles(files: OptimisticFile[]): OptimisticFile[] {
  return (files || []).filter((file) => isOptimisticImageFile(file))
}

function optimisticVideoFiles(files: OptimisticFile[]): OptimisticFile[] {
  return (files || []).filter((file) => isOptimisticVideoFile(file))
}

function optimisticAudioFiles(files: OptimisticFile[]): OptimisticFile[] {
  return (files || []).filter((file) => isOptimisticAudioFile(file))
}

function optimisticNonMediaFiles(files: OptimisticFile[]): OptimisticFile[] {
  return (files || []).filter(
    (file) => !(isOptimisticImageFile(file) || isOptimisticVideoFile(file) || isOptimisticAudioFile(file)),
  )
}

function optimisticSourcePath(user: OptimisticUserMessage | null): string {
  const list = Array.isArray(user?.files) ? user.files : []
  for (const file of list) {
    const path = resolveWorkspacePathForOptimisticFile(file)
    if (path) return path
  }
  return ''
}

function sessionErrorClassificationLabel(): string {
  const classification = String(props.sessionError?.error?.classification || '').trim()
  if (classification === 'context_overflow') return String(t('chat.sessionError.classification.contextOverflow'))
  if (classification === 'provider_auth') return String(t('chat.sessionError.classification.providerAuth'))
  if (classification === 'network') return String(t('chat.sessionError.classification.network'))
  if (classification === 'provider_api') return String(t('chat.sessionError.classification.providerApi'))
  return String(t('chat.sessionError.classification.sessionError'))
}

function sessionErrorBody(): string {
  const detail = props.sessionError?.error
  const rendered = typeof detail?.rendered === 'string' ? detail.rendered.trim() : ''
  if (rendered) return rendered
  const message = typeof detail?.message === 'string' ? detail.message.trim() : ''
  if (message) return message
  const code = typeof detail?.code === 'string' ? detail.code.trim() : ''
  if (code) return String(t('chat.sessionError.body.withCode', { code }))
  return String(t('chat.sessionError.body.default'))
}

function sessionErrorAtLabel(): string {
  const at = Number(props.sessionError?.at || 0)
  if (!Number.isFinite(at) || at <= 0) return ''
  return formatTimeHMS(at)
}
</script>

<template>
  <div
    v-if="!selectedSessionId"
    :class="isCompactLayout ? 'h-full min-h-[240px]' : 'py-16 text-center text-muted-foreground'"
  >
    <MobileSidebarEmptyState
      v-if="isCompactLayout"
      :title="t('chat.messages.empty.title')"
      :description="t('chat.messages.empty.description')"
      :action-label="t('chat.messages.empty.actionLabel')"
      :show-action="true"
      @action="openMobileSidebar?.()"
    />
    <template v-else>
      <RiSparkling2Line class="mx-auto h-10 w-10 opacity-25" />
      <div class="typography-ui-label font-semibold mt-3">{{ t('chat.messages.empty.title') }}</div>
      <div class="typography-meta mt-1">{{ t('chat.messages.empty.desktopDescription') }}</div>
    </template>
  </div>

  <div v-else-if="messagesLoading" class="py-10">
    <div class="space-y-4 animate-pulse">
      <div class="flex"><div class="w-full h-12 rounded-2xl bg-muted/25" /></div>
      <div class="flex"><div class="w-full h-16 rounded-2xl bg-muted/20" /></div>
      <div class="flex"><div class="w-full h-10 rounded-2xl bg-muted/20" /></div>
    </div>
  </div>

  <template v-else>
    <div v-if="loadingOlder" class="mb-2 px-1 text-[11px] text-muted-foreground/70 flex items-center gap-2">
      <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
      {{ t('chat.messages.loadingOlder') }}
    </div>

    <TransitionGroup
      :key="selectedSessionId || 'none'"
      :name="pendingInitialScrollSessionId ? '' : 'chatlist'"
      tag="div"
      class="space-y-4 transition-opacity duration-150 ease-out"
      :class="pendingInitialScrollSessionId ? 'opacity-0 pointer-events-none' : ''"
    >
      <div v-for="(b, idx) in renderBlocks" :key="b.key">
        <MessageItem
          v-if="b.kind === 'message'"
          :message="b.message"
          :text-parts="b.textParts"
          :show-timestamps="showTimestamps"
          :format-time="formatTime"
          :copied-message-id="copiedMessageId"
          :revert-busy-message-id="revertBusyMessageId"
          :is-streaming="isStreamingAssistantMessage(b.message)"
          @fork="$emit('fork', $event)"
          @revert="$emit('revert', $event)"
          @copy="$emit('copy', $event)"
        />

        <div v-else-if="b.kind === 'revert'" class="group">
          <div class="flex">
            <div class="w-full min-w-0">
              <div class="rounded-lg border border-border/60 bg-muted/10 px-4 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-muted-foreground">
                      {{
                        b.revert.revertedUserCount === 1
                          ? t('chat.revertMarker.revertedMessageCountOne')
                          : t('chat.revertMarker.revertedMessageCountMany', { count: b.revert.revertedUserCount })
                      }}
                    </div>
                    <div class="mt-0.5 text-[11px] text-muted-foreground/70 font-mono">
                      {{ t('chat.revertMarker.boundaryLine', { id: b.revert.messageID }) }}
                    </div>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      :disabled="revertMarkerBusy"
                      :title="t('chat.revertMarker.redoTitle')"
                      @click="$emit('redoFromRevert')"
                    >
                      <RiLoader4Line v-if="revertMarkerBusy" class="h-4 w-4 animate-spin" />
                      <span v-else>{{ t('chat.revertMarker.redo') }}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      :disabled="revertMarkerBusy"
                      :title="t('chat.revertMarker.restoreAllTitle')"
                      @click="$emit('unrevertFromRevert')"
                    >
                      {{ t('chat.revertMarker.restoreAll') }}
                    </Button>
                  </div>
                </div>

                <div v-if="b.revert.diffFiles.length" class="mt-3 grid gap-1">
                  <div
                    v-for="f in b.revert.diffFiles"
                    :key="f.filename"
                    class="flex items-center justify-between gap-3"
                  >
                    <div class="text-[12px] font-mono truncate">{{ f.filename }}</div>
                    <div class="text-[12px] font-mono whitespace-nowrap text-muted-foreground">
                      <span v-if="f.additions > 0" class="text-emerald-500">+{{ f.additions }}</span>
                      <span v-if="f.deletions > 0" class="ml-2 text-rose-500">-{{ f.deletions }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="group">
          <div class="flex">
            <div class="w-full min-w-0">
              <div class="flex items-center gap-2 px-1 mb-1 text-[11px] text-muted-foreground/70">
                <span class="font-semibold uppercase tracking-wider">{{ t('chat.roles.activity') }}</span>
                <span v-if="showTimestamps && b.timeLabel">{{ b.timeLabel }}</span>
                <span
                  v-if="
                    idx === renderBlocks.length - 1 &&
                    !sessionEnded &&
                    !retryStatus &&
                    (currentPhase === 'busy' || awaitingAssistant)
                  "
                  class="inline-flex items-center gap-1"
                >
                  <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
                  {{ t('common.working') }}
                </span>
                <button
                  v-if="!isActivityExpanded(b.key) && b.parts.length > maxVisibleActivityCollapsed"
                  type="button"
                  class="ml-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
                  @click="setActivityExpanded(b.key, true)"
                >
                  {{ t('chat.messages.activity.moreCount', { count: b.parts.length - maxVisibleActivityCollapsed }) }}
                </button>
                <button
                  v-else-if="isActivityExpanded(b.key) && b.parts.length > maxVisibleActivityCollapsed"
                  type="button"
                  class="ml-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
                  @click="setActivityExpanded(b.key, false)"
                >
                  {{ t('chat.messages.activity.hide') }}
                </button>
              </div>

              <div
                class="relative pl-4 min-w-0 before:absolute before:left-[0.45rem] before:top-0.5 before:bottom-0.5 before:w-px before:bg-border/60"
              >
                <TransitionGroup
                  :name="pendingInitialScrollSessionId ? '' : 'activitylist'"
                  tag="div"
                  class="space-y-0.5 min-w-0"
                >
                  <template
                    v-for="(p, pIdx) in isActivityExpanded(b.key)
                      ? b.parts
                      : b.parts.slice(-maxVisibleActivityCollapsed)"
                    :key="p?.id || p?.url || `${b.key}:${pIdx}`"
                  >
                    <ToolInvocation
                      v-if="
                        String(p?.type || '').toLowerCase() === 'tool' ||
                        (!String(p?.type || '').trim() && typeof p?.tool === 'string')
                      "
                      :part="p"
                      :sessionEnded="sessionEnded"
                      :initiallyExpanded="activityInitiallyExpandedForPart(p)"
                      :collapseSignal="activityCollapseSignal"
                      class="oc-activity-item"
                    />
                    <ReasoningInvocation
                      v-else-if="isReasoningPart(p) || isJustificationPart(p)"
                      :part="p"
                      :initiallyExpanded="activityInitiallyExpandedForPart(p)"
                      :collapseSignal="activityCollapseSignal"
                      class="oc-activity-item"
                    />
                    <MetaInvocation
                      v-else-if="isMetaPart(p)"
                      :part="p"
                      :initiallyExpanded="activityInitiallyExpandedForPart(p)"
                      :collapseSignal="activityCollapseSignal"
                      class="oc-activity-item"
                    />
                  </template>
                </TransitionGroup>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="optimisticUser && showOptimisticUser" :key="optimisticUser.key" class="group">
        <div class="flex">
          <div class="w-full min-w-0">
            <div class="flex items-center gap-2 px-1 mb-1 text-[11px] text-muted-foreground/70">
              <span class="font-semibold uppercase tracking-wider">{{ t('chat.roles.user') }}</span>
              <span v-if="showTimestamps">{{ formatTime(optimisticUser.createdAt) }}</span>
              <span class="inline-flex items-center gap-1">
                <template v-if="optimisticUser.status === 'sending'">
                  <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
                  {{ t('chat.messages.optimistic.sending') }}
                </template>
                <template v-else-if="optimisticUser.status === 'queued'">
                  <RiTimeLine class="h-3.5 w-3.5" />
                  {{ t('chat.messages.optimistic.queued') }}
                </template>
                <template v-else>
                  <RiCheckLine class="h-3.5 w-3.5 text-emerald-500" />
                  {{ t('chat.messages.optimistic.sent') }}
                </template>
              </span>
            </div>
            <div class="rounded-lg border border-border/60 px-4 py-3 text-sm leading-relaxed bg-secondary/50 relative">
              <div class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg bg-secondary/90" />
              <div v-if="optimisticUser.text" class="break-words">
                <MarkdownRenderer :content="optimisticUser.text" :source-path="optimisticSourcePath(optimisticUser)" />
              </div>

              <div v-if="optimisticUser.files.length" class="mt-3">
                <div v-if="optimisticNonMediaFiles(optimisticUser.files).length" class="flex flex-wrap gap-2">
                  <template
                    v-for="f in optimisticNonMediaFiles(optimisticUser.files)"
                    :key="f.url || f.serverPath || f.filename"
                  >
                    <button
                      v-if="optimisticFileClickable(f)"
                      type="button"
                      class="inline-flex items-center gap-2 rounded-md bg-muted/25 px-3 py-1 text-[11px] hover:bg-muted/35"
                      :title="optimisticFileLabel(f)"
                      @click="openOptimisticFile(f)"
                    >
                      <RiFileLine class="h-3.5 w-3.5" />
                      <span class="font-mono truncate max-w-[220px]">{{ optimisticFileLabel(f) }}</span>
                    </button>
                    <div
                      v-else
                      class="inline-flex items-center gap-2 rounded-md bg-muted/20 px-3 py-1 text-[11px]"
                      :title="optimisticFileLabel(f)"
                    >
                      <RiFileLine class="h-3.5 w-3.5" />
                      <span class="font-mono truncate max-w-[220px]">{{ optimisticFileLabel(f) }}</span>
                    </div>
                  </template>
                </div>

                <div
                  v-if="optimisticImageFiles(optimisticUser.files).length"
                  class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2"
                >
                  <button
                    v-for="img in optimisticImageFiles(optimisticUser.files)"
                    :key="img.url || img.serverPath || img.filename"
                    type="button"
                    class="block rounded-md overflow-hidden bg-muted/10"
                    :title="optimisticFileLabel(img)"
                    @click="openOptimisticFile(img)"
                  >
                    <img
                      :src="optimisticFilePreviewUrl(img) || img.url"
                      :alt="optimisticFileLabel(img)"
                      class="w-full h-24 object-cover"
                    />
                  </button>
                </div>

                <div
                  v-if="optimisticVideoFiles(optimisticUser.files).length"
                  class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  <div
                    v-for="video in optimisticVideoFiles(optimisticUser.files)"
                    :key="video.url || video.serverPath || video.filename"
                    class="rounded-md overflow-hidden bg-muted/10 border border-border/50"
                  >
                    <video
                      :src="optimisticFilePreviewUrl(video) || video.url"
                      controls
                      preload="metadata"
                      class="w-full h-28 object-cover"
                    />
                    <button
                      type="button"
                      class="w-full border-t border-border/40 px-2 py-1 text-left text-[11px] font-mono text-muted-foreground hover:text-foreground"
                      :title="optimisticFileLabel(video)"
                      @click="openOptimisticFile(video)"
                    >
                      <span class="block truncate">{{ optimisticFileLabel(video) }}</span>
                    </button>
                  </div>
                </div>

                <div v-if="optimisticAudioFiles(optimisticUser.files).length" class="mt-2 space-y-2">
                  <div
                    v-for="audio in optimisticAudioFiles(optimisticUser.files)"
                    :key="audio.url || audio.serverPath || audio.filename"
                    class="rounded-md overflow-hidden bg-muted/10 border border-border/50 p-2"
                  >
                    <audio
                      :src="optimisticFilePreviewUrl(audio) || audio.url"
                      controls
                      preload="metadata"
                      class="w-full"
                    />
                    <button
                      type="button"
                      class="mt-1 w-full border-t border-border/40 px-2 pt-1 text-left text-[11px] font-mono text-muted-foreground hover:text-foreground"
                      :title="optimisticFileLabel(audio)"
                      @click="openOptimisticFile(audio)"
                    >
                      <span class="block truncate">{{ optimisticFileLabel(audio) }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="showAssistantPlaceholder" key="assistant-placeholder" class="group">
        <div class="flex justify-start">
          <div class="max-w-[86%] min-w-0">
            <div class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70">
              <span class="font-semibold uppercase tracking-wider">{{ t('chat.roles.assistant') }}</span>
              <span class="inline-flex items-center gap-1">
                <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
                {{ t('common.working') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </TransitionGroup>

    <div v-if="sessionError" class="group mt-4">
      <div class="flex">
        <div class="w-full min-w-0">
          <div class="flex items-center gap-2 px-1 mb-1 text-[11px] text-muted-foreground/70">
            <span class="font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">{{
              t('chat.roles.system')
            }}</span>
          </div>

          <div
            class="rounded-lg border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm leading-relaxed text-rose-950 dark:border-rose-500/45 dark:bg-rose-950/25 dark:text-rose-100 relative"
          >
            <div
              class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg bg-rose-400/80 dark:bg-rose-400/70"
            />

            <div class="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span>{{ sessionErrorClassificationLabel() }}</span>
              <span v-if="sessionErrorAtLabel()" class="text-[10px] font-mono text-rose-900/70 dark:text-rose-200/80">
                {{ sessionErrorAtLabel() }}
              </span>
            </div>

            <div class="mt-1 break-words">{{ sessionErrorBody() }}</div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <ToolbarChipButton
                :tooltip="t('chat.sessionError.actions.copyDetails')"
                :title="t('chat.sessionError.actions.copyDetails')"
                :aria-label="t('chat.sessionError.actions.copyDetails')"
                class="h-7 rounded-md border border-rose-300/60 bg-rose-100/45 px-2 text-[11px] font-medium text-rose-900 hover:bg-rose-100/65 dark:border-rose-500/40 dark:bg-rose-900/25 dark:text-rose-100 dark:hover:bg-rose-900/40"
                @click="$emit('copySessionError')"
              >
                {{ t('chat.sessionError.actions.copyDetails') }}
              </ToolbarChipButton>
              <Button size="sm" variant="outline" class="h-7" @click="$emit('clearSessionError')">{{
                t('chat.sessionError.actions.dismiss')
              }}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
