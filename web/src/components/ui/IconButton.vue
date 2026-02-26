<script setup lang="ts">
import { type HTMLAttributes, computed, ref, useAttrs } from 'vue'
import { RiLoader4Line } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import type { ButtonVariant } from '@/components/ui/button.variants'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

type IconButtonSize = 'lg' | 'md' | 'sm' | 'xs'

interface Props {
  variant?: ButtonVariant
  size?: IconButtonSize
  class?: HTMLAttributes['class']
  loading?: boolean
  spinnerClass?: HTMLAttributes['class']
  tooltip?: string
  disableTooltip?: boolean
  isMobilePointer?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'ghost',
  size: 'md',
  loading: false,
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

const buttonSize = computed(() => {
  if (props.size === 'lg') return 'icon'
  if (props.size === 'sm') return 'icon-xs'
  if (props.size === 'xs') return 'icon-2xs'
  return 'icon-sm'
})

const spinnerSize = computed(() => {
  if (props.size === 'lg') return 'h-5 w-5'
  if (props.size === 'xs') return 'h-3.5 w-3.5'
  return 'h-4 w-4'
})
</script>

<template>
  <Tooltip v-if="showCustomTooltip">
    <Button
      ref="triggerEl"
      v-bind="passthroughAttrs"
      :title="nativeTitle"
      :variant="variant"
      :size="buttonSize"
      :class="cn('shrink-0', props.class)"
      :disabled="Boolean(attrs.disabled) || loading"
    >
      <RiLoader4Line v-if="loading" :class="cn(spinnerSize, 'animate-spin', spinnerClass)" />
      <slot v-else />
    </Button>
    <template #content>{{ tooltipText }}</template>
  </Tooltip>

  <Button
    v-else
    ref="triggerEl"
    v-bind="passthroughAttrs"
    :title="nativeTitle"
    :variant="variant"
    :size="buttonSize"
    :class="cn('shrink-0', props.class)"
    :disabled="Boolean(attrs.disabled) || loading"
  >
    <RiLoader4Line v-if="loading" :class="cn(spinnerSize, 'animate-spin', spinnerClass)" />
    <slot v-else />
  </Button>
</template>
