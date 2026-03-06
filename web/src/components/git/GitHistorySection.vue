<script setup lang="ts">
import { computed } from 'vue'
import { RiGitCommitLine, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'

import { formatDateTimeYMDHM } from '@/i18n/intl'
import type { GitLogCommit } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  expanded: boolean
  commits: GitLogCommit[]
  loading: boolean
  error: string | null
  hasMore: boolean
  selectedHash: string | null
  isMobilePointer: boolean
}>()

defineEmits<{
  (e: 'update:expanded', value: boolean): void
  (e: 'select', commit: GitLogCommit): void
  (e: 'refresh'): void
  (e: 'showMore'): void
  (e: 'openHistory'): void
}>()

const loadedCount = computed(() => {
  if (props.hasMore) return `${props.commits.length}+`
  return props.commits.length
})

function shortAuthor(name: string): string {
  const raw = (name || '').trim()
  return raw || t('common.unknown')
}

function formatDate(value: string): string {
  if (!value) return ''
  return formatDateTimeYMDHM(value)
}
</script>

<template>
  <div class="oc-vscode-section select-none">
    <SectionToggleButton
      :open="expanded"
      :label="t('git.ui.historySidebar.title')"
      :count="loadedCount"
      @toggle="$emit('update:expanded', !expanded)"
    >
      <template #actions>
        <SidebarIconButton
          size="sm"
          :tooltip="t('common.refresh')"
          :is-mobile-pointer="isMobilePointer"
          :aria-label="t('common.refresh')"
          @click.stop="$emit('refresh')"
        >
          <RiRefreshLine class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
        </SidebarIconButton>
        <SidebarIconButton
          size="sm"
          :tooltip="t('git.ui.historySidebar.openDetails')"
          :is-mobile-pointer="isMobilePointer"
          :aria-label="t('git.ui.historySidebar.openDetails')"
          @click.stop="$emit('openHistory')"
        >
          <RiGitCommitLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
      </template>
    </SectionToggleButton>

    <div v-if="expanded" class="space-y-0.5 px-1 pb-1">
      <div
        v-if="error"
        class="mx-1 rounded-sm border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive/90"
      >
        {{ error }}
      </div>

      <div v-else-if="loading && !commits.length" class="px-2 py-1.5 text-[11px] text-muted-foreground">
        {{ t('common.loading') }}
      </div>

      <div v-else-if="!commits.length" class="px-2 py-1.5 text-[11px] text-muted-foreground">
        {{ t('git.ui.historySidebar.empty') }}
      </div>

      <template v-else>
        <SidebarListItem
          v-for="commit in commits"
          :key="commit.hash"
          :active="selectedHash === commit.hash"
          class="py-1.5"
          @click="$emit('select', commit)"
        >
          <div class="min-w-0">
            <div
              class="truncate text-[11px] font-medium text-foreground"
              :title="commit.subject || t('git.ui.dialogs.history.noMessage')"
            >
              {{ commit.subject || t('git.ui.dialogs.history.noMessage') }}
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span class="font-mono">{{ commit.shortHash }}</span>
              <span class="truncate" :title="shortAuthor(commit.authorName)">{{ shortAuthor(commit.authorName) }}</span>
              <span v-if="commit.authorDate">{{ formatDate(commit.authorDate) }}</span>
            </div>
          </div>
        </SidebarListItem>

        <button
          v-if="hasMore"
          type="button"
          class="ml-2 rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
          :disabled="loading"
          @click="$emit('showMore')"
        >
          {{ t('git.ui.historySidebar.loadMore', { count: commits.length }) }}
        </button>
      </template>
    </div>
  </div>
</template>
