<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/ui/Button.vue'
import AttentionPanel from '@/components/chat/AttentionPanel.vue'
import type { JsonValue } from '@/types/json'

type RetryStatus = { type: 'retry'; attempt: number; message: string; next: number }
type Attention = { kind: 'permission' | 'question'; payload: JsonValue }
type SessionError = {
  at: number
  error: {
    message: string
    rendered?: string
    code?: string
    name?: string
    classification?: string
  }
}

const props = withDefaults(
  defineProps<{
    sessionId: string | null
    sessionEnded: boolean
    canAbort: boolean
    retryStatus: RetryStatus | null
    retryCountdownLabel: string
    retryNextLabel: string
    attention: Attention | null
    sessionError?: SessionError | null
    mobilePointer?: boolean
  }>(),
  {
    mobilePointer: false,
  },
)

defineEmits<{
  (e: 'abort'): void
  (e: 'clearError'): void
  (e: 'copyError'): void
}>()

const hasRetry = computed(() => Boolean(props.retryStatus && props.sessionId))
const hasAttention = computed(() => Boolean(props.attention && props.sessionId && !props.sessionEnded))
const hasError = computed(() => Boolean(props.sessionError && props.sessionId))
const showOverlay = computed(() => hasRetry.value || hasAttention.value)

const errorClassificationLabel = computed(() => {
  const classification = String(props.sessionError?.error?.classification || '').trim()
  if (classification === 'context_overflow') return 'Context overflow'
  if (classification === 'provider_auth') return 'Auth error'
  if (classification === 'network') return 'Network error'
  if (classification === 'provider_api') return 'Provider error'
  if (classification === 'unknown') return 'Session error'
  return 'Session error'
})

const errorBody = computed(() => {
  const detail = props.sessionError?.error
  const rendered = typeof detail?.rendered === 'string' ? detail.rendered.trim() : ''
  if (rendered) return rendered
  const message = typeof detail?.message === 'string' ? detail.message.trim() : ''
  if (message) return message
  const code = typeof detail?.code === 'string' ? detail.code.trim() : ''
  if (code) return `[${code}] Session error`
  return 'Session error'
})

const errorAtLabel = computed(() => {
  const at = Number(props.sessionError?.at || 0)
  if (!Number.isFinite(at) || at <= 0) return ''
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
})

const mobileTitle = computed(() => {
  if (props.attention?.kind === 'permission') return 'Permission required'
  if (props.attention?.kind === 'question') return 'Question'
  if (props.retryStatus) return 'Retrying'
  return 'Action required'
})
</script>

<template>
  <div v-if="hasError" class="mb-2 rounded-lg border border-rose-300/70 bg-rose-50/70 px-3 py-2 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/25 dark:text-rose-100">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-xs font-semibold">
          <span>{{ errorClassificationLabel }}</span>
          <span v-if="errorAtLabel" class="text-[10px] font-mono text-rose-900/70 dark:text-rose-200/80">{{ errorAtLabel }}</span>
        </div>
        <div class="mt-1 text-[11px] leading-5 break-words">{{ errorBody }}</div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <Button size="sm" variant="outline" class="h-7" @click="$emit('copyError')">Copy details</Button>
        <Button size="sm" variant="outline" class="h-7" @click="$emit('clearError')">Dismiss</Button>
      </div>
    </div>
  </div>

  <template v-if="showOverlay">
    <div v-if="mobilePointer" class="fixed inset-0 z-[70]">
      <div class="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        class="absolute inset-0 px-2 pt-[calc(var(--oc-safe-area-top,0px)+8px)] pb-[calc(var(--oc-safe-area-bottom,0px)+8px)]"
      >
        <div class="h-full rounded-xl border border-input bg-background shadow-2xl overflow-hidden flex flex-col">
          <div class="shrink-0 border-b border-border/60 px-4 py-3">
            <div class="text-sm font-semibold">{{ mobileTitle }}</div>
            <div class="mt-0.5 text-[11px] text-muted-foreground">Respond to continue this session.</div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            <div v-if="hasRetry" class="rounded-lg border border-input bg-background px-3 py-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-semibold">Retrying in {{ retryCountdownLabel }}</div>
                  <div class="mt-0.5 text-[10px] font-mono text-muted-foreground/70">
                    attempt {{ retryStatus?.attempt }} • next {{ retryNextLabel }}
                  </div>
                  <div v-if="retryStatus?.message" class="mt-1 text-[11px] text-muted-foreground break-words">
                    {{ retryStatus.message }}
                  </div>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <Button size="sm" variant="outline" class="h-8" :disabled="!canAbort" @click="$emit('abort')"
                    >Stop</Button
                  >
                </div>
              </div>
            </div>

            <AttentionPanel
              v-if="hasAttention && attention && sessionId"
              :kind="attention.kind"
              :sessionId="sessionId"
              :payload="attention.payload"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-else class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] z-40">
      <div class="pointer-events-auto w-full max-h-[62dvh] overflow-y-auto space-y-2">
        <div v-if="hasRetry" class="rounded-lg border border-input bg-background px-3 py-2 shadow-lg">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-semibold">Retrying in {{ retryCountdownLabel }}</div>
              <div class="mt-0.5 text-[10px] font-mono text-muted-foreground/70">
                attempt {{ retryStatus?.attempt }} • next {{ retryNextLabel }}
              </div>
              <div v-if="retryStatus?.message" class="mt-1 text-[11px] text-muted-foreground break-words">
                {{ retryStatus.message }}
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <Button size="sm" variant="outline" class="h-8" :disabled="!canAbort" @click="$emit('abort')"
                >Stop</Button
              >
            </div>
          </div>
        </div>

        <AttentionPanel
          v-if="hasAttention && attention && sessionId"
          :kind="attention.kind"
          :sessionId="sessionId"
          :payload="attention.payload"
        />
      </div>
    </div>
  </template>
</template>
