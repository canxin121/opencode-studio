<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'
import { Primitive, type PrimitiveProps } from 'radix-vue'

import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/components/ui/button.variants'
import Tooltip from '@/components/ui/Tooltip.vue'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

interface Props extends PrimitiveProps {
  variant?: ButtonVariant
  size?: ButtonSize
  class?: HTMLAttributes['class']
  tooltip?: string
  disableTooltip?: boolean
  isMobilePointer?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  tooltip: '',
  disableTooltip: false,
})

const attrs = useAttrs()

const coarsePointer = computed(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
})

const isMobilePointer = computed(() => props.isMobilePointer ?? coarsePointer.value)

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

const computedClass = computed(() => {
  return cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)
})
</script>

<template>
  <Tooltip v-if="showCustomTooltip">
    <Primitive v-bind="passthroughAttrs" :title="nativeTitle" :as="as" :as-child="asChild" :class="computedClass">
      <slot />
    </Primitive>
    <template #content>{{ tooltipText }}</template>
  </Tooltip>

  <Primitive v-else v-bind="passthroughAttrs" :title="nativeTitle" :as="as" :as-child="asChild" :class="computedClass">
    <slot />
  </Primitive>
</template>
