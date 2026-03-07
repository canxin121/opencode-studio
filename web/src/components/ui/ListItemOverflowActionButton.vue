<script setup lang="ts">
import { ref } from 'vue'
import { RiMore2Line } from '@remixicon/vue'
import IconButton from '@/components/ui/IconButton.vue'
import { shouldAcceptListItemActionTap } from '@/components/ui/listItemTapGuard'

const props = withDefaults(
  defineProps<{
    label: string
    mobile?: boolean
  }>(),
  {
    mobile: false,
  },
)

const emit = defineEmits<{
  (e: 'trigger', event: MouseEvent): void
}>()

const pointerDownAtMs = ref(0)

function markPointerDown() {
  pointerDownAtMs.value = Date.now()
}

function onClick(event: MouseEvent) {
  if (!shouldAcceptListItemActionTap(event, pointerDownAtMs.value)) return
  emit('trigger', event)
}
</script>

<template>
  <IconButton
    :size="mobile ? 'sm' : 'xs'"
    class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
    :title="label"
    :aria-label="label"
    @pointerdown="markPointerDown"
    @click.stop="onClick"
  >
    <RiMore2Line class="h-4 w-4" />
  </IconButton>
</template>
