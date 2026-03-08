<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiCloseLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    currentMatch: number
    matchCount: number
    invalidRegex?: boolean
    caseSensitive: boolean
    wholeWord: boolean
    regex: boolean
  }>(),
  {
    invalidRegex: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'next'): void
  (e: 'previous'): void
  (e: 'toggle-case-sensitive'): void
  (e: 'toggle-whole-word'): void
  (e: 'toggle-regex'): void
  (e: 'close'): void
}>()

const rootRef = ref<HTMLElement | null>(null)

function focusInput(selectAll = false) {
  nextTick(() => {
    const input = rootRef.value?.querySelector('input')
    if (!(input instanceof HTMLInputElement)) return
    input.focus()
    if (selectAll) {
      input.select()
    }
  })
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) {
      emit('previous')
      return
    }
    emit('next')
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

defineExpose({
  focusInput,
})
</script>

<template>
  <div
    ref="rootRef"
    class="oc-editor-find-bar absolute right-3 top-3 z-30 flex w-[min(40rem,calc(100%-1.5rem))] flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card/95 p-2 text-xs shadow-lg backdrop-blur"
  >
    <div class="min-w-[12rem] flex-1">
      <Input
        :model-value="modelValue"
        type="text"
        placeholder="Find"
        class="h-8 px-2.5 font-mono text-xs"
        aria-label="Find"
        @update:model-value="(value) => emit('update:modelValue', String(value ?? ''))"
        @keydown="onInputKeydown"
      />
    </div>

    <div class="min-w-[4.5rem] text-right font-mono text-[11px] text-muted-foreground">
      <span v-if="invalidRegex" class="text-destructive">Invalid</span>
      <span v-else-if="matchCount > 0">{{ currentMatch }} / {{ matchCount }}</span>
      <span v-else>0 / 0</span>
    </div>

    <div class="flex items-center gap-1 rounded-md bg-muted/55 px-1 py-1">
      <IconButton
        size="xs"
        variant="ghost"
        class="h-6 w-6 text-muted-foreground hover:text-foreground"
        :disabled="matchCount < 1 || invalidRegex"
        title="Previous match"
        tooltip="Previous match"
        aria-label="Previous match"
        @click="emit('previous')"
      >
        <RiArrowUpSLine class="h-4 w-4" />
      </IconButton>
      <IconButton
        size="xs"
        variant="ghost"
        class="h-6 w-6 text-muted-foreground hover:text-foreground"
        :disabled="matchCount < 1 || invalidRegex"
        title="Next match"
        tooltip="Next match"
        aria-label="Next match"
        @click="emit('next')"
      >
        <RiArrowDownSLine class="h-4 w-4" />
      </IconButton>
    </div>

    <div class="flex items-center gap-1 rounded-md bg-muted/55 p-1">
      <SegmentedButton
        :active="caseSensitive"
        size="xs"
        class="h-6 px-1.5 font-mono text-[11px]"
        aria-label="Match case"
        title="Match case"
        @click="emit('toggle-case-sensitive')"
      >
        Aa
      </SegmentedButton>
      <SegmentedButton
        :active="wholeWord"
        size="xs"
        class="h-6 px-1.5 font-mono text-[11px]"
        aria-label="Whole word"
        title="Whole word"
        @click="emit('toggle-whole-word')"
      >
        W
      </SegmentedButton>
      <SegmentedButton
        :active="regex"
        size="xs"
        class="h-6 px-1.5 font-mono text-[11px]"
        aria-label="Use regular expression"
        title="Use regular expression"
        @click="emit('toggle-regex')"
      >
        .*
      </SegmentedButton>
    </div>

    <IconButton
      size="xs"
      variant="ghost"
      class="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Close search"
      tooltip="Close search"
      aria-label="Close search"
      @click="emit('close')"
    >
      <RiCloseLine class="h-4 w-4" />
    </IconButton>
  </div>
</template>

<style scoped>
:global(.oc-monaco-find-match) {
  background: oklch(var(--primary) / 0.2);
  border-radius: 2px;
}

:global(.oc-monaco-find-match-current) {
  background: oklch(var(--primary) / 0.42);
  box-shadow: inset 0 0 0 1px oklch(var(--primary) / 0.72);
  border-radius: 2px;
}

:global(.dark .oc-monaco-find-match) {
  background: oklch(var(--primary) / 0.28);
}

:global(.dark .oc-monaco-find-match-current) {
  background: oklch(var(--primary) / 0.46);
  box-shadow: inset 0 0 0 1px oklch(var(--primary) / 0.78);
}

@media (max-width: 640px) {
  .oc-editor-find-bar {
    left: 0.5rem;
    right: 0.5rem;
    top: 0.5rem;
    width: auto;
  }
}
</style>
