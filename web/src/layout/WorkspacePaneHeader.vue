<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiChat4Line, RiFolder6Line, RiGitMergeLine, RiGlobalLine, RiTerminalBoxLine } from '@remixicon/vue'

import { MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import type { WorkspaceWindowTab } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    windowTab?: WorkspaceWindowTab | null
    fallbackTab?: MainTabId
  }>(),
  {
    windowTab: null,
    fallbackTab: 'chat',
  },
)

const { t } = useI18n()

const TAB_ICONS: Record<MainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  preview: RiGlobalLine,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
}

const TAB_LABEL_KEYS = MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.labelKey
    return acc
  },
  {} as Record<MainTabId, string>,
)

const resolvedTab = computed<MainTabId>(() => props.windowTab?.mainTab || props.fallbackTab)

const targetIcon = computed(() => TAB_ICONS[resolvedTab.value])

const targetTitle = computed(() => {
  const custom = String(props.windowTab?.title || '').trim()
  if (custom) return custom
  return String(t(TAB_LABEL_KEYS[resolvedTab.value]))
})

const targetSubtitle = computed(() => {
  const tabLabel = String(t(TAB_LABEL_KEYS[resolvedTab.value]))
  const query = props.windowTab?.routeQuery || {}
  const sid = String(query.sessionId || '').trim()
  if (!sid) return tabLabel
  return `${tabLabel} · ${sid.slice(0, 10)}`
})
</script>

<template>
  <div class="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
    <div class="min-w-0 flex items-center gap-2">
      <component :is="targetIcon" class="h-4 w-4 text-muted-foreground" />
      <div class="min-w-0">
        <div class="truncate text-xs font-semibold text-foreground">{{ targetTitle }}</div>
        <div v-if="targetSubtitle" class="truncate text-[10px] text-muted-foreground">{{ targetSubtitle }}</div>
      </div>
    </div>

    <div v-if="$slots.actions" class="flex items-center gap-1">
      <slot name="actions" />
    </div>
  </div>
</template>
