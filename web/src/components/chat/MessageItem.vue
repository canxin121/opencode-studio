<script setup lang="ts">
import {
  RiArrowGoBackLine,
  RiCheckLine,
  RiClipboardLine,
  RiFileLine,
  RiGitBranchLine,
  RiLoader4Line,
} from '@remixicon/vue'

import Markdown from '@/components/Markdown.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import {
  buildAssistantErrorDetailsText,
  buildAssistantErrorMetaEntries,
  getAssistantErrorInfo,
} from '@/pages/chat/assistantError'
import type { JsonValue } from '@/types/json'
import { useI18n } from 'vue-i18n'

type MessagePartLike = {
  id?: string
  type?: string
  text?: string
  url?: string
  mime?: string
  filename?: string
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
    error?: JsonValue
    agent?: string
    modelID?: string
  }
  parts: MessagePartLike[]
}

type FilePart = MessagePartLike & { type: 'file'; url: string }

const props = defineProps<{
  message: MessageLike
  textParts: MessagePartLike[]
  showTimestamps: boolean
  formatTime: (ms?: number) => string
  copiedMessageId: string
  revertBusyMessageId: string
  isStreaming: boolean
}>()

const emit = defineEmits<{
  (e: 'fork', messageId: string): void
  (e: 'revert', messageId: string): void
  (e: 'copy', message: MessageLike): void
}>()

const { t } = useI18n()

function isFilePart(part: MessagePartLike): part is FilePart {
  return part?.type === 'file' && typeof part?.url === 'string' && part.url.length > 0
}

function getFileParts(parts: MessagePartLike[]): FilePart[] {
  return (parts || []).filter(isFilePart)
}

function isImageFilePart(part: FilePart): boolean {
  return String(part?.mime || '').startsWith('image/')
}

function imageFileParts(parts: MessagePartLike[]): FilePart[] {
  return getFileParts(parts).filter((part) => isImageFilePart(part))
}

function filePartLabel(part: MessagePartLike): string {
  const name = typeof part?.filename === 'string' ? part.filename.trim() : ''
  if (name) return name
  const url = typeof part?.url === 'string' ? part.url : ''
  if (!url) return String(t('chat.messageItem.fileFallback'))
  if (url.startsWith('data:')) return String(t('chat.messageItem.attachmentFallback'))
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last || String(t('chat.messageItem.fileFallback'))
  } catch {
    return String(t('chat.messageItem.fileFallback'))
  }
}

const role = () => String(props.message?.info?.role || '')
const messageId = () => String(props.message?.info?.id || '')

function assistantErrorInfo() {
  return getAssistantErrorInfo({
    role: props.message?.info?.role,
    error: props.message?.info?.error,
  })
}

const assistantErrorMessage = () => {
  const info = assistantErrorInfo()
  if (!info || info.interrupted || !info.message) return ''
  return info.message
}

const assistantErrorMetaEntries = () => {
  const info = assistantErrorInfo()
  if (!info || info.interrupted) return []
  return buildAssistantErrorMetaEntries(info)
}

const assistantErrorDetailsText = () => {
  const info = assistantErrorInfo()
  if (!info || info.interrupted) return ''
  return buildAssistantErrorDetailsText(info)
}

const assistantInterrupted = () => Boolean(assistantErrorInfo()?.interrupted)
const assistantHasError = () => role() === 'assistant' && Boolean(assistantErrorMessage())
</script>

<template>
  <div class="group">
    <div class="flex">
      <div
        class="w-full min-w-0"
        :id="`msg-${message.info.id}`"
        :data-chat-message-anchor="message.info.role === 'user' ? 'true' : undefined"
        :data-role="message.info.role"
      >
        <div class="flex items-center gap-2 px-1 mb-1 text-[11px] text-muted-foreground/70">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="font-semibold uppercase tracking-wider"
              :class="assistantHasError() ? 'text-rose-700 dark:text-rose-300' : ''"
              >{{ message.info.role }}</span
            >
            <span v-if="showTimestamps">{{ formatTime(message.info.time?.created) }}</span>
            <span v-if="message.info.agent" class="font-mono truncate">{{ message.info.agent }}</span>
            <span v-if="message.info.modelID" class="font-mono truncate">{{ message.info.modelID }}</span>
            <span v-if="assistantInterrupted()" class="text-muted-foreground">{{ t('chat.messageItem.interrupted') }}</span>
          </div>

          <div class="flex-1" />

          <div v-if="role() === 'user' || role() === 'assistant'" class="flex items-center gap-1">
            <ConfirmPopover
              v-if="role() === 'user'"
              :title="t('chat.messageItem.fork.confirmTitle')"
              :description="t('chat.messageItem.fork.confirmDescription')"
              :confirm-text="t('chat.messageItem.fork.confirmAction')"
              :cancel-text="t('common.cancel')"
              :anchor-to-cursor="false"
              @confirm="emit('fork', messageId())"
            >
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :title="t('chat.messageItem.fork.actionTitle')"
                :aria-label="t('chat.messageItem.fork.actionTitle')"
              >
                <RiGitBranchLine class="h-4 w-4" />
              </Button>
            </ConfirmPopover>

            <ConfirmPopover
              v-if="role() === 'user'"
              :title="t('chat.messageItem.revert.confirmTitle')"
              :description="t('chat.messageItem.revert.confirmDescription')"
              :confirm-text="t('chat.messageItem.revert.confirmAction')"
              :cancel-text="t('common.cancel')"
              variant="destructive"
              :anchor-to-cursor="false"
              @confirm="emit('revert', messageId())"
            >
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :title="t('chat.messageItem.revert.actionTitle')"
                :aria-label="t('chat.messageItem.revert.actionTitle')"
                :disabled="revertBusyMessageId === messageId()"
              >
                <RiLoader4Line v-if="revertBusyMessageId === messageId()" class="h-4 w-4 animate-spin" />
                <RiArrowGoBackLine v-else class="h-4 w-4" />
              </Button>
            </ConfirmPopover>

            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :title="t('chat.messageItem.copy.actionTitle')"
              :aria-label="t('chat.messageItem.copy.actionTitle')"
              @click="$emit('copy', message)"
            >
              <RiCheckLine v-if="copiedMessageId === messageId()" class="h-4 w-4 text-emerald-500" />
              <RiClipboardLine v-else class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          class="rounded-lg border border-border/60 px-4 py-3 text-sm leading-relaxed relative"
          :class="{
            'bg-secondary/50': role() === 'user',
            'bg-card/50': role() === 'assistant' && !assistantHasError(),
            'border-rose-300/70 bg-rose-50/70 text-rose-950 dark:border-rose-500/45 dark:bg-rose-950/25 dark:text-rose-100':
              assistantHasError(),
            'bg-destructive/10 border border-destructive/20 text-destructive': role() === 'system',
          }"
        >
          <div
            class="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg"
            :class="{
              'bg-secondary/90': role() === 'user',
              'bg-primary/55': role() === 'assistant' && !assistantHasError(),
              'bg-rose-400/80 dark:bg-rose-400/70': assistantHasError(),
              'bg-destructive/70': role() === 'system',
            }"
          />
          <div v-for="p in textParts" :key="p.id" class="space-y-2">
            <div class="break-words">
              <Markdown :content="p.text || ''" mode="markdown" :stream="isStreaming" />
            </div>
          </div>

          <div v-if="assistantErrorMessage()" class="mt-2 break-words">
            <Markdown :content="assistantErrorMessage()" mode="markdown" :stream="false" />
          </div>

          <div v-if="assistantErrorMetaEntries().length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="meta in assistantErrorMetaEntries()"
              :key="meta.label"
              class="inline-flex items-center rounded-md border border-rose-300/70 bg-rose-100/65 px-1.5 py-0.5 text-[10px] font-mono text-rose-900 dark:border-rose-500/45 dark:bg-rose-900/35 dark:text-rose-100"
            >
              {{ meta.label }}={{ meta.value }}
            </span>
          </div>

          <details
            v-if="assistantErrorDetailsText()"
            class="mt-2 rounded-md border border-rose-300/60 bg-rose-100/40 dark:border-rose-500/40 dark:bg-rose-900/20"
          >
            <summary
              class="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-rose-900 dark:text-rose-100"
            >
              {{ t('chat.messageItem.errorDetails') }}
            </summary>
            <pre
              class="max-h-64 overflow-auto border-t border-rose-300/50 px-2 py-1 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-rose-950 dark:border-rose-500/35 dark:text-rose-100"
              >{{ assistantErrorDetailsText() }}</pre
            >
          </details>

          <div v-if="getFileParts(message.parts).length" class="mt-3 space-y-2">
            <div class="flex flex-wrap gap-2">
              <template v-for="f in getFileParts(message.parts)" :key="f.id || f.url">
                <a
                  v-if="!(String(f.mime || '').startsWith('image/') && f.url)"
                  :href="f.url"
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex items-center gap-2 rounded-md bg-muted/25 px-3 py-1 text-[11px] hover:bg-muted/35"
                  :title="filePartLabel(f)"
                >
                  <RiFileLine class="h-3.5 w-3.5" />
                  <span class="font-mono truncate max-w-[220px]">{{ filePartLabel(f) }}</span>
                </a>
              </template>
            </div>

            <div v-if="imageFileParts(message.parts).length" class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <a
                v-for="img in imageFileParts(message.parts)"
                :key="img.id || img.url"
                :href="img.url"
                target="_blank"
                rel="noreferrer"
                class="block rounded-md overflow-hidden bg-muted/10"
                :title="filePartLabel(img)"
              >
                <img :src="img.url" :alt="filePartLabel(img)" class="w-full h-24 object-cover" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
