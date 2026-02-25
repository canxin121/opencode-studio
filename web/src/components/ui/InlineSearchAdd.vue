<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RiCheckLine } from '@remixicon/vue'

import Input from '@/components/ui/Input.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    options: PickerOption[]
    placeholder?: string
    panelTitle?: string
    allowCustom?: boolean
    monospace?: boolean
    maxInitialOptions?: number
    selectedValues?: string[]
    disabled?: boolean
  }>(),
  {
    placeholder: 'Search…',
    panelTitle: '',
    allowCustom: true,
    monospace: false,
    maxInitialOptions: 80,
    selectedValues: () => [],
    disabled: false,
  },
)

const emit = defineEmits<{
  // Raw may contain separators; callers can reuse existing splitTags logic.
  (e: 'add', raw: string): void
  (e: 'remove', value: string): void
  (e: 'backspace-empty'): void
}>()

const rootRef = ref<HTMLElement | null>(null)

const open = ref(false)
const query = ref('')

const q = computed(() => query.value.trim().toLowerCase())
const selectedSet = computed(
  () => new Set((props.selectedValues || []).map((v) => String(v || '').trim()).filter(Boolean)),
)

const filteredOptions = computed(() => {
  const list = Array.isArray(props.options) ? props.options : []
  const qq = q.value
  if (!qq) return list
  return list.filter((opt) => {
    const hay = `${opt.value} ${opt.label || ''} ${opt.description || ''}`.toLowerCase()
    return hay.includes(qq)
  })
})

const showOptions = computed(() => {
  if (q.value) return filteredOptions.value.slice(0, 200)
  return filteredOptions.value.slice(0, Math.max(0, props.maxInitialOptions))
})

const isTruncated = computed(() => !q.value && filteredOptions.value.length > showOptions.value.length)

const canOfferCustom = computed(() => {
  if (!props.allowCustom) return false
  const raw = query.value.trim()
  if (!raw) return false
  return true
})

function addRaw(raw: string) {
  const v = String(raw || '').trim()
  if (!v) return
  emit('add', v)
  query.value = ''
  // Keep the menu open for rapid entry.
  open.value = true
}

function addCustom() {
  addRaw(query.value)
}

function chooseOption(value: string) {
  const v = String(value || '').trim()
  if (!v) return
  if (selectedSet.value.has(v)) {
    emit('remove', v)
    query.value = ''
    open.value = true
    return
  }
  addRaw(v)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (canOfferCustom.value) {
      addCustom()
      return
    }
    const first = showOptions.value[0]
    if (first && !first.disabled) chooseOption(first.value)
    return
  }
  if (e.key === 'Escape') {
    open.value = false
    return
  }
  if (e.key === 'Backspace' && !query.value.trim()) {
    emit('backspace-empty')
  }
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') || ''
  if (!text.trim()) return
  // If it looks like a tag list, add immediately (preserves existing paste UX).
  if (/[\n,\t ]/.test(text.trim())) {
    e.preventDefault()
    addRaw(text)
  }
}

function onFocus() {
  open.value = true
}

function closeIfOutside(ev: MouseEvent) {
  const root = rootRef.value
  const target = ev.target as Node | null
  if (!root || !target) return
  if (!root.contains(target)) open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', closeIfOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeIfOutside)
})

watch(
  () => props.disabled,
  (v) => {
    if (v) open.value = false
  },
)

function optionLabel(opt: PickerOption): string {
  return (opt.label || opt.value || '').trim()
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <Input
      v-model="query"
      :placeholder="placeholder"
      :class="cn('w-full', monospace ? 'font-mono' : '')"
      :disabled="disabled"
      @focus="onFocus"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <div
      v-if="open"
      class="absolute left-0 right-0 top-full mt-2 rounded-xl border border-border bg-background/95 text-foreground shadow-lg outline-none overflow-hidden z-20"
    >
      <div v-if="panelTitle" class="px-3 py-2 border-b border-border/40 text-xs font-semibold text-foreground">
        {{ panelTitle }}
      </div>

      <div class="max-h-64 overflow-auto p-1">
        <button
          v-if="canOfferCustom"
          type="button"
          class="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-secondary/40"
          @mousedown.prevent
          @click="addCustom"
        >
          <span class="text-xs truncate">Use "{{ query.trim() }}"</span>
        </button>

        <div v-if="canOfferCustom" class="h-px bg-border/40 my-1" />

        <button
          v-for="opt in showOptions"
          :key="opt.value"
          type="button"
          class="w-full flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-secondary/40 disabled:opacity-50 disabled:pointer-events-none"
          :disabled="opt.disabled"
          @mousedown.prevent
          @click="chooseOption(opt.value)"
        >
          <span class="min-w-0">
            <span class="block text-xs truncate" :class="monospace ? 'font-mono' : ''">{{ optionLabel(opt) }}</span>
            <span v-if="opt.description" class="block text-[11px] text-muted-foreground truncate">{{
              opt.description
            }}</span>
          </span>
          <RiCheckLine v-if="selectedSet.has(opt.value)" class="h-4 w-4 text-primary flex-shrink-0" />
        </button>

        <div v-if="isTruncated" class="px-3 py-2 text-[11px] text-muted-foreground">
          Type to search. Showing {{ showOptions.length }} of {{ filteredOptions.length }}.
        </div>
        <div v-else-if="q && filteredOptions.length === 0" class="px-3 py-3 text-xs text-muted-foreground">
          No matches.
        </div>
      </div>
    </div>
  </div>
</template>
