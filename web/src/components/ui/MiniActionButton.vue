<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'
import { RiLoader4Line } from '@remixicon/vue'

import Button, { type ButtonVariant } from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'

type MiniActionSize = 'mini' | 'xs' | 'sm'

interface Props {
  variant?: ButtonVariant
  size?: MiniActionSize
  class?: HTMLAttributes['class']
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'secondary',
  size: 'mini',
  loading: false,
})

const attrs = useAttrs()

const buttonSize = computed(() => {
  if (props.size === 'sm') return 'sm'
  if (props.size === 'xs') return 'xs'
  return 'mini'
})
</script>

<template>
  <Button
    v-bind="attrs"
    :variant="variant"
    :size="buttonSize"
    :class="cn('font-medium', props.class)"
    :disabled="Boolean(attrs.disabled) || loading"
  >
    <RiLoader4Line v-if="loading" class="mr-1 h-3.5 w-3.5 animate-spin" />
    <slot />
  </Button>
</template>
