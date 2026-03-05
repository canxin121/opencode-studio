<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import AttentionPanel from '@/components/chat/AttentionPanel.vue'
import type { JsonValue } from '@/types/json'

type RetryStatus = { type: 'retry'; attempt: number; message: string; next: number }
type Attention = { kind: 'permission' | 'question'; payload: JsonValue }

const { t } = useI18n()

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

const overlayStackClass = computed(() =>
  props.mobilePointer
    ? 'pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] z-30'
    : 'pointer-events-none absolute inset-x-0 bottom-[calc(100%+0.75rem)] z-40',
)

const mobileTitle = computed(() => {
  if (props.attention?.kind === 'permission') return String(t('chat.headerOverlay.title.permissionRequired'))
  if (props.attention?.kind === 'question') return String(t('chat.headerOverlay.title.question'))
  if (props.retryStatus) return String(t('chat.headerOverlay.title.retrying'))
  return String(t('chat.headerOverlay.title.actionRequired'))
})
</script>

<template>
  <template v-if="showOverlay">
    <div :class="overlayStackClass">
      <div
        class="pointer-events-auto w-full overflow-y-auto space-y-2 max-h-[min(56dvh,calc(100dvh-var(--oc-safe-area-top,0px)-var(--oc-safe-area-bottom,0px)-9rem))]"
      >
        <div
          v-if="hasRetry"
          class="rounded-lg border border-border/70 bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
        >
          <div v-if="mobilePointer" class="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {{ mobileTitle }}
          </div>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-semibold">
                {{ t('chat.headerOverlay.retryingIn', { countdown: retryCountdownLabel }) }}
              </div>
              <div class="mt-0.5 text-[10px] font-mono text-muted-foreground/70">
                {{ t('chat.headerOverlay.retryMeta', { attempt: retryStatus?.attempt ?? 0, next: retryNextLabel }) }}
              </div>
              <div v-if="retryStatus?.message" class="mt-1 text-[11px] text-muted-foreground break-words">
                {{ retryStatus.message }}
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <Button size="sm" variant="outline" class="h-8" :disabled="!canAbort" @click="$emit('abort')">{{
                t('chat.page.primary.stop')
              }}</Button>
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
