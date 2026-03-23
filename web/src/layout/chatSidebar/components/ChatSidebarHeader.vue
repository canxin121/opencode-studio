<script setup lang="ts">
import { RiAddLine, RiCloseLine, RiListCheck3, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import IconButton from '@/components/ui/IconButton.vue'
import SearchInput from '@/components/ui/SearchInput.vue'
import SidebarPager from '@/layout/chatSidebar/components/SidebarPager.vue'

const { t } = useI18n()

const props = defineProps<{
  directoryPage: number
  directoryPageCount: number
  directoryPaging?: boolean
  sessionsLoading: boolean
  query: string
  isMobilePointer?: boolean
  multiSelectEnabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'submit-query'): void
  (e: 'update:directoryPage', v: number): void
  (e: 'add-directory'): void
  (e: 'refresh'): void
  (e: 'toggle-multi-select'): void
}>()
</script>

<template>
  <div class="h-9 pt-1 select-none pl-3.5 pr-2 flex-shrink-0">
    <div class="flex h-full items-center justify-between gap-2">
      <div class="min-w-0 flex items-center gap-2">
        <p class="typography-ui-label font-medium text-muted-foreground">
          {{ t('chat.sidebar.header.directoriesTitle') }}
        </p>
      </div>

      <div class="flex items-center gap-1">
        <SidebarPager
          v-if="directoryPageCount > 1"
          size="md"
          :page="directoryPage"
          :page-count="directoryPageCount"
          :disabled="Boolean(directoryPaging)"
          :prev-label="String(t('chat.sidebar.header.prevPage'))"
          :next-label="String(t('chat.sidebar.header.nextPage'))"
          @update:page="(v) => emit('update:directoryPage', v)"
        />

        <IconButton
          :tooltip="String(t('chat.sidebar.header.addDirectory'))"
          :is-mobile-pointer="Boolean(props.isMobilePointer)"
          :title="String(t('chat.sidebar.header.addDirectory'))"
          @click="emit('add-directory')"
        >
          <RiAddLine class="h-4 w-4" />
        </IconButton>

        <IconButton
          :tooltip="String(t('chat.sidebar.header.refresh'))"
          :is-mobile-pointer="Boolean(props.isMobilePointer)"
          :title="String(t('chat.sidebar.header.refresh'))"
          :disabled="sessionsLoading"
          @click="emit('refresh')"
        >
          <RiRefreshLine class="h-4 w-4" />
        </IconButton>

        <IconButton
          :tooltip="
            String(
              props.multiSelectEnabled
                ? t('chat.sidebar.multiSelect.actions.exitMultiSelect')
                : t('chat.sidebar.multiSelect.actions.enterMultiSelect'),
            )
          "
          :is-mobile-pointer="Boolean(props.isMobilePointer)"
          :title="
            String(
              props.multiSelectEnabled
                ? t('chat.sidebar.multiSelect.actions.exitMultiSelect')
                : t('chat.sidebar.multiSelect.actions.enterMultiSelect'),
            )
          "
          :aria-label="
            String(
              props.multiSelectEnabled
                ? t('chat.sidebar.multiSelect.actions.exitMultiSelect')
                : t('chat.sidebar.multiSelect.actions.enterMultiSelect'),
            )
          "
          :class="props.multiSelectEnabled ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''"
          @click="emit('toggle-multi-select')"
        >
          <RiCloseLine v-if="props.multiSelectEnabled" class="h-4 w-4" />
          <RiListCheck3 v-else class="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>

  <div class="px-3 py-2 flex-shrink-0">
    <SearchInput
      :model-value="query"
      @update:model-value="(v) => emit('update:query', String(v || ''))"
      @search="emit('submit-query')"
      @clear="emit('submit-query')"
      :placeholder="String(t('chat.sidebar.header.searchPlaceholder'))"
      class="text-xs"
      input-class="h-8 text-xs"
      :input-aria-label="String(t('chat.sidebar.header.searchAria'))"
      :input-title="String(t('chat.sidebar.header.searchAria'))"
      :search-aria-label="String(t('common.search'))"
      :search-title="String(t('common.search'))"
      :clear-aria-label="String(t('chat.sidebar.header.clearSearch'))"
      :clear-title="String(t('common.clear'))"
      :is-mobile-pointer="Boolean(props.isMobilePointer)"
    />
  </div>
</template>
