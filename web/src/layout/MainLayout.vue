<script setup lang="ts">
import ToastHost from '@/components/ToastHost.vue'
import HelpDialog from '@/components/HelpDialog.vue'
import McpDialog from '@/components/McpDialog.vue'
import AppHeader from '@/layout/AppHeader.vue'
import ChatSidebar from '@/layout/ChatSidebar.vue'
import BottomNav from '@/layout/BottomNav.vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useUiStore } from '@/stores/ui'
import { useAppRuntime } from '@/app/runtime/useAppRuntime'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'

const ui = useUiStore()
const route = useRoute()
const { startDesktopSidebarResize } = useDesktopSidebarResize()
useAppRuntime()

const usesChatShellSidebar = computed(() => {
  const shellSidebar = String(route.meta?.shellSidebar || '').trim().toLowerCase()
  if (shellSidebar === 'chat') return true
  if (shellSidebar === 'none') return false
  return String(route.path || '').toLowerCase().startsWith('/chat')
})

const mobileBottomNavInset =
  'calc(var(--oc-bottom-nav-height, 56px) + var(--oc-safe-area-bottom, 0px) - clamp(0px, var(--oc-keyboard-inset, 0px), var(--oc-bottom-nav-height, 56px)))'

</script>

<template>
  <div class="main-content-safe-area relative h-[100dvh] bg-background text-foreground overflow-hidden flex flex-col">
    <ToastHost />
    <HelpDialog />
    <McpDialog />

    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader />

      <div class="flex flex-1 overflow-hidden">
        <aside
          v-if="!ui.isMobile && usesChatShellSidebar"
          class="relative h-full overflow-hidden border-r border-border bg-sidebar"
          :style="{ width: `${ui.effectiveSidebarWidth}px` }"
          :aria-hidden="!ui.isSidebarOpen"
        >
          <div
            v-if="ui.isSidebarOpen"
            class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40"
            @pointerdown="startDesktopSidebarResize"
          />

          <div class="h-full"><ChatSidebar v-if="ui.isSidebarOpen" /></div>
        </aside>

        <div class="relative flex-1 h-full overflow-hidden">
          <div
            v-if="ui.isMobile && usesChatShellSidebar"
            class="absolute inset-x-0 top-0 z-20 bg-sidebar"
            :class="ui.isSessionSwitcherOpen ? '' : 'pointer-events-none opacity-0'"
            :style="{ bottom: mobileBottomNavInset }"
            :aria-hidden="!ui.isSessionSwitcherOpen"
          >
            <ChatSidebar mobile-variant />
          </div>

          <main
            class="h-full overflow-hidden"
            :style="
              ui.isMobile
                ? {
                    paddingBottom: mobileBottomNavInset,
                  }
                : undefined
            "
          >
            <router-view />
          </main>
        </div>
      </div>

      <BottomNav v-if="ui.isMobile" />
    </div>
  </div>
</template>
