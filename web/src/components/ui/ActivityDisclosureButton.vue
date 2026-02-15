<script setup lang="ts">
import { type HTMLAttributes, type Component, computed, ref } from 'vue'
import { RiArrowDownSLine, RiArrowRightSLine, RiLoader4Line, RiToolsLine } from '@remixicon/vue'

import { cn } from '@/lib/utils'

type ActivityDisclosureStatus = 'default' | 'running' | 'error'

interface Props {
  open: boolean
  label: string
  summary?: string
  icon?: Component
  status?: ActivityDisclosureStatus
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  summary: '',
  icon: RiToolsLine,
  status: 'default',
})

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

const isHovered = ref(false)

const iconToneClass = computed(() => {
  if (props.status === 'error') return 'text-destructive'
  if (props.status === 'running') return 'text-primary'
  return ''
})
</script>

<template>
  <button
    type="button"
    :aria-expanded="open"
    :class="
      cn(
        'w-full flex items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors select-none hover:bg-accent/40',
        props.class,
      )
    "
    @click="emit('toggle')"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <div class="relative flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
      <RiLoader4Line
        v-if="status === 'running'"
        class="h-3.5 w-3.5 animate-spin text-primary"
        :class="{ 'opacity-0': isHovered || open, 'opacity-100': !isHovered && !open }"
      />
      <component
        :is="icon"
        v-else
        class="h-3.5 w-3.5 transition-opacity"
        :class="[{ 'opacity-0': isHovered || open, 'opacity-100': !isHovered && !open }, iconToneClass]"
      />
      <div
        class="absolute inset-0 flex items-center justify-center transition-opacity"
        :class="{ 'opacity-100': isHovered || open, 'opacity-0': !isHovered && !open }"
      >
        <RiArrowDownSLine v-if="open" class="h-3.5 w-3.5" />
        <RiArrowRightSLine v-else class="h-3.5 w-3.5" />
      </div>
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <span class="shrink-0 text-xs font-medium text-foreground/80">{{ label }}</span>
      <span v-if="summary" class="truncate font-mono text-[11px] text-muted-foreground/70">{{ summary }}</span>
    </div>

    <slot name="right" />
  </button>
</template>
