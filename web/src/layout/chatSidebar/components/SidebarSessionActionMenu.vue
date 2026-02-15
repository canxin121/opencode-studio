<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'

import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import type { SessionActionItem } from '@/layout/chatSidebar/useSessionActionMenu'

const props = withDefaults(
  defineProps<{
    open: boolean
    query: string
    items: SessionActionItem[]
    setMenuRef: (el: Element | ComponentPublicInstance | null) => void
    anchorEl?: HTMLElement | null
    desktopPlacement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
    desktopClass?: string
  }>(),
  {
    anchorEl: null,
    desktopPlacement: 'bottom-start',
    desktopClass: 'w-64',
  },
)

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'select', item: SessionActionItem): void
}>()

const groups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'session-actions',
    items: props.items as OptionMenuItem[],
  },
])
</script>

<template>
  <OptionMenu
    :ref="setMenuRef"
    :open="open"
    :query="query"
    :groups="groups"
    :searchable="true"
    search-placeholder="Search actions"
    empty-text="No actions found."
    :is-mobile-pointer="false"
    :desktop-fixed="true"
    :desktop-anchor-el="anchorEl"
    :desktop-placement="desktopPlacement"
    :desktop-class="desktopClass"
    filter-mode="external"
    @update:query="(v) => emit('update:query', v)"
    @select="(item) => emit('select', item as SessionActionItem)"
  />
</template>
