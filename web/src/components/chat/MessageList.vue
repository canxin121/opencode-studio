<script setup lang="ts">
import { RiCheckLine, RiFileLine, RiLoader4Line, RiSparkling2Line } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Markdown from '@/components/Markdown.vue'
import ToolInvocation from '@/components/ui/ToolInvocation.vue'
import ReasoningInvocation from '@/components/ui/ReasoningInvocation.vue'
import MetaInvocation from '@/components/ui/MetaInvocation.vue'
import Button from '@/components/ui/Button.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import MessageItem from '@/components/chat/MessageItem.vue'
import type { OptimisticUserMessage } from '@/composables/chat/useMessageStreaming'
import type { JsonValue } from '@/types/json'

type MessagePartLike = {
  id?: string
  type?: string
  tool?: string
  state?: JsonValue
  text?: string
  url?: string
  filename?: string
  mime?: string
  synthetic?: boolean
  ignored?: boolean
  [k: string]: JsonValue
}

type MessageLike = {
  info: {
    id?: string
    role?: string
    time?: { created?: number }
    finish?: string
    agent?: string
    modelID?: string
  }
  parts: MessagePartLike[]
}

type RevertLike = {
  messageID: string
  revertedUserCount: number
  diffFiles: Array<{ filename: string; additions: number; deletions: number }>
}

type RetryStatusLike = {
  next?: number
  attempt?: number
  message?: string
  [k: string]: JsonValue
} | null

type SessionErrorLike = {
  at: number
  error: {
    message: string
    rendered?: string
    code?: string
    classification?: string
  }
} | null

export type RenderBlock =
  | { kind: 'message'; key: string; message: MessageLike; textParts: MessagePartLike[] }
  | {
      kind: 'activity'
      key: string
      parts: MessagePartLike[]
      fromId: string | null
      toId: string | null
      timeLabel: string
    }
  | { kind: 'revert'; key: string; revert: RevertLike }

const props = defineProps<{
  isMobile: boolean
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
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}
</script>

<template>
  <div v-if="!selectedSessionId" :class="isMobile ? 'h-full min-h-[240px]' : 'py-16 text-center text-muted-foreground'">
    <MobileSidebarEmptyState
      v-if="isMobile"
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
                <template v-else>
                  <RiCheckLine class="h-3.5 w-3.5 text-emerald-500" />
                  {{ t('chat.messages.optimistic.sent') }}
                </template>
              </span>
            </div>
            <div class="rounded-lg border border-border/60 px-4 py-3 text-sm leading-relaxed bg-secondary/50 relative">
              <div class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg bg-secondary/90" />
              <div v-if="optimisticUser.text" class="break-words">
                <Markdown :content="optimisticUser.text" />
              </div>

              <div v-if="optimisticUser.files.length" class="mt-3">
                <div class="flex flex-wrap gap-2">
                  <template v-for="f in optimisticUser.files" :key="f.url || f.serverPath || f.filename">
                    <a
                      v-if="f.url"
                      :href="f.url"
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-2 rounded-md bg-muted/25 px-3 py-1 text-[11px] hover:bg-muted/35"
                      :title="f.filename"
                    >
                      <RiFileLine class="h-3.5 w-3.5" />
                      <span class="font-mono truncate max-w-[220px]">{{ f.filename }}</span>
                    </a>
                    <div
                      v-else
                      class="inline-flex items-center gap-2 rounded-md bg-muted/20 px-3 py-1 text-[11px]"
                      :title="f.filename"
                    >
                      <RiFileLine class="h-3.5 w-3.5" />
                      <span class="font-mono truncate max-w-[220px]">{{ f.filename }}</span>
                    </div>
                  </template>
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
              <Button size="sm" variant="outline" class="h-7" @click="$emit('copySessionError')">{{
                t('chat.sessionError.actions.copyDetails')
              }}</Button>
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
