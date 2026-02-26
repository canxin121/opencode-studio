<script setup lang="ts">
import { type HTMLAttributes, computed, useAttrs } from 'vue'

import Button from '@/components/ui/Button.vue'
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
  <Button
    v-bind="attrs"
    type="button"
    variant="ghost"
    size="icon-2xs"
    :class="
      cn(
        'oc-vscode-icon-button shadow-none',
        sizeClass,
        props.active ? 'bg-sidebar-accent/70 text-foreground' : '',
        props.destructive ? 'hover:text-destructive' : '',
        props.class,
      )
    "
  >
    <slot />
  </Button>
</template>
