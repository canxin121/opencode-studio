<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

type ListItemActionVisibility = 'hover' | 'always'
type ListItemDensity = 'default' | 'compact'

const props = withDefaults(
  defineProps<{
    active?: boolean
    indent?: number
    disabled?: boolean
    as?: string
    actionVisibility?: ListItemActionVisibility
    density?: ListItemDensity
    actionsFloating?: boolean
    iconClass?: string
    contentClass?: string
    metaClass?: string
  }>(),
  {
    active: false,
    indent: undefined,
    disabled: false,
    as: 'button',
    actionVisibility: 'hover',
    density: 'default',
    actionsFloating: true,
    iconClass: '',
    contentClass: '',
    metaClass: '',
  },
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const rootClass = computed(() => {
  const densityClass = props.density === 'compact' ? 'py-0.5 pl-2 pr-1.5' : 'py-1 pl-2 pr-1.5'
  return cn(
    'group flex w-full min-w-0 items-center gap-2 rounded-md text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
    densityClass,
    props.active
      ? 'bg-primary/12 text-foreground dark:bg-accent/80 font-medium'
      : 'text-muted-foreground hover:bg-primary/6 hover:text-foreground hover:dark:bg-accent/40',
    props.disabled && 'pointer-events-none opacity-50',
  )
})

const actionsClass = computed(() => {
  const visibilityClass =
    props.actionVisibility === 'always'
      ? 'max-w-full opacity-100 pointer-events-auto'
      : 'max-w-0 opacity-0 pointer-events-none group-hover:max-w-full group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:max-w-full group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
  const floatingClass = props.actionsFloating ? 'z-[1] rounded-md bg-background/70 backdrop-blur-[1px]' : ''
  return cn(
    'ml-1 flex min-w-0 shrink-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-200 ease-out',
    visibilityClass,
    floatingClass,
  )
})
</script>

<template>
  <component
    :is="as"
    type="button"
    :class="rootClass"
    :style="{ paddingLeft: typeof indent === 'number' ? `${indent}px` : undefined }"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <div
      v-if="$slots.leading"
      :class="cn('flex shrink-0 items-center justify-center text-muted-foreground/70', iconClass)"
    >
      <slot name="leading" />
    </div>

    <div :class="cn('flex min-w-0 flex-1 flex-col justify-center overflow-visible', contentClass)">
      <slot />
    </div>

    <div
      v-if="$slots.meta"
      :class="cn('flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground', metaClass)"
    >
      <slot name="meta" />
    </div>

    <div v-if="$slots.actions" :class="actionsClass" @click.stop>
      <slot name="actions" />
    </div>
  </component>
</template>
