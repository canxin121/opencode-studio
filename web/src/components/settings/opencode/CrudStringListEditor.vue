<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { RiAddLine, RiCloseLine, RiDeleteBinLine, RiPencilLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import InlineSearchAdd from '@/components/ui/InlineSearchAdd.vue'
import Input from '@/components/ui/Input.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'

import { normalizeStringList, removeFromList, splitTags } from '../OpenCodeConfigPanelListUtils'

type SplitMode = 'tags' | 'lines'

const { t } = useI18n()

// NOTE: This component intentionally does NOT support a raw-text list editor.
const props = withDefaults(
  defineProps<{
    modelValue?: string[] | null
    suggestions?: Array<string | PickerOption>
    placeholder?: string
    panelTitle?: string
    emptyText?: string

    showInlineAdder?: boolean
    showItemsPreview?: boolean
    splitMode?: SplitMode

    // New-ish behavior flags (optional):
    allowEdit?: boolean
    showFilter?: boolean
  }>(),
  {
    modelValue: () => [],
    suggestions: () => [],
    placeholder: '',
    panelTitle: '',
    emptyText: '',

    showInlineAdder: true,
    showItemsPreview: true,
    splitMode: 'tags',
    allowEdit: true,
    showFilter: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const items = computed(() => normalizeStringList(props.modelValue || []))

const filterQuery = ref('')
const qq = computed(() => filterQuery.value.trim().toLowerCase())

const filteredItems = computed(() => {
  const q = qq.value
  if (!q) return items.value
  return items.value.filter((v) => v.toLowerCase().includes(q))
})

const emptyTextLabel = computed(() => {
  const next = String(props.emptyText || '').trim()
  return next.length > 0 ? next : String(t('settings.opencodeConfig.sections.common.none'))
})

const itemsCountLabel = computed(() =>
  String(t('settings.opencodeConfig.stringListEditor.itemsCount', { count: items.value.length })),
)

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

const editId = ref<string | null>(null)
const editDraft = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

const adderQuery = ref('')

const shouldShowFilter = computed(() => Boolean(props.showFilter) || Boolean(qq.value) || items.value.length >= 12)

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

function addFromQuery() {
  const raw = adderQuery.value
  if (!raw.trim()) return
  addRaw(raw)
  adderQuery.value = ''
}

function removeItem(value: string) {
  if (editId.value === value) cancelEdit()
  setItems(removeFromList(items.value, value))
}

function removeLast() {
  if (!items.value.length) return
  const last = items.value[items.value.length - 1]
  removeItem(last)
}

function clearAll() {
  if (!items.value.length) return
  cancelEdit()
  setItems([])
}

function startEdit(value: string) {
  if (!props.allowEdit) return
  editId.value = value
  editDraft.value = value
  void nextTick(() => editInputRef.value?.focus())
}

function cancelEdit() {
  editId.value = null
  editDraft.value = ''
}

function saveEdit() {
  const id = editId.value
  if (!id) return
  const nextValue = editDraft.value.trim()
  // Disallow empty values; treat as cancel to avoid accidental deletion.
  if (!nextValue) {
    cancelEdit()
    return
  }

  const next = items.value.map((v) => (v === id ? nextValue : v))
  setItems(next)
  cancelEdit()
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    saveEdit()
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <div class="text-[11px] text-muted-foreground">
        <span v-if="items.length">{{ itemsCountLabel }}</span>
        <span v-else>{{ emptyTextLabel }}</span>
        <span v-if="qq && items.length" class="ml-2">({{ filteredItems.length }} / {{ items.length }})</span>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <IconButton
            :title="t('common.clear')"
            :aria-label="t('common.clear')"
            :disabled="items.length === 0"
            @click="clearAll"
          >
            <RiCloseLine class="h-4 w-4" />
          </IconButton>
          <template #content>{{ t('common.clear') }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="shouldShowFilter" class="max-w-sm">
      <Input v-model="filterQuery" :placeholder="t('common.search')" />
    </div>

    <div v-if="showItemsPreview" class="space-y-2">
      <div
        v-if="filteredItems.length === 0"
        class="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground"
      >
        {{ qq ? t('common.noOptionsFound') : emptyTextLabel }}
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="value in filteredItems"
          :key="`list-item:${value}`"
          class="flex items-center gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 hover:bg-muted/10"
        >
          <div class="min-w-0 flex-1">
            <div v-if="editId === value" class="flex items-center gap-2">
              <input
                ref="editInputRef"
                v-model="editDraft"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 font-mono text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                @keydown="onEditKeydown"
              />
              <Button
                size="sm"
                variant="outline"
                class="h-9"
                :title="t('common.save')"
                :aria-label="t('common.save')"
                @click="saveEdit"
              >
                {{ t('common.save') }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-9"
                :title="t('common.cancel')"
                :aria-label="t('common.cancel')"
                @click="cancelEdit"
              >
                {{ t('common.cancel') }}
              </Button>
            </div>
            <div v-else class="text-xs min-w-0">
              <slot name="item" :value="value">
                <span class="font-mono break-all">{{ value }}</span>
              </slot>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <Tooltip v-if="allowEdit && editId !== value">
              <IconButton
                size="sm"
                variant="ghost"
                class="h-8 w-8"
                :title="t('common.edit')"
                :aria-label="t('common.edit')"
                @click="startEdit(value)"
              >
                <RiPencilLine class="h-4 w-4" />
              </IconButton>
              <template #content>{{ t('common.edit') }}</template>
            </Tooltip>

            <Tooltip>
              <IconButton
                size="sm"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('common.remove')"
                @click="removeItem(value)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </IconButton>
              <template #content>{{ t('common.remove') }}</template>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showInlineAdder" class="flex items-center gap-2">
      <InlineSearchAdd
        v-model="adderQuery"
        :options="pickerOptions"
        :panel-title="panelTitle"
        :placeholder="placeholder"
        monospace
        :selected-values="items"
        @add="addRaw"
        @remove="removeItem"
        @backspace-empty="removeLast"
      />
      <IconButton
        variant="outline"
        class="h-9 w-9"
        :disabled="!adderQuery.trim()"
        :title="t('common.add')"
        :aria-label="t('common.add')"
        @click="addFromQuery"
      >
        <RiAddLine class="h-4 w-4" />
      </IconButton>
      <slot name="adder-actions"></slot>
    </div>
  </div>
</template>
