<script setup lang="ts">
import { computed, type Component } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RiChat4Line, RiFolder6Line, RiTerminalBoxLine, RiGitMergeLine } from '@remixicon/vue'
import { cn } from '@/lib/utils'
import { MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'

const route = useRoute()
const { t } = useI18n()

const TAB_ICONS: Record<MainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
}

const items = computed(() =>
  MAIN_TABS.map((tab) => ({
    to: tab.path,
    label: String(t(tab.labelKey)),
    icon: TAB_ICONS[tab.id],
  })),
)

function isActive(path: string) {
  return route.path.startsWith(path)
}
</script>

<template>
  <nav
    class="oc-bottom-nav fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border pb-[env(safe-area-inset-bottom)]"
    :aria-label="String(t('aria.primaryNavigation'))"
  >
    <div class="grid grid-cols-4 h-[56px]">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="
          cn(
            'flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform',
            isActive(item.to) ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )
        "
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <component :is="item.icon" class="w-5 h-5" />
        <span class="text-[10px] font-medium">{{ item.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
