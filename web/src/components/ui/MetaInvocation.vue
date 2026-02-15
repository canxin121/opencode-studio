<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RiFileList2Line, RiMagicLine, RiRefreshLine, RiScissorsLine, RiStackLine } from '@remixicon/vue'

import ActivityDisclosureButton from '@/components/ui/ActivityDisclosureButton.vue'
import CodeBlock from './CodeBlock.vue'
import { useChatStore } from '@/stores/chat'
import type { JsonObject as MetaRecord, JsonValue as MetaValue } from '@/types/json'

type MetaPart = {
  type?: string
  ocLazy?: boolean
  [k: string]: MetaValue
}

function asRecord(value: MetaValue): MetaRecord {
  return typeof value === 'object' && value !== null ? (value as MetaRecord) : {}
}

const props = defineProps<{
  part: MetaPart
  initiallyExpanded?: boolean
  // Bump this value to force-close details.
  collapseSignal?: number
}>()

const isOpen = ref(Boolean(props.initiallyExpanded))

const chat = useChatStore()
const detailLoading = ref(false)
const isLazy = computed(() => props.part?.ocLazy === true)

async function ensureDetail() {
  if (detailLoading.value) return
  if (!isLazy.value) return
  detailLoading.value = true
  try {
    await chat.ensureMessagePartDetail(props.part)
  } finally {
    detailLoading.value = false
  }
}

function toggleOpen() {
  const next = !isOpen.value
  isOpen.value = next
  if (next) void ensureDetail()
}

const kind = computed(() => String(props.part?.type || '').toLowerCase())

const title = computed(() => {
  switch (kind.value) {
    case 'step-start':
      return 'Step start'
    case 'step-finish':
      return 'Step finish'
    case 'snapshot':
      return 'Snapshot'
    case 'patch':
      return 'Patch'
    case 'agent':
      return 'Agent'
    case 'retry':
      return 'Retry'
    case 'compaction':
      return 'Compaction'
    default:
      return kind.value || 'Meta'
  }
})

const icon = computed(() => {
  switch (kind.value) {
    case 'patch':
      return RiStackLine
    case 'snapshot':
      return RiFileList2Line
    case 'retry':
      return RiRefreshLine
    case 'compaction':
      return RiScissorsLine
    default:
      return RiMagicLine
  }
})

function short(text: MetaValue, max = 72): string {
  const v = typeof text === 'string' ? text : ''
  const t = v.trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const summary = computed(() => {
  const p = asRecord(props.part)
  if (kind.value === 'agent' && typeof p.name === 'string') return short(p.name, 80)
  if ((kind.value === 'step-start' || kind.value === 'snapshot') && typeof p.snapshot === 'string')
    return short(p.snapshot)
  if (kind.value === 'step-finish') {
    const reason = typeof p.reason === 'string' ? p.reason : ''
    const cost = typeof p.cost === 'number' ? `$${p.cost.toFixed(4)}` : ''
    return [short(reason, 48), cost].filter(Boolean).join(' · ')
  }
  if (kind.value === 'patch') {
    const files = Array.isArray(p.files)
      ? p.files.length
      : typeof p.fileCount === 'number' && Number.isFinite(p.fileCount)
        ? Math.max(0, Math.floor(p.fileCount))
        : 0
    return files ? `${files} file(s)` : ''
  }
  if (kind.value === 'retry') {
    const attempt = typeof p.attempt === 'number' ? `attempt ${p.attempt}` : ''
    const error = asRecord(p.error)
    const msg = typeof error.message === 'string' ? error.message : ''
    return [attempt, short(msg, 56)].filter(Boolean).join(' · ')
  }
  if (kind.value === 'compaction') {
    const auto = typeof p.auto === 'boolean' ? (p.auto ? 'auto' : 'manual') : ''
    return auto
  }
  return ''
})

const details = computed(() => {
  try {
    return JSON.stringify(props.part ?? {}, null, 2)
  } catch {
    return String(props.part ?? '')
  }
})

onMounted(() => {
  // Auto-expand retries/errors by default.
  void kind.value
  if (isOpen.value) void ensureDetail()
})

watch(
  () => props.collapseSignal,
  () => {
    isOpen.value = false
  },
)

watch(
  () => props.initiallyExpanded,
  (next) => {
    if (isOpen.value) return
    isOpen.value = Boolean(next)
  },
)
</script>

<template>
  <div class="relative">
    <ActivityDisclosureButton :open="isOpen" :icon="icon" :label="title" :summary="summary" @toggle="toggleOpen" />

    <Transition name="toolreveal">
      <div v-show="isOpen" class="pl-6 pt-0.5 pb-1">
        <div v-if="detailLoading" class="text-[11px] text-muted-foreground/70 italic mb-1">Loading details...</div>
        <CodeBlock :code="details" lang="json" :compact="true" class="my-0" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toolreveal-enter-active,
.toolreveal-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms ease;
}

.toolreveal-enter-from,
.toolreveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
