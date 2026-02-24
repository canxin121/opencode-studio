<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/ui/Button.vue'
import AttentionPanel from '@/components/chat/AttentionPanel.vue'
import type { JsonValue } from '@/types/json'

type RetryStatus = { type: 'retry'; attempt: number; message: string; next: number }
type Attention = { kind: 'permission' | 'question'; payload: JsonValue }

const props = withDefaults(
  defineProps<{
    sessionId: string | null
    sessionEnded: boolean
    canAbort: boolean
    retryStatus: RetryStatus | null
    retryCountdownLabel: string
    retryNextLabel: string
    attention: Attention | null
    mobilePointer?: boolean
  }>(),
  {
    mobilePointer: false,
  },
)

defineEmits<{
  (e: 'abort'): void
}>()

const hasRetry = computed(() => Boolean(props.retryStatus && props.sessionId))
const hasAttention = computed(() => Boolean(props.attention && props.sessionId && !props.sessionEnded))
const showOverlay = computed(() => hasRetry.value || hasAttention.value)

const mobileTitle = computed(() => {
  if (props.attention?.kind === 'permission') return 'Permission required'
  if (props.attention?.kind === 'question') return 'Question'
  if (props.retryStatus) return 'Retrying'
  return 'Action required'
})
</script>

<template>
  <template v-if="showOverlay">
    <div v-if="mobilePointer" class="fixed inset-0 z-[70]">
      <div class="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        class="absolute inset-0 px-2 pt-[calc(var(--oc-safe-area-top,0px)+8px)] pb-[calc(var(--oc-safe-area-bottom,0px)+8px)]"
      >
        <div class="max-h-full rounded-xl border border-input bg-background shadow-2xl overflow-hidden flex flex-col">
          <div class="shrink-0 border-b border-border/60 px-4 py-3">
            <div class="text-sm font-semibold">{{ mobileTitle }}</div>
            <div class="mt-0.5 text-[11px] text-muted-foreground">Respond to continue this session.</div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
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
