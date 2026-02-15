<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'
import { RiLoader4Line } from '@remixicon/vue'

import Button, { type ButtonVariant } from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'

type IconButtonSize = 'lg' | 'md' | 'sm' | 'xs'

interface Props {
  variant?: ButtonVariant
  size?: IconButtonSize
  class?: HTMLAttributes['class']
  loading?: boolean
  spinnerClass?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'ghost',
  size: 'md',
  loading: false,
})

const attrs = useAttrs()

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
  <Button
    v-bind="attrs"
    :variant="variant"
    :size="buttonSize"
    :class="cn('shrink-0', props.class)"
    :disabled="Boolean(attrs.disabled) || loading"
  >
    <RiLoader4Line v-if="loading" :class="cn(spinnerSize, 'animate-spin', spinnerClass)" />
    <slot v-else />
  </Button>
</template>
