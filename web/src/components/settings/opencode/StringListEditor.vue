<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import InlineSearchAdd, { type PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import TextActionButton from '@/components/ui/TextActionButton.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { normalizeStringList, removeFromList, splitTags } from '../OpenCodeConfigPanelListUtils'

type SplitMode = 'tags' | 'lines'

const props = withDefaults(
  defineProps<{
    modelValue?: string[] | null
    suggestions?: Array<string | PickerOption>
    placeholder?: string
    panelTitle?: string
    emptyText?: string
    advancedLabel?: string
    advancedPlaceholder?: string
    advancedRows?: number
    showAdvancedToggle?: boolean
    splitMode?: SplitMode
  }>(),
  {
    modelValue: () => [],
    suggestions: () => [],
    placeholder: '',
    panelTitle: '',
    emptyText: 'None',
    advancedLabel: 'Advanced text',
    advancedPlaceholder: '',
    advancedRows: 4,
    showAdvancedToggle: true,
    splitMode: 'tags',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const advancedOpen = ref(false)

const items = computed(() => normalizeStringList(props.modelValue || []))

const pickerOptions = computed<PickerOption[]>(() => {
  const out: PickerOption[] = []
  for (const item of props.suggestions || []) {
    if (typeof item === 'string') {
      const value = item.trim()
      if (!value) continue
      out.push({ value, label: value })
      continue
    }
    const value = String(item?.value || '').trim()
    if (!value) continue
    out.push({ ...item, value })
  }
  return out
})

const advancedText = computed({
  get: () => items.value.join('\n'),
  set: (raw: string) => setItems(splitLines(raw)),
})

function splitLines(raw: string): string[] {
  return String(raw || '')
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
}

function parseRaw(raw: string): string[] {
  return props.splitMode === 'lines' ? splitLines(raw) : splitTags(raw)
}

function setItems(next: string[]) {
  emit('update:modelValue', normalizeStringList(next))
}

function addRaw(raw: string) {
  const tokens = parseRaw(raw)
  if (!tokens.length) return
  setItems([...items.value, ...tokens])
}

function removeItem(value: string) {
  setItems(removeFromList(items.value, value))
}

function removeLast() {
  if (!items.value.length) return
  setItems(items.value.slice(0, -1))
}

function clearAll() {
  if (!items.value.length) return
  setItems([])
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <div class="text-[11px] text-muted-foreground">
        {{ items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : emptyText }}
      </div>
      <div class="flex items-center gap-2">
        <TextActionButton v-if="showAdvancedToggle" @click="advancedOpen = !advancedOpen">
          {{ advancedOpen ? 'Hide advanced text' : 'Show advanced text' }}
        </TextActionButton>
        <Tooltip>
          <IconButton title="Clear" aria-label="Clear list" :disabled="items.length === 0" @click="clearAll">
            <RiCloseLine class="h-4 w-4" />
          </IconButton>
          <template #content>Clear</template>
        </Tooltip>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <span
        v-for="value in items"
        :key="`list-item:${value}`"
        class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1 text-xs"
      >
        <span class="font-mono break-all">{{ value }}</span>
        <IconButton size="xs" class="h-5 w-5 text-muted-foreground hover:text-foreground" @click="removeItem(value)">
          ×
        </IconButton>
      </span>
      <span v-if="items.length === 0" class="text-xs text-muted-foreground">{{ emptyText }}</span>
    </div>

    <InlineSearchAdd
      :options="pickerOptions"
      :panel-title="panelTitle"
      :placeholder="placeholder"
      monospace
      :selected-values="items"
      @add="addRaw"
      @remove="removeItem"
      @backspace-empty="removeLast"
    />

    <label v-if="showAdvancedToggle && advancedOpen" class="grid gap-1">
      <span class="text-xs text-muted-foreground">{{ advancedLabel }}</span>
      <textarea
        v-model="advancedText"
        :rows="advancedRows"
        class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
        :placeholder="advancedPlaceholder"
      />
    </label>
  </div>
</template>
