<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { Primitive, type PrimitiveProps } from 'radix-vue'

import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/components/ui/button.variants'
import { cn } from '@/lib/utils'

interface Props extends PrimitiveProps {
  variant?: ButtonVariant
  size?: ButtonSize
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
})

const computedClass = computed(() => {
  return cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)
})
</script>

<template>
  <Primitive :as="as" :as-child="asChild" :class="computedClass">
    <slot />
  </Primitive>
</template>
