<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    active?: boolean
    indent?: number
    disabled?: boolean
    as?: string
    actionsAlwaysVisible?: boolean
  }>(),
  {
    active: false,
    indent: undefined,
    disabled: false,
    as: 'button',
    actionsAlwaysVisible: false,
  },
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const rootClass = computed(() =>
  cn(
    'group flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md py-1 pl-2 pr-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
    props.active
      ? 'bg-primary/12 text-foreground dark:bg-accent/80 font-medium'
      : 'text-muted-foreground hover:bg-primary/6 hover:text-foreground hover:dark:bg-accent/40',
    props.disabled && 'pointer-events-none opacity-50',
  ),
)

const actionsClass = computed(() =>
  cn(
    'ml-1 flex min-w-0 shrink-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-200 ease-out',
    props.actionsAlwaysVisible
      ? 'max-w-full opacity-100 pointer-events-auto'
      : 'max-w-0 opacity-0 pointer-events-none group-hover:max-w-full group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:max-w-full group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
  ),
)
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
    <!-- Left Icon Slot -->
    <div v-if="$slots.icon" class="flex shrink-0 items-center justify-center text-muted-foreground/70">
      <slot name="icon" />
    </div>

    <!-- Main Content -->
    <div class="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
      <slot />
    </div>

    <!-- Badges / Meta Info (Always visible) -->
    <div v-if="$slots.meta" class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
      <slot name="meta" />
    </div>

    <!-- Actions (Visible on group hover or if always visible is forced by parent) -->
    <div
      v-if="$slots.actions"
      :class="actionsClass"
      @click.stop
    >
      <slot name="actions" />
    </div>
  </component>
</template>
