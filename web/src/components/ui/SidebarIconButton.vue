<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'

import { cn } from '@/lib/utils'

type SidebarIconButtonSize = 'md' | 'sm'

interface Props {
  size?: SidebarIconButtonSize
  active?: boolean
  destructive?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  active: false,
  destructive: false,
})

const attrs = useAttrs()

const sizeClass = computed(() => (props.size === 'sm' ? 'h-5 w-5' : 'h-6 w-6'))
</script>

<template>
  <button
    v-bind="attrs"
    type="button"
    :class="
      cn(
        'oc-vscode-icon-button',
        sizeClass,
        props.active ? 'bg-sidebar-accent/70 text-foreground' : '',
        props.destructive ? 'hover:text-destructive' : '',
        props.class,
      )
    "
  >
    <slot />
  </button>
</template>
