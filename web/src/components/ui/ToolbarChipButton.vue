<script setup lang="ts">
import { type HTMLAttributes, computed, ref, useAttrs } from 'vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

interface Props {
  active?: boolean
  class?: HTMLAttributes['class']
  tooltip?: string
  disableTooltip?: boolean
  isMobilePointer?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  tooltip: '',
  disableTooltip: false,
})

const attrs = useAttrs()
const triggerEl = ref<HTMLElement | null>(null)

const coarsePointer = computed(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
})

const isMobilePointer = computed(() => props.isMobilePointer ?? coarsePointer.value)

defineExpose({
  triggerEl,
  getBoundingClientRect: () => triggerEl.value?.getBoundingClientRect(),
})

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const tooltipFromAttrs = computed(() => normalizeText(attrs.title))
const tooltipText = computed(() => normalizeText(props.tooltip) || tooltipFromAttrs.value)
const showCustomTooltip = computed(() => !props.disableTooltip && !isMobilePointer.value && Boolean(tooltipText.value))

const passthroughAttrs = computed(() => {
  const { title, ...rest } = attrs
  return rest
})

const nativeTitle = computed(() => {
  if (showCustomTooltip.value) return undefined
  return tooltipText.value || undefined
})
</script>

<template>
  <Tooltip v-if="showCustomTooltip">
    <Button
      ref="triggerEl"
      v-bind="passthroughAttrs"
      :title="nativeTitle"
      type="button"
      variant="ghost"
      size="xs"
      :class="
        cn(
          'h-7 sm:h-8 gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 shadow-none hover:bg-secondary/40',
          props.active ? 'bg-secondary/60' : '',
          props.class,
        )
      "
    >
      <slot />
    </Button>
    <template #content>{{ tooltipText }}</template>
  </Tooltip>

  <Button
    v-else
    ref="triggerEl"
    v-bind="passthroughAttrs"
    :title="nativeTitle"
    type="button"
    variant="ghost"
    size="xs"
    :class="
      cn(
        'h-7 sm:h-8 gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 shadow-none hover:bg-secondary/40',
        props.active ? 'bg-secondary/60' : '',
        props.class,
      )
    "
  >
    <slot />
  </Button>
</template>
