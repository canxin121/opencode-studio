<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiClipboardLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { highlightCodeToHtml } from '@/lib/highlight'
import { useToastsStore } from '@/stores/toasts'

const props = defineProps<{
  code: string
  lang?: string
  // Activity output should be denser than chat markdown.
  compact?: boolean
}>()

const lines = computed(() => {
  if (!props.code) return 0
  return props.code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').length
})

const isLarge = computed(() => {
  const len = props.code ? props.code.length : 0
  return lines.value > 18 || len > 1400
})

const expanded = ref(false)

const toasts = useToastsStore()
const { t } = useI18n()
const copyState = ref<'idle' | 'copied' | 'error'>('idle')
let copyTimer: number | null = null

watch(
  () => props.code,
  () => {
    // Default fold for large blocks to keep activity compact.
    expanded.value = !isLarge.value
  },
  { immediate: true },
)

const highlighted = computed(() => {
  return highlightCodeToHtml(props.code, props.lang)
})

async function copyCode() {
  const ok = await copyTextToClipboard(props.code)
  copyState.value = ok ? 'copied' : 'error'
  if (!ok) toasts.push('error', t('common.copyFailed'))
  if (copyTimer) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copyState.value = 'idle'
    copyTimer = null
  }, 1200)
}
</script>

<template>
  <div
    class="relative group w-full min-w-0 rounded-md border border-border bg-muted/40 overflow-hidden"
    :class="props.compact ? 'my-2' : 'my-4'"
  >
    <div
      class="flex items-center justify-between bg-muted/50 border-b border-border"
      :class="props.compact ? 'px-3 py-1.5' : 'px-4 py-2'"
    >
      <span class="text-xs font-mono text-muted-foreground">{{ lang || 'text' }}</span>
      <div class="flex items-center gap-1">
        <button
          v-if="isLarge"
          type="button"
          class="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 active:scale-95 transition"
          :title="expanded ? t('codeBlock.collapse') : t('codeBlock.expandLines', { lines })"
          :aria-label="expanded ? t('codeBlock.collapseAria') : t('codeBlock.expandAria')"
          @click="expanded = !expanded"
        >
          <RiArrowUpSLine v-if="expanded" class="h-4 w-4" />
          <RiArrowDownSLine v-else class="h-4 w-4" />
        </button>
        <button
          type="button"
          @click="copyCode"
          class="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/40 active:scale-95 transition opacity-0 group-hover:opacity-100"
          :title="t('codeBlock.copy')"
          :aria-label="t('codeBlock.copyAria')"
        >
          <RiCheckLine v-if="copyState === 'copied'" class="h-4 w-4 text-primary" />
          <RiClipboardLine v-else class="h-4 w-4" />
        </button>
      </div>
    </div>
    <div class="relative min-w-0">
      <pre
        class="overflow-x-auto font-mono"
        :class="[
          props.compact ? 'p-3 text-xs leading-snug' : 'p-4 text-sm leading-relaxed',
          !expanded && isLarge ? 'max-h-56 overflow-hidden' : '',
        ]"
      ><code v-html="highlighted" /></pre>

      <div
        v-if="!expanded && isLarge"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-muted/80 to-transparent"
      />
      <div v-if="!expanded && isLarge" class="absolute inset-x-0 bottom-0 flex justify-center pb-2">
        <button
          type="button"
          class="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background/70 backdrop-blur text-muted-foreground hover:text-foreground active:scale-95 transition"
          @click="expanded = true"
          :title="t('codeBlock.expand')"
          :aria-label="t('codeBlock.expand')"
        >
          <RiArrowDownSLine class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>
