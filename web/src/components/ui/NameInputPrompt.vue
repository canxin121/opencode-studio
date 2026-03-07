<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    open: boolean
    modelValue: string
    title?: string
    description?: string
    placeholder?: string
    confirmLabel?: string
    cancelLabel?: string
    busy?: boolean
    isMobilePointer?: boolean
  }>(),
  {
    title: '',
    description: '',
    placeholder: '',
    confirmLabel: 'Create',
    cancelLabel: 'Cancel',
    busy: false,
  },
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:modelValue', value: string): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const ui = useUiStore()

const inputEl = ref<HTMLInputElement | null>(null)

const isMobileSheet = computed(() => (props.isMobilePointer === undefined ? ui.isMobilePointer : props.isMobilePointer))

const draft = computed({
  get: () => String(props.modelValue || ''),
  set: (value: string) => emit('update:modelValue', value),
})

const canSubmit = computed(() => !props.busy && Boolean(draft.value.trim()))

function close() {
  emit('cancel')
  emit('update:open', false)
}

function submit() {
  if (!canSubmit.value) return
  emit('submit')
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    window.requestAnimationFrame(() => {
      inputEl.value?.focus()
      inputEl.value?.select()
    })
  },
)
</script>

<template>
  <div v-if="open">
    <div
      v-if="isMobileSheet"
      class="fixed inset-0 z-[72] flex flex-col bg-background"
      :style="{ paddingTop: 'var(--oc-safe-area-top, 0px)', paddingBottom: 'var(--oc-safe-area-bottom, 0px)' }"
    >
      <div class="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <Button variant="ghost" size="sm" :disabled="busy" @click="close">{{ cancelLabel }}</Button>
        <div class="min-w-0 text-center text-sm font-medium text-foreground">{{ title }}</div>
        <Button size="sm" :disabled="!canSubmit" @click="submit">{{ confirmLabel }}</Button>
      </div>
      <div class="flex-1 overflow-auto px-4 py-4">
        <p v-if="description" class="text-xs text-muted-foreground">{{ description }}</p>
        <Input
          ref="inputEl"
          v-model="draft"
          class="mt-3 h-10 text-sm"
          :placeholder="placeholder"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="close"
        />
      </div>
    </div>

    <div v-else class="rounded-md border border-sidebar-border/70 bg-sidebar/95 p-2">
      <div class="flex items-center gap-2">
        <Input
          ref="inputEl"
          v-model="draft"
          class="h-8 min-w-0 flex-1 text-xs"
          :placeholder="placeholder"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="close"
        />
        <Button variant="ghost" size="xs" :disabled="busy" @click="close">{{ cancelLabel }}</Button>
        <Button size="xs" :disabled="!canSubmit" @click="submit">{{ confirmLabel }}</Button>
      </div>
    </div>
  </div>
</template>
