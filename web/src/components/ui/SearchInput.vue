<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { useVModel } from '@vueuse/core'
import { RiCloseLine, RiSearchLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import { cn } from '@/lib/utils'

interface Props {
  modelValue?: string
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  showSearchButton?: boolean
  showClearButton?: boolean
  searchDisabled?: boolean
  clearDisabled?: boolean
  class?: HTMLAttributes['class']
  inputClass?: HTMLAttributes['class']
  searchButtonClass?: HTMLAttributes['class']
  clearButtonClass?: HTMLAttributes['class']
  inputAriaLabel?: string
  inputTitle?: string
  searchAriaLabel?: string
  searchTitle?: string
  clearAriaLabel?: string
  clearTitle?: string
  isTouchPointer?: boolean
  isMobilePointer?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  defaultValue: '',
  placeholder: '',
  disabled: false,
  showSearchButton: true,
  showClearButton: true,
  searchDisabled: false,
  clearDisabled: false,
  inputAriaLabel: 'Search',
  inputTitle: 'Search',
  searchAriaLabel: 'Search',
  searchTitle: 'Search',
  clearAriaLabel: 'Clear search',
  clearTitle: 'Clear',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search', value: string): void
  (e: 'clear'): void
}>()

const value = useVModel(props, 'modelValue', emit, {
  passive: true,
  defaultValue: props.defaultValue,
})

const hasValue = computed(() => String(value.value || '').length > 0)
const isTouchPointer = computed(() => props.isTouchPointer ?? props.isMobilePointer)

function triggerSearch() {
  if (props.disabled || props.searchDisabled) return
  emit('search', String(value.value || ''))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  triggerSearch()
}

function clearValue() {
  if (props.disabled || props.clearDisabled) return
  if (!hasValue.value) return
  value.value = ''
  emit('clear')
}

const inputClasses = computed(() => {
  const rightButtonsCount = (props.showSearchButton ? 1 : 0) + (props.showClearButton && hasValue.value ? 1 : 0)

  return cn(rightButtonsCount === 1 ? 'pr-8' : '', rightButtonsCount === 2 ? 'pr-14' : '', props.inputClass)
})
</script>

<template>
  <div :class="cn('relative', props.class)">
    <Input
      v-model="value"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="inputAriaLabel"
      :title="inputTitle"
      :class="inputClasses"
      @keydown="onKeydown"
    />

    <IconButton
      v-if="showClearButton && hasValue"
      size="xs"
      variant="ghost"
      :class="
        cn(
          'absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:bg-secondary/60 hover:text-foreground',
          props.showSearchButton ? 'right-8' : 'right-1',
          props.clearButtonClass,
        )
      "
      :disabled="disabled || clearDisabled"
      :is-touch-pointer="isTouchPointer"
      :aria-label="clearAriaLabel"
      :title="clearTitle"
      :tooltip="clearTitle"
      @click="clearValue"
    >
      <RiCloseLine class="h-4 w-4" />
    </IconButton>

    <IconButton
      v-if="showSearchButton"
      size="xs"
      variant="ghost"
      class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:bg-secondary/60 hover:text-foreground"
      :disabled="disabled || searchDisabled"
      :is-touch-pointer="isTouchPointer"
      :aria-label="searchAriaLabel"
      :title="searchTitle"
      :tooltip="searchTitle"
      @click="triggerSearch"
    >
      <RiSearchLine class="h-4 w-4" />
    </IconButton>
  </div>
</template>
