<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { RiArrowDownSLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import { cn } from '@/lib/utils'

export type PickerOption = {
  value: string
  label?: string
  description?: string
  disabled?: boolean
}

type OptionMenuExpose = {
  containsTarget?: (target: Node | null) => boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: PickerOption[]
    title?: string
    emptyLabel?: string
    includeEmpty?: boolean
    emptyDisabled?: boolean
    searchPlaceholder?: string
    placeholder?: string
    allowCustom?: boolean
    monospace?: boolean
    disabled?: boolean
    size?: 'default' | 'sm'
    triggerClass?: string
    icon?: Component
    maxInitialOptions?: number
    desktopFixed?: boolean
    isMobilePointer?: boolean
  }>(),
  {
    emptyLabel: 'Auto (OpenCode default)',
    includeEmpty: true,
    emptyDisabled: false,
    searchPlaceholder: 'Search...',
    placeholder: 'Select...',
    allowCustom: false,
    monospace: false,
    disabled: false,
    size: 'default',
    triggerClass: '',
    maxInitialOptions: 60,
    desktopFixed: true,
    isMobilePointer: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()

const triggerEl = ref<HTMLElement | null>(null)
const menuRef = ref<OptionMenuExpose | null>(null)
const open = ref(false)
const query = ref('')

const selected = computed(() => String(props.modelValue || '').trim())
const q = computed(() => query.value.trim().toLowerCase())

const effectiveSearchPlaceholder = computed(() => {
  const raw = String(props.searchPlaceholder || '').trim()
  if (!raw || raw === 'Search...') return t('common.optionPicker.searchPlaceholder')
  return raw
})

const selectedDisplayLabel = computed(() => {
  if (!selected.value) {
    const placeholder = String(props.placeholder || '').trim()
    const emptyLabel = String(props.emptyLabel || '').trim()
    const effectivePlaceholder =
      !placeholder || placeholder === 'Select...' ? t('common.optionPicker.selectPlaceholder') : placeholder
    const effectiveEmptyLabel =
      !emptyLabel || emptyLabel === 'Auto (OpenCode default)' ? t('chat.composer.model.autoDefault') : emptyLabel
    if (!props.includeEmpty) return effectivePlaceholder
    return effectiveEmptyLabel || effectivePlaceholder
  }

  const opt = (Array.isArray(props.options) ? props.options : []).find((o) => o.value === selected.value)
  if (opt) return optionLabel(opt)
  return selected.value
})

const filteredOptions = computed(() => {
  const qq = q.value
  if (!qq) return props.options
  return props.options.filter((opt) => {
    const hay = `${opt.value} ${opt.label || ''} ${opt.description || ''}`.toLowerCase()
    return hay.includes(qq)
  })
})

const showOptions = computed(() => {
  if (q.value) return filteredOptions.value
  return filteredOptions.value.slice(0, Math.max(0, props.maxInitialOptions))
})

const isTruncated = computed(() => !q.value && filteredOptions.value.length > showOptions.value.length)

const canOfferCustom = computed(() => {
  if (!props.allowCustom) return false
  const raw = query.value.trim()
  if (!raw) return false
  return !props.options.some((o) => o.value === raw)
})

const helperText = computed(() => {
  if (isTruncated.value) {
    return t('common.optionPicker.truncatedHelper', {
      shown: showOptions.value.length,
      total: filteredOptions.value.length,
    })
  }
  return ''
})

const emptyText = computed(() => {
  if (canOfferCustom.value) return t('common.optionPicker.emptyNoPresetMatches')
  return t('common.optionPicker.emptyNoMatches')
})

const menuGroups = computed<OptionMenuGroup[]>(() => {
  const groups: OptionMenuGroup[] = []

  if (props.includeEmpty) {
    groups.push({
      id: 'default',
      items: [
        {
          id: '__empty__',
          label: props.emptyLabel,
          checked: !selected.value,
          disabled: props.emptyDisabled,
          keywords: 'auto default',
          description: '',
        },
      ],
    })
  }

  if (canOfferCustom.value) {
    groups.push({
      id: 'custom',
      title: t('common.optionPicker.customGroupTitle'),
      items: [
        {
          id: '__custom__',
          label: t('common.optionPicker.useValue', { value: query.value.trim() }),
          description: t('common.optionPicker.setCustomValue'),
          keywords: query.value,
          monospace: props.monospace,
        },
      ],
    })
  }

  groups.push({
    id: 'options',
    items: showOptions.value.map((opt) => ({
      id: `opt:${opt.value}`,
      label: optionLabel(opt),
      description: opt.description,
      checked: opt.value === selected.value,
      disabled: opt.disabled,
      keywords: `${opt.value} ${opt.label || ''} ${opt.description || ''}`,
      monospace: props.monospace,
    })),
  })

  return groups
})

let pointerHandler: ((event: MouseEvent | TouchEvent) => void) | null = null

function handleOutsidePointer(event: MouseEvent | TouchEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (menuRef.value?.containsTarget?.(target)) return
  if (triggerEl.value && triggerEl.value.contains(target)) return
  open.value = false
}

watch(open, (isOpen) => {
  if (!isOpen) {
    query.value = ''
    if (pointerHandler) {
      document.removeEventListener('pointerdown', pointerHandler, true)
      pointerHandler = null
    }
    return
  }

  if (!pointerHandler) {
    pointerHandler = (event) => handleOutsidePointer(event)
    document.addEventListener('pointerdown', pointerHandler, true)
  }
})

onBeforeUnmount(() => {
  if (pointerHandler) {
    document.removeEventListener('pointerdown', pointerHandler, true)
    pointerHandler = null
  }
})

function choose(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function chooseCustom() {
  const raw = query.value.trim()
  if (!raw) return
  choose(raw)
}

function handleSelect(item: OptionMenuItem) {
  if (item.id === '__empty__') {
    choose('')
    return
  }
  if (item.id === '__custom__') {
    chooseCustom()
    return
  }
  if (item.id.startsWith('opt:')) {
    choose(item.id.slice(4))
  }
}

function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
}

function setOpen(value: boolean) {
  open.value = value
}

function setQuery(value: string) {
  query.value = String(value || '')
}

const triggerClasses = computed(() => {
  const base =
    'w-full inline-flex items-center justify-between gap-2 rounded-md border border-input bg-transparent shadow-sm transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]'
  const size = props.size === 'sm' ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-sm'
  return cn(base, size, props.triggerClass)
})

const triggerValueClasses = computed(() =>
  cn('min-w-0 truncate', props.monospace ? 'font-mono font-medium' : 'font-medium'),
)

function optionLabel(opt: PickerOption): string {
  return (opt.label || opt.value || '').trim()
}
</script>

<template>
  <div class="relative min-w-0">
    <button
      ref="triggerEl"
      type="button"
      :disabled="disabled"
      :class="triggerClasses"
      @mousedown.prevent
      @click.stop="toggleOpen"
    >
      <span class="min-w-0 flex items-center gap-2">
        <component v-if="icon" :is="icon" class="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span :class="triggerValueClasses">
          {{ selectedDisplayLabel }}
        </span>
      </span>
      <RiArrowDownSLine class="h-4 w-4 text-muted-foreground/70 flex-shrink-0" />
    </button>

    <OptionMenu
      ref="menuRef"
      :open="open"
      :query="query"
      :groups="menuGroups"
      :title="title"
      :searchable="true"
      :search-placeholder="effectiveSearchPlaceholder"
      :empty-text="emptyText"
      :helper-text="helperText"
      :is-mobile-pointer="isMobilePointer"
      :desktop-fixed="desktopFixed"
      :desktop-anchor-el="desktopFixed ? triggerEl : null"
      desktop-placement="bottom-start"
      desktop-class="w-[min(420px,calc(100vw-2rem))]"
      filter-mode="external"
      @update:open="setOpen"
      @update:query="setQuery"
      @select="handleSelect"
    />
  </div>
</template>
