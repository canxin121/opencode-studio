<script setup lang="ts">
import HelpDialog from '@/components/HelpDialog.vue'
import McpDialog from '@/components/McpDialog.vue'
import AppHeader from '@/layout/AppHeader.vue'
import ChatSidebar from '@/layout/ChatSidebar.vue'
import BottomNav from '@/layout/BottomNav.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useUiStore } from '@/stores/ui'
import { useAppRuntime } from '@/app/runtime/useAppRuntime'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'

const ui = useUiStore()
const route = useRoute()
const { startDesktopSidebarResize } = useDesktopSidebarResize()
useAppRuntime()

const usesChatShellSidebar = computed(() => {
  const shellSidebar = String(route.meta?.shellSidebar || '')
    .trim()
    .toLowerCase()
  if (shellSidebar === 'chat') return true
  if (shellSidebar === 'none') return false
  return String(route.path || '')
    .toLowerCase()
    .startsWith('/chat')
})

const mobileSidebarPointerReady = ref(false)
let mobileSidebarPointerRafA: number | null = null
let mobileSidebarPointerRafB: number | null = null

function clearMobileSidebarPointerRafs() {
  if (mobileSidebarPointerRafA !== null) {
    window.cancelAnimationFrame(mobileSidebarPointerRafA)
    mobileSidebarPointerRafA = null
  }
  if (mobileSidebarPointerRafB !== null) {
    window.cancelAnimationFrame(mobileSidebarPointerRafB)
    mobileSidebarPointerRafB = null
  }
}

watch(
  () => ({
    isMobile: ui.isMobile,
    switcherOpen: ui.isSessionSwitcherOpen,
    usesChatShellSidebar: usesChatShellSidebar.value,
  }),
  ({ isMobile, switcherOpen, usesChatShellSidebar: usesSidebar }) => {
    clearMobileSidebarPointerRafs()
    if (!isMobile || !usesSidebar || !switcherOpen) {
      mobileSidebarPointerReady.value = false
      return
    }

    mobileSidebarPointerReady.value = false
    mobileSidebarPointerRafA = window.requestAnimationFrame(() => {
      mobileSidebarPointerRafA = null
      mobileSidebarPointerRafB = window.requestAnimationFrame(() => {
        mobileSidebarPointerRafB = null
        mobileSidebarPointerReady.value = true
      })
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearMobileSidebarPointerRafs()
})

// Mobile UX: navigating should switch focus to main content.
// The same store flag is used as a "sidebar" across mobile panels (sessions, terminal, etc).
watch(
  () => route.fullPath,
  (next, prev) => {
    if (!ui.isMobile) return
    if (!ui.isSessionSwitcherOpen) return
    if (next === prev) return
    ui.setSessionSwitcherOpen(false)
  },
)

const mobileBottomNavInset =
  'calc(var(--oc-bottom-nav-height, 56px) + var(--oc-safe-area-bottom, 0px) - clamp(0px, var(--oc-keyboard-inset, 0px), var(--oc-bottom-nav-height, 56px)))'
</script>

<template>
  <div class="main-content-safe-area relative h-[100dvh] bg-background text-foreground overflow-hidden flex flex-col">
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
            class="absolute inset-x-0 top-0 z-40 bg-sidebar"
            :class="
              ui.isSessionSwitcherOpen
                ? mobileSidebarPointerReady
                  ? ''
                  : 'pointer-events-none'
                : 'pointer-events-none opacity-0'
            "
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
