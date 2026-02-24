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
}>()

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'update:directoryPage', v: number): void
  (e: 'add-directory'): void
  (e: 'refresh'): void
}>()
</script>

<template>
  <div class="h-9 pt-1 select-none pl-3.5 pr-2 flex-shrink-0">
    <div class="flex h-full items-center justify-between gap-2">
      <div class="min-w-0 flex items-center gap-2">
        <p class="typography-ui-label font-medium text-muted-foreground">{{ t('chat.sidebar.header.directoriesTitle') }}</p>
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

        <IconButton :title="String(t('chat.sidebar.header.addDirectory'))" @click="emit('add-directory')">
          <RiAddLine class="h-4 w-4" />
        </IconButton>

        <IconButton
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
      <RiSearchLine
        class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60"
      />
      <Input
        :model-value="query"
        @update:model-value="(v) => emit('update:query', String(v || ''))"
        :placeholder="String(t('chat.sidebar.header.searchPlaceholder'))"
        class="h-8 pl-7 pr-7 text-xs"
        :aria-label="String(t('chat.sidebar.header.searchAria'))"
      />
      <IconButton
        v-if="query.trim()"
        size="xs"
        class="absolute right-1 top-1/2 -translate-y-1/2"
        :aria-label="String(t('chat.sidebar.header.clearSearch'))"
        :title="String(t('common.clear'))"
        @click="emit('update:query', '')"
      >
        <RiCloseLine class="h-4 w-4" />
      </IconButton>
    </div>
  </div>
</template>
