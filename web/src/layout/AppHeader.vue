<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import {
  RiArrowLeftSLine,
  RiArrowDownSLine,
  RiLayoutLeftLine,
  RiPlayListAddLine,
  RiChat4Line,
  RiFolder6Line,
  RiTerminalBoxLine,
  RiGitMergeLine,
  RiQuestionLine,
  RiMapPin2Line,
  RiSettings3Line,
} from '@remixicon/vue'
import { cn } from '@/lib/utils'
import { MAIN_TABS, mainTabFromPath, type MainTabId } from '@/app/navigation/mainTabs'
import { useUiStore } from '@/stores/ui'
import { useHealthStore } from '@/stores/health'
import { useDirectoryStore } from '@/stores/directory'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { apiJson } from '@/lib/api'
import type { GitStatusResponse } from '@/types/git'

import FormDialog from '@/components/ui/FormDialog.vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import PathPicker from '@/components/ui/PathPicker.vue'

type Tab = { id: MainTabId; path: string; label: string; icon: Component; badge?: number; showDot?: boolean }

const ui = useUiStore()
const health = useHealthStore()
const directoryStore = useDirectoryStore()
const settings = useSettingsStore()
const chat = useChatStore()
const route = useRoute()
const router = useRouter()

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

// -- Project Picker --
const projectPath = computed(() => (directoryStore.currentDirectory || '').trim())
const projectDisplay = computed(() => directoryStore.displayDirectory || '')
const projectPickerOpen = ref(false)
const projectPickerDraft = ref('')

watch(projectPickerOpen, (open) => {
  if (open) projectPickerDraft.value = projectPath.value
})

const projectPickerDisabled = computed(() => !(projectPickerDraft.value || '').trim())

async function applyProjectPicker() {
  const next = (projectPickerDraft.value || '').trim()
  if (!next) return
  const existing = settings.data?.projects || []
  if (!existing.some((project) => project.path.trim() === next)) {
    await settings.addProject(next)
  }
  directoryStore.setDirectory(next)
  projectPickerOpen.value = false
}

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
const TAB_ICONS: Record<MainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
}

const tabs = computed<Tab[]>(() => {
  return MAIN_TABS.map((tab) => ({
    ...tab,
    icon: TAB_ICONS[tab.id],
    badge: tab.id === 'git' && !ui.isMobile && diffFileCount.value > 0 ? diffFileCount.value : undefined,
    showDot: tab.id === 'git' && ui.isMobile && diffFileCount.value > 0,
  }))
})

// Sync Route -> UI Store (for mobile title / persistence)
// We rely on Vue Router for the actual active state in the UI.
watch(
  () => route.path,
  (path) => {
    const normalized = String(path || '').toLowerCase()
    const matchesMainTab = MAIN_TABS.some((tab) => normalized.startsWith(tab.path))
    if (!matchesMainTab) return

    const next = mainTabFromPath(normalized)
    if (ui.activeMainTab !== next) {
      ui.setActiveMainTab(next)
    }
  },
  { immediate: true },
)

const mobileTitle = computed(() => {
  const panelMap: Record<string, string> = {
    settings: 'Settings',
    sessions: 'Chat',
    files: 'Files',
    terminal: 'Terminal',
    git: 'Git',
  }
  const panel = String(route.meta?.mobilePanel || '')
    .trim()
    .toLowerCase()
  if (panelMap[panel]) return panelMap[panel]

  const tabMap: Record<string, string> = {
    chat: 'Chat',
    diff: 'Diff',
    files: 'Files',
    terminal: 'Terminal',
    git: 'Git',
  }
  return tabMap[String(ui.activeMainTab || '')] || 'OpenCode Studio'
})

const mobilePanelToggleLabel = computed(() => {
  if (ui.isSessionSwitcherOpen) return 'Back'
  const panel = String(route.meta?.mobilePanel || '')
    .trim()
    .toLowerCase()
  if (panel === 'files') return 'Open files panel'
  if (panel === 'terminal') return 'Open terminal panel'
  if (panel === 'git') return 'Open source control panel'
  if (panel === 'settings') return 'Open settings panel'
  return 'Open sessions'
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
      router.push(tab.path)
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
  if (ui.isMobile) {
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

const SETTINGS_LAST_ROUTE_KEY = 'oc2.settings.lastRoute'

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
  router.push(getRememberedSettingsRoute())
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
        :aria-label="ui.isMobile ? mobilePanelToggleLabel : 'Toggle sidebar'"
        @click="handleOpenSessionSwitcher"
      >
        <component
          :is="ui.isMobile ? (ui.isSessionSwitcherOpen ? RiArrowLeftSLine : RiPlayListAddLine) : RiLayoutLeftLine"
          class="h-5 w-5"
        />
      </IconButton>

      <!-- Desktop Navigation Tabs -->
      <nav v-if="!ui.isMobile" class="flex items-center gap-1" role="tablist" aria-label="Main navigation">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="tab.path"
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
            aria-label="Changes available"
          />
        </RouterLink>
      </nav>

      <!-- Mobile Title -->
      <div v-if="ui.isMobile" class="min-w-0 flex-1">
        <div class="typography-ui-label font-semibold truncate">{{ mobileTitle }}</div>
      </div>

      <!-- Desktop Project Picker -->
      <button
        v-else
        type="button"
        class="flex items-center gap-2 px-2.5 h-9 rounded-md text-[11px] font-medium hover:bg-secondary/40 transition-colors select-none max-w-[36vw]"
        :title="projectPath || 'No project selected'"
        aria-label="Change project"
        @click="projectPickerOpen = true"
      >
        <RiFolder6Line class="h-4 w-4 text-muted-foreground" />
        <span class="font-mono truncate">{{ projectDisplay || 'No project selected' }}</span>
        <RiArrowDownSLine class="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>

      <div class="flex-1" v-if="!ui.isMobile" />

      <!-- Right Actions -->
      <div class="flex items-center pr-1">
        <!-- Connection Status -->
        <span
          class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full"
          :title="health.openCodeConnected ? 'Online' : 'Offline'"
          aria-label="Status"
        >
          <span
            :class="cn('inline-flex h-2 w-2 rounded-full', health.openCodeConnected ? 'bg-emerald-500' : 'bg-rose-500')"
          />
        </span>

        <div class="flex items-center gap-1">
          <IconButton size="lg" aria-label="Help" title="Help" @click="openHelpDialog">
            <RiQuestionLine class="h-5 w-5" />
          </IconButton>

          <IconButton
            v-if="chat.selectedSessionId"
            size="lg"
            aria-label="Locate current session in sidebar"
            title="Locate session"
            @click="locateCurrentSessionInSidebar"
          >
            <RiMapPin2Line class="h-5 w-5" />
          </IconButton>

          <IconButton
            v-if="ui.isMobile"
            size="lg"
            aria-label="Change project"
            :title="projectPath || 'No project selected'"
            @click="projectPickerOpen = true"
          >
            <RiFolder6Line class="h-5 w-5" />
          </IconButton>

          <IconButton size="lg" aria-label="Settings" @click="openSettings">
            <RiSettings3Line class="h-5 w-5" />
          </IconButton>
        </div>
      </div>
    </div>
  </header>

  <FormDialog
    :open="projectPickerOpen"
    title="Select Project"
    description="Choose a directory to set as the current project"
    @update:open="(v) => (projectPickerOpen = v)"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <PathPicker
        v-model="projectPickerDraft"
        placeholder="/path/to/project"
        view="browser"
        mode="directory"
        :resolve-to-absolute="true"
        :base-path="directoryStore.currentDirectory || ''"
        :show-options="true"
        :show-gitignored="true"
        input-class="h-9 font-mono"
        browser-class="flex max-h-[52vh] min-h-[14rem] flex-col"
      />
      <div class="flex items-center justify-end gap-2 flex-none">
        <Button variant="ghost" @click="projectPickerOpen = false">Cancel</Button>
        <Button @click="applyProjectPicker" :disabled="projectPickerDisabled">Use project</Button>
      </div>
    </div>
  </FormDialog>
</template>
