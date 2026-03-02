<script setup lang="ts">
import { RiAddLine, RiCloseLine, RiRefreshLine, RiSearchLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import SidebarPager from '@/layout/chatSidebar/components/SidebarPager.vue'

const { t } = useI18n()

const props = defineProps<{
  directoryPage: number
  directoryPageCount: number
  directoryPaging?: boolean
  sessionsLoading: boolean
  query: string
  isMobilePointer?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'submit-query'): void
  (e: 'update:directoryPage', v: number): void
  (e: 'add-directory'): void
  (e: 'refresh'): void
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
      </div>
    </div>
  </div>

  <div class="px-3 py-2 flex-shrink-0">
    <div class="relative">
      <button
        type="button"
        class="absolute left-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 transition hover:bg-primary/6 hover:text-foreground dark:hover:bg-accent/40"
        :aria-label="String(t('common.search'))"
        :title="String(t('common.search'))"
        @click="emit('submit-query')"
      >
        <RiSearchLine class="h-4 w-4" />
      </button>
      <Input
        :model-value="query"
        @update:model-value="(v) => emit('update:query', String(v || ''))"
        @keydown.enter.prevent="emit('submit-query')"
        :placeholder="String(t('chat.sidebar.header.searchPlaceholder'))"
        class="h-8 pl-8 pr-7 text-xs"
        :aria-label="String(t('chat.sidebar.header.searchAria'))"
      />
      <IconButton
        v-if="query.trim()"
        size="xs"
        class="absolute right-1 top-1/2 -translate-y-1/2"
        :tooltip="String(t('common.clear'))"
        :is-mobile-pointer="Boolean(props.isMobilePointer)"
        :aria-label="String(t('chat.sidebar.header.clearSearch'))"
        :title="String(t('common.clear'))"
        @click="
          () => {
            emit('update:query', '')
            emit('submit-query')
          }
        "
      >
        <RiCloseLine class="h-4 w-4" />
      </IconButton>
    </div>
  </div>
</template>
