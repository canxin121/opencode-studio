<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RiArrowLeftSLine,
  RiLayoutLeftLine,
  RiLayoutRightLine,
  RiPlayListAddLine,
  RiChat4Line,
  RiFolder6Line,
  RiGlobalLine,
  RiTerminalBoxLine,
  RiGitMergeLine,
  RiQuestionLine,
  RiMapPin2Line,
  RiSettings3Line,
} from '@remixicon/vue'
import { cn } from '@/lib/utils'
import { MAIN_TABS, isWorkspaceMainTabPath, mainTabFromPath, type NavigationMainTabId } from '@/app/navigation/mainTabs'
import { useUiStore } from '@/stores/ui'
import { useHealthStore } from '@/stores/health'
import { useDirectoryStore } from '@/stores/directory'
import { useChatStore } from '@/stores/chat'
import { apiJson } from '@/lib/api'
import type { GitStatusResponse } from '@/types/git'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

import IconButton from '@/components/ui/IconButton.vue'

type Tab = {
  id: NavigationMainTabId
  path: string
  label: string
  icon: Component
  badge?: number
  showDot?: boolean
}

const ui = useUiStore()
const health = useHealthStore()
const directoryStore = useDirectoryStore()
const chat = useChatStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// -- Layout & Resizing --
const headerRef = ref<HTMLElement | null>(null)
const updateHeaderHeight = () => {
  if (!headerRef.value) return
  const h = Math.round(headerRef.value.getBoundingClientRect().height)
  if (h > 0) {
    document.documentElement.style.setProperty('--oc-header-height', `${h}px`)
  }
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

// -- Git Status / Badge --
const diffFileCount = ref(0)
let diffTimer: number | null = null

async function refreshDiffFileCount() {
  const dir = directoryStore.currentDirectory
  if (!dir) {
    diffFileCount.value = 0
    return
  }
  try {
    const resp = await apiJson<Partial<GitStatusResponse>>(
      `/api/git/status?directory=${encodeURIComponent(dir)}&summary=true`,
    )
    if (typeof resp?.totalFiles === 'number') {
      diffFileCount.value = resp.totalFiles
      return
    }
    const files = Array.isArray(resp?.files) ? resp.files : []
    diffFileCount.value = files.length
  } catch {
    diffFileCount.value = 0
  }
}

onMounted(() => {
  void refreshDiffFileCount()
  diffTimer = window.setInterval(() => void refreshDiffFileCount(), 4000)
})

onBeforeUnmount(() => {
  if (diffTimer !== null) {
    window.clearInterval(diffTimer)
    diffTimer = null
  }
})

// -- Navigation Tabs --
const TAB_ICONS: Record<NavigationMainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  preview: RiGlobalLine,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
}

const tabs = computed<Tab[]>(() => {
  return MAIN_TABS.map(({ labelKey, ...tab }) => ({
    ...tab,
    label: String(t(labelKey)),
    icon: TAB_ICONS[tab.id],
    badge: tab.id === 'git' && !ui.isCompactLayout && diffFileCount.value > 0 ? diffFileCount.value : undefined,
    showDot: tab.id === 'git' && ui.isCompactLayout && diffFileCount.value > 0,
  }))
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

const workspaceDockToggleLabel = computed(() => {
  return ui.isWorkspaceDockOpen ? String(t('header.hideWorkspacePanel')) : String(t('header.showWorkspacePanel'))
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

    // 1-based index matching the tabs array
    if (num < 1 || num > tabs.value.length) return

    e.preventDefault()
    const tab = tabs.value[num - 1]
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

function toggleWorkspaceDock() {
  const defaultPanel: 'changes' | 'git' = String(route.path || '')
    .trim()
    .toLowerCase()
    .startsWith('/chat')
    ? 'changes'
    : 'git'
  ui.toggleWorkspaceDock(defaultPanel)
}

function locateCurrentSessionInSidebar() {
  const sid = (chat.selectedSessionId || '').trim()
  if (sid) ui.openAndLocateSessionInSidebar(sid)
}

function openHelpDialog() {
  ui.toggleHelpDialog()
}
</script>

<template>
  <header
    ref="headerRef"
    class="header-safe-area border-b border-border/50 relative z-20 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
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
        <component
          :is="
            ui.isCompactLayout ? (ui.isSessionSwitcherOpen ? RiArrowLeftSLine : RiPlayListAddLine) : RiLayoutLeftLine
          "
          class="h-5 w-5"
        />
      </IconButton>

      <!-- Desktop Navigation Tabs -->
      <nav
        v-if="!ui.isCompactLayout"
        class="flex items-center gap-1"
        role="tablist"
        :aria-label="String(t('aria.mainNavigation'))"
      >
        <RouterLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="mainTabRoute(tab.path)"
          class="relative flex items-center gap-2 px-3 h-9 rounded-md typography-ui-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          active-class="bg-secondary/70 !text-foreground"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          <span class="hidden sm:inline header-tab-label">{{ tab.label }}</span>

          <span
            v-if="tab.badge && tab.badge > 0"
            class="ml-1 hidden md:inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-bold text-primary"
          >
            {{ tab.badge }}
          </span>

          <span
            v-if="tab.showDot"
            class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary"
            :aria-label="String(t('header.changesAvailable'))"
          />
        </RouterLink>
      </nav>

      <!-- Mobile Title -->
      <div v-if="ui.isCompactLayout" class="min-w-0 flex-1">
        <div class="typography-ui-label font-semibold truncate">{{ mobileTitle }}</div>
      </div>

      <div class="flex-1" v-if="!ui.isCompactLayout" />

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
            v-if="!ui.isCompactLayout"
            size="lg"
            :tooltip="workspaceDockToggleLabel"
            :is-touch-pointer="ui.isTouchPointer"
            :aria-label="workspaceDockToggleLabel"
            :variant="ui.isWorkspaceDockOpen ? 'secondary' : 'ghost'"
            @click="toggleWorkspaceDock"
          >
            <RiLayoutRightLine class="h-5 w-5" />
          </IconButton>

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
