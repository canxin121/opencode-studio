<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'

import Button from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'

interface Props {
  destructive?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  destructive: false,
})

const attrs = useAttrs()

const toneClass = computed(() =>
  props.destructive
    ? 'text-destructive/90 hover:text-destructive hover:bg-destructive/10'
    : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
)
</script>

<template>
  <Button
    v-bind="attrs"
    variant="ghost"
    size="mini"
    :class="cn('h-auto rounded-sm px-1.5 py-1 shadow-none', toneClass, props.class)"
  >
    <slot />
  </Button>
</template>
