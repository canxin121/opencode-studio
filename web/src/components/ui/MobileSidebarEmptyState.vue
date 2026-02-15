<script setup lang="ts">
import Button from '@/components/ui/Button.vue'

withDefaults(
  defineProps<{
    title: string
    description: string
    actionLabel?: string
    showAction?: boolean
  }>(),
  {
    actionLabel: 'Open panel',
    showAction: false,
  },
)

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <div class="grid h-full place-items-center px-4">
    <div class="w-full max-w-sm rounded-sm border border-border/60 bg-muted/20 p-4 text-center">
      <div class="text-sm font-medium text-foreground">{{ title }}</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ description }}</div>
      <Button v-if="showAction" size="sm" class="mt-3 h-7 text-[11px]" @click="emit('action')">
        {{ actionLabel }}
      </Button>
    </div>
  </div>
</template>
