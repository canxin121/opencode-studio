<script setup lang="ts">
import { computed } from 'vue'
import ListItemFrame from '@/components/ui/ListItemFrame.vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
    indent?: number
    disabled?: boolean
    as?: string
    actionsAlwaysVisible?: boolean
    actionVisibility?: 'hover' | 'always'
    density?: 'default' | 'compact'
    actionsFloating?: boolean
  }>(),
  {
    active: false,
    indent: undefined,
    disabled: false,
    as: 'button',
    actionsAlwaysVisible: false,
    actionVisibility: undefined,
    density: 'default',
    actionsFloating: true,
  },
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const resolvedActionVisibility = computed<'hover' | 'always'>(() => {
  if (props.actionVisibility) return props.actionVisibility
  return props.actionsAlwaysVisible ? 'always' : 'hover'
})
</script>

<template>
  <ListItemFrame
    :active="active"
    :indent="indent"
    :disabled="disabled"
    :as="as"
    :action-visibility="resolvedActionVisibility"
    :density="density"
    :actions-floating="actionsFloating"
    @click="emit('click', $event)"
  >
    <template v-if="$slots.icon" #leading>
      <slot name="icon" />
    </template>

    <slot />

    <template v-if="$slots.meta" #meta>
      <slot name="meta" />
    </template>

    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </ListItemFrame>
</template>
