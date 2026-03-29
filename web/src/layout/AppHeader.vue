<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RiArrowLeftSLine, RiPlayListAddLine, RiQuestionLine, RiMapPin2Line, RiSettings3Line } from '@remixicon/vue'
import { cn } from '@/lib/utils'
import { MAIN_TABS, isWorkspaceMainTabPath, mainTabFromPath } from '@/app/navigation/mainTabs'
import { useUiStore } from '@/stores/ui'
import { useHealthStore } from '@/stores/health'
import { useChatStore } from '@/stores/chat'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

import IconButton from '@/components/ui/IconButton.vue'

const ui = useUiStore()
const health = useHealthStore()
const chat = useChatStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// -- Layout & Resizing --
const headerRef = ref<HTMLElement | null>(null)
const updateHeaderHeight = () => {
  if (!headerRef.value) return
  const h = Math.round(headerRef.value.getBoundingClientRect().height)
  document.documentElement.style.setProperty('--oc-header-height', `${Math.max(0, h)}px`)
}
let ro: ResizeObserver | null = null

onMounted(() => {
  updateHeaderHeight()
  if (typeof ResizeObserver !== 'undefined' && headerRef.value) {
    ro = new ResizeObserver(updateHeaderHeight)
    ro.observe(headerRef.value)
  }
  window.addEventListener('resize', updateHeaderHeight)
  window.addEventListener('orientationchange', updateHeaderHeight)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', updateHeaderHeight)
  window.removeEventListener('orientationchange', updateHeaderHeight)
})

function mainTabRoute(path: string): string {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath) return '/chat'
  return normalizedPath
}

// Sync Route -> UI Store (for mobile title / persistence + workspace windows)
watch(
  () => ({ path: route.path, query: route.query }),
  ({ path, query }) => {
    const normalized = String(path || '').toLowerCase()
    if (!isWorkspaceMainTabPath(normalized)) return

    const next = mainTabFromPath(normalized)
    ui.syncActiveWorkspaceWindowFromRoute(next, query)
  },
  { immediate: true, deep: true },
)

const mobileTitle = computed(() => {
  const panelMap: Record<string, string> = {
    settings: String(t('nav.settings')),
    sessions: String(t('nav.chat')),
    files: String(t('nav.files')),
    preview: String(t('nav.preview')),
    terminal: String(t('nav.terminal')),
    git: String(t('nav.git')),
  }
  const panel = String(route.meta?.mobilePanel || '')
    .trim()
    .toLowerCase()
  if (panelMap[panel]) return panelMap[panel]

  const tabMap: Record<string, string> = {
    chat: String(t('nav.chat')),
    diff: String(t('nav.diff')),
    files: String(t('nav.files')),
    preview: String(t('nav.preview')),
    terminal: String(t('nav.terminal')),
    git: String(t('nav.git')),
  }
  return tabMap[String(ui.activeMainTab || '')] || String(t('app.title'))
})

const mobilePanelToggleLabel = computed(() => {
  if (ui.isSessionSwitcherOpen) return String(t('nav.back'))
  const panel = String(route.meta?.mobilePanel || '')
    .trim()
    .toLowerCase()
  if (panel === 'files') return String(t('header.openFilesPanel'))
  if (panel === 'preview') return String(t('header.openPreviewPanel'))
  if (panel === 'terminal') return String(t('header.openTerminalPanel'))
  if (panel === 'git') return String(t('header.openSourceControlPanel'))
  if (panel === 'settings') return String(t('header.openSettingsPanel'))
  return String(t('header.openSessions'))
})

// -- Keyboard Shortcuts (Cmd+1..4) --
function hasModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}

let keyHandler: ((e: KeyboardEvent) => void) | null = null

onMounted(() => {
  keyHandler = (e: KeyboardEvent) => {
    if (!hasModifier(e) || e.shiftKey || e.altKey) return
    const num = Number.parseInt(e.key, 10)
    if (!Number.isFinite(num)) return

    if (num < 1 || num > MAIN_TABS.length) return

    e.preventDefault()
    const tab = MAIN_TABS[num - 1]
    if (tab) {
      router.push(mainTabRoute(tab.path))
    }
  }
  window.addEventListener('keydown', keyHandler)
})

onBeforeUnmount(() => {
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
})

// -- Actions --
function handleOpenSessionSwitcher() {
  if (ui.isCompactLayout) {
    // Blur active element to close mobile keyboard
    const active = document.activeElement as HTMLElement | null
    if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) {
      active.blur()
    }
    ui.setSessionSwitcherOpen(!ui.isSessionSwitcherOpen)
    return
  }
  ui.toggleSidebar()
}

const SETTINGS_LAST_ROUTE_KEY = localStorageKeys.settings.lastRoute

function getRememberedSettingsRoute(): string {
  try {
    const raw = String(localStorage.getItem(SETTINGS_LAST_ROUTE_KEY) || '').trim()
    if (raw.startsWith('/settings/plan')) {
      return `/settings/plugins${raw.slice('/settings/plan'.length)}`
    }
    if (raw.startsWith('/settings')) return raw
  } catch {
    // ignore
  }
  return '/settings/opencode/general'
}

function openSettings() {
  ui.setSessionSwitcherOpen(false)
  if (!ui.isCompactLayout) {
    ui.setSidebarOpen(true, { preserveWidth: true })
  }
  router.push(getRememberedSettingsRoute())
}

function locateCurrentSessionInSidebar() {
  const sid = (chat.selectedSessionId || '').trim()
  if (!sid) return
  ui.openAndLocateSessionInSidebar(sid)
  if (
    !String(route.path || '')
      .trim()
      .toLowerCase()
      .startsWith('/chat')
  ) {
    void router.push('/chat')
  }
}

function openHelpDialog() {
  ui.toggleHelpDialog()
}
</script>

<template>
  <header
    ref="headerRef"
    :class="
      ui.isCompactLayout
        ? 'header-safe-area border-b border-border/50 relative z-20 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75'
        : 'hidden'
    "
  >
    <div class="app-region-no-drag flex items-center gap-2 px-3 h-12">
      <!-- Sidebar Toggle / Mobile Back -->
      <IconButton
        size="lg"
        :tooltip="ui.isCompactLayout ? mobilePanelToggleLabel : String(t('header.toggleSidebar'))"
        :is-touch-pointer="ui.isTouchPointer"
        :aria-label="ui.isCompactLayout ? mobilePanelToggleLabel : String(t('header.toggleSidebar'))"
        @click="handleOpenSessionSwitcher"
      >
        <component :is="ui.isSessionSwitcherOpen ? RiArrowLeftSLine : RiPlayListAddLine" class="h-5 w-5" />
      </IconButton>

      <div class="min-w-0 flex-1">
        <div class="typography-ui-label font-semibold truncate">{{ mobileTitle }}</div>
      </div>

      <!-- Right Actions -->
      <div class="flex items-center pr-1">
        <!-- Connection Status -->
        <span
          class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full"
          :title="health.openCodeConnected ? String(t('header.status.online')) : String(t('header.status.offline'))"
          :aria-label="String(t('header.connectionStatus'))"
        >
          <span
            :class="cn('inline-flex h-2 w-2 rounded-full', health.openCodeConnected ? 'bg-emerald-500' : 'bg-rose-500')"
          />
        </span>

        <div class="flex items-center gap-1">
          <IconButton
            size="lg"
            :tooltip="String(t('header.help'))"
            :is-touch-pointer="ui.isTouchPointer"
            :aria-label="String(t('header.help'))"
            :title="String(t('header.help'))"
            @click="openHelpDialog"
          >
            <RiQuestionLine class="h-5 w-5" />
          </IconButton>

          <IconButton
            v-if="chat.selectedSessionId"
            size="lg"
            :tooltip="String(t('header.locateSession'))"
            :is-touch-pointer="ui.isTouchPointer"
            :aria-label="String(t('header.locateCurrentSession'))"
            :title="String(t('header.locateSession'))"
            @click="locateCurrentSessionInSidebar"
          >
            <RiMapPin2Line class="h-5 w-5" />
          </IconButton>

          <IconButton
            size="lg"
            :tooltip="String(t('nav.settings'))"
            :is-touch-pointer="ui.isTouchPointer"
            :aria-label="String(t('nav.settings'))"
            @click="openSettings"
          >
            <RiSettings3Line class="h-5 w-5" />
          </IconButton>
        </div>
      </div>
    </div>
  </header>
</template>
