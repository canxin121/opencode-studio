<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowSize } from '@vueuse/core'
import {
  RiArrowLeftSLine,
  RiCloseLine,
  RiFileList2Line,
  RiLoader4Line,
  RiPlugLine,
  RiRefreshLine,
} from '@remixicon/vue'

import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import PluginMountHost from '@/components/plugins/PluginMountHost.vue'
import IconButton from '@/components/ui/IconButton.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { buildVirtualMonacoDiffModel } from '@/features/git/diff/unifiedDiff'
import { apiJson } from '@/lib/api'
import {
  normalizeLspRuntimeList,
  runtimeStatusTone,
  type LspRuntimeItem,
  type LspRuntimeListResponse,
} from '@/lib/lspRuntime'
import type { ChatMount } from '@/plugins/host/mounts'
import { useChatStore } from '@/stores/chat'
import type { SessionFileDiff } from '@/types/chat'
import { resolveSessionDiffNavigationView, type SessionDiffMobileView } from './sessionDiffMobileNav'
import { resolveSessionDiffPanelView } from './sessionDiffPanelState'

const props = withDefaults(
  defineProps<{
    mounts: ChatMount[]
    placement?: 'overlay' | 'composer'
    isMobilePointer?: boolean
  }>(),
  {
    placement: 'overlay',
    isMobilePointer: false,
  },
)

const emit = defineEmits<{
  (event: 'reserve-change', px: number): void
}>()

const { t } = useI18n()
const chat = useChatStore()

type ReserveMap = Record<string, number>

const rootEl = ref<HTMLElement | null>(null)
const launcherBtnEl = ref<HTMLElement | null>(null)
const launcherAnchorEl = ref<HTMLElement | null>(null)
const reserveByKey = ref<ReserveMap>({})
const menuOpen = ref(false)
const activeMountKey = ref('')
const menuQuery = ref('')
const diffPanelOpen = ref(false)
const lspPanelOpen = ref(false)
const selectedDiffFile = ref('')
const sessionDiffWrap = ref(true)
const mobileDiffView = ref<SessionDiffMobileView>('list')
const diffListEl = ref<HTMLElement | null>(null)
const lspRuntimeLoading = ref(false)
const lspRuntimeError = ref('')
const lspRuntimeItems = ref<LspRuntimeItem[]>([])
const { width: viewportWidth } = useWindowSize()

let reserveObserver: ResizeObserver | null = null
let reserveRaf = 0

function mountKey(mount: ChatMount): string {
  return `${mount.pluginId}:${mount.surface}:${mount.entry}:${mount.mode}`
}

function normalizedPluginLabel(pluginId: string): string {
  const raw = String(pluginId || '').trim()
  const lower = raw.toLowerCase()

  if (lower.includes('planpilot')) return 'planpilot'
  if (lower.includes('workbench')) return 'workbench'

  const tail = raw.split('/').pop() || raw
  const cleaned = tail
    .replace(/^opencode[-_]?/i, '')
    .trim()
    .toLowerCase()
  return cleaned || lower || 'plugin'
}

function pickLocalizedLabel(mount: ChatMount): string {
  return normalizedPluginLabel(mount.pluginId)
}

const mountRows = computed(() =>
  props.mounts.map((mount) => {
    const key = mountKey(mount)
    return {
      key,
      mount,
      label: pickLocalizedLabel(mount),
    }
  }),
)

const hasMounts = computed(() => mountRows.value.length > 0)
const isComposerPlacement = computed(() => props.placement === 'composer')
const sessionDiff = computed<SessionFileDiff[]>(() => {
  const list = chat.selectedSessionDiff
  return Array.isArray(list) ? list : []
})
const sessionDiffCount = computed(() => sessionDiff.value.length)
const sessionSummaryFileCount = computed(() => {
  const raw = chat.selectedSession?.summary?.files
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
})
const hasSummarySessionChanges = computed(() => sessionSummaryFileCount.value > 0)
const sessionDiffPanelView = computed(() =>
  resolveSessionDiffPanelView({
    loading: chat.selectedSessionDiffLoading,
    error: chat.selectedSessionDiffError,
    diffCount: sessionDiffCount.value,
    diffLoaded: chat.selectedSessionDiffLoaded,
    hasSummaryChanges: hasSummarySessionChanges.value,
  }),
)
const sessionDiffBadge = computed(() => {
  const count = sessionDiffCount.value
  if (count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
})
const lspRuntimeBadge = computed(() => {
  const count = lspRuntimeItems.value.length
  if (count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
})
const selectedDiff = computed(() => {
  const target = selectedDiffFile.value
  if (!target) return null
  return sessionDiff.value.find((entry) => entry.file === target) || null
})
const selectedDiffPath = computed(() => selectedDiff.value?.file || '')
const selectedDiffPreview = computed(() => {
  const entry = selectedDiff.value
  if (!entry) return null
  return buildVirtualMonacoDiffModel({
    modelId: `session-diff:${entry.file}`,
    path: entry.file,
    original: entry.before,
    modified: entry.after,
    diff: entry.diff,
    meta: entry.meta,
    preferPatch: true,
    compactSnapshots: true,
  })
})
const isNarrowViewport = computed(() => viewportWidth.value < 640)
const sessionDiffNavigationView = computed(() =>
  resolveSessionDiffNavigationView({
    isNarrowViewport: isNarrowViewport.value,
    hasDiffEntries: sessionDiffCount.value > 0,
    selectedDiffPath: selectedDiffPath.value,
    mobileView: mobileDiffView.value,
  }),
)
const sessionDiffHasMore = computed(() => chat.selectedSessionDiffHasMore)
const sessionDiffLoadingMore = computed(() => chat.selectedSessionDiffLoadingMore)
const sessionDiffPanelStyle = computed<CSSProperties | undefined>(() => {
  if (!props.isMobilePointer) return undefined
  return {
    maxHeight: 'calc(100dvh - var(--oc-safe-area-top, 0px) - var(--oc-safe-area-bottom, 0px) - 1rem)',
  }
})

const activeMount = computed(() => {
  const key = activeMountKey.value
  if (!key) return null
  return mountRows.value.find((row) => row.key === key) || null
})

const activeMountWithHostMode = computed<ChatMount | null>(() => {
  const selected = activeMount.value
  if (!selected) return null
  return {
    ...selected.mount,
    context: {
      ...(selected.mount.context || {}),
      studioOverlayMode: 'host-menu',
    },
  }
})

const launcherAria = computed(() =>
  menuOpen.value
    ? String(t('plugins.overlayLauncher.closeMenuAria'))
    : String(t('plugins.overlayLauncher.openMenuAria')),
)

const launcherHidden = computed(
  () =>
    menuOpen.value ||
    Boolean(activeMountWithHostMode.value) ||
    Boolean(diffPanelOpen.value) ||
    Boolean(lspPanelOpen.value),
)
const optionMenuAnchorEl = computed(() => launcherBtnEl.value || launcherAnchorEl.value)

const menuGroups = computed<OptionMenuGroup[]>(() => {
  const items: OptionMenuItem[] = mountRows.value.map((row) => ({
    id: row.key,
    label: row.label,
    checked: activeMountKey.value === row.key,
    keywords: `${row.label} ${row.mount.pluginId}`,
  }))

  return [
    {
      id: 'plugin-mounts',
      items,
    },
  ]
})

function computeMeasuredReserve(): number {
  const root = rootEl.value
  if (!root) return 0
  const rect = root.getBoundingClientRect()
  if (!Number.isFinite(rect.height) || rect.height <= 0) return 0
  const bottomGap = 8
  return Math.max(0, Math.ceil(rect.height + bottomGap))
}

function activeMountReserve(): number {
  const key = activeMountKey.value
  if (!key) return 0
  return reserveByKey.value[key] || 0
}

function recomputeReserve() {
  if (isComposerPlacement.value) {
    emit('reserve-change', 0)
    return
  }
  if (!hasMounts.value && !diffPanelOpen.value && !lspPanelOpen.value) {
    emit('reserve-change', 0)
    return
  }
  emit('reserve-change', Math.max(computeMeasuredReserve(), activeMountReserve()))
}

function scheduleReserveUpdate() {
  if (reserveRaf) return
  reserveRaf = window.requestAnimationFrame(() => {
    reserveRaf = 0
    recomputeReserve()
  })
}

function setReserve(key: string, px: number) {
  const nextPx = Number.isFinite(px) && px > 0 ? Math.max(0, Math.floor(px)) : 0
  if (reserveByKey.value[key] === nextPx) return
  reserveByKey.value = {
    ...reserveByKey.value,
    [key]: nextPx,
  }
  scheduleReserveUpdate()
}

function closeMenu() {
  if (!menuOpen.value) return
  menuOpen.value = false
  menuQuery.value = ''
  scheduleReserveUpdate()
}

function closeDiffPanel() {
  if (!diffPanelOpen.value) return
  diffPanelOpen.value = false
  mobileDiffView.value = 'list'
  scheduleReserveUpdate()
}

function closeLspPanel() {
  if (!lspPanelOpen.value) return
  lspPanelOpen.value = false
  scheduleReserveUpdate()
}

function toggleMenu() {
  if (!hasMounts.value) return
  closeDiffPanel()
  closeLspPanel()
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) menuQuery.value = ''
  scheduleReserveUpdate()
}

function toggleDiffPanel() {
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  if (!diffPanelOpen.value) {
    closeMenu()
    closeLspPanel()
    activeMountKey.value = ''
    mobileDiffView.value = 'list'
    void chat.refreshSessionDiff(sid, { silent: true })
  }
  diffPanelOpen.value = !diffPanelOpen.value
  scheduleReserveUpdate()
}

async function refreshLspRuntimeStatus() {
  lspRuntimeLoading.value = true
  lspRuntimeError.value = ''
  try {
    const payload = await apiJson<LspRuntimeListResponse>('/api/lsp')
    lspRuntimeItems.value = normalizeLspRuntimeList(payload)
  } catch (err) {
    lspRuntimeError.value = err instanceof Error ? err.message : String(err)
    lspRuntimeItems.value = []
  } finally {
    lspRuntimeLoading.value = false
  }
}

function toggleLspPanel() {
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  if (!lspPanelOpen.value) {
    closeMenu()
    closeDiffPanel()
    activeMountKey.value = ''
    void refreshLspRuntimeStatus()
  }
  lspPanelOpen.value = !lspPanelOpen.value
  scheduleReserveUpdate()
}

function maybeLoadMoreSessionDiff() {
  if (!diffPanelOpen.value) return
  if (!sessionDiffHasMore.value || sessionDiffLoadingMore.value || chat.selectedSessionDiffLoading) return
  const el = diffListEl.value
  if (!el) return
  const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
  if (remaining > 88) return
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  void chat.loadMoreSessionDiff(sid, { silent: true })
}

function handleDiffListScroll() {
  maybeLoadMoreSessionDiff()
}

function selectDiffFile(path: string) {
  selectedDiffFile.value = path
  if (isNarrowViewport.value) {
    mobileDiffView.value = 'detail'
  }
}

function backToDiffList() {
  mobileDiffView.value = 'list'
}

function selectMount(key: string) {
  closeDiffPanel()
  closeLspPanel()
  activeMountKey.value = activeMountKey.value === key ? '' : key
  closeMenu()
  scheduleReserveUpdate()
}

function clearActiveMount() {
  activeMountKey.value = ''
  closeMenu()
  closeDiffPanel()
  closeLspPanel()
  scheduleReserveUpdate()
}

function handleMenuOpenChange(open: boolean) {
  if (open) closeDiffPanel()
  if (open) closeLspPanel()
  menuOpen.value = Boolean(open)
  if (!open) menuQuery.value = ''
  scheduleReserveUpdate()
}

function handleMenuQueryChange(value: string) {
  menuQuery.value = String(value || '')
}

function handleMenuSelect(item: OptionMenuItem) {
  selectMount(item.id)
}

watch(
  () => mountRows.value.map((row) => row.key).join('|'),
  () => {
    const keep = new Set(mountRows.value.map((row) => row.key))
    const next: ReserveMap = {}
    for (const [key, value] of Object.entries(reserveByKey.value)) {
      if (keep.has(key)) next[key] = value
    }
    reserveByKey.value = next

    if (!keep.has(activeMountKey.value)) {
      activeMountKey.value = ''
      menuOpen.value = false
      menuQuery.value = ''
    }

    scheduleReserveUpdate()
  },
  { immediate: true },
)

watch(
  () => sessionDiff.value.map((entry) => entry.file).join('|'),
  () => {
    const list = sessionDiff.value
    if (!list.length) {
      selectedDiffFile.value = ''
      return
    }
    if (!list.some((entry) => entry.file === selectedDiffFile.value)) {
      selectedDiffFile.value = list[0]?.file || ''
    }
    void nextTick(() => {
      maybeLoadMoreSessionDiff()
    })
  },
  { immediate: true },
)

watch(
  () => chat.selectedSessionId,
  () => {
    diffPanelOpen.value = false
    lspPanelOpen.value = false
    selectedDiffFile.value = ''
    mobileDiffView.value = 'list'
  },
)

watch(
  () => [
    menuOpen.value,
    activeMountKey.value,
    hasMounts.value,
    isComposerPlacement.value,
    diffPanelOpen.value,
    lspPanelOpen.value,
  ],
  () => {
    scheduleReserveUpdate()
    if (diffPanelOpen.value) {
      void nextTick(() => {
        maybeLoadMoreSessionDiff()
      })
    }
  },
)

watch(rootEl, (next, prev) => {
  if (!reserveObserver) return
  if (prev) reserveObserver.unobserve(prev)
  if (next) reserveObserver.observe(next)
  scheduleReserveUpdate()
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && !isComposerPlacement.value) {
    reserveObserver = new ResizeObserver(() => {
      scheduleReserveUpdate()
    })
    if (rootEl.value) reserveObserver.observe(rootEl.value)
  }

  scheduleReserveUpdate()
})

onBeforeUnmount(() => {
  reserveObserver?.disconnect()
  reserveObserver = null

  if (reserveRaf) {
    window.cancelAnimationFrame(reserveRaf)
    reserveRaf = 0
  }

  emit('reserve-change', 0)
})
</script>

<template>
  <div
    v-if="hasMounts || chat.selectedSessionId"
    ref="rootEl"
    :class="
      isComposerPlacement ? 'w-full flex flex-col items-stretch gap-1' : 'pointer-events-none w-full flex justify-end'
    "
  >
    <div
      :class="
        isComposerPlacement
          ? 'pointer-events-auto w-full flex flex-col items-stretch gap-1'
          : 'pointer-events-none w-full flex flex-col items-stretch gap-2'
      "
    >
      <PluginMountHost
        v-if="activeMountWithHostMode && !menuOpen"
        :key="activeMountKey"
        class="pointer-events-auto w-full min-w-0"
        :mount="activeMountWithHostMode"
        @reserve-change="(px) => (activeMountKey ? setReserve(activeMountKey, px) : undefined)"
        @request-close="clearActiveMount"
      />

      <OptionMenu
        v-if="hasMounts"
        :open="menuOpen"
        :query="menuQuery"
        :groups="menuGroups"
        :title="t('plugins.overlayLauncher.menuTitle')"
        :mobile-title="t('plugins.overlayLauncher.menuTitle')"
        :is-mobile-pointer="isMobilePointer"
        :desktop-fixed="true"
        :desktop-anchor-el="optionMenuAnchorEl"
        desktop-placement="top-end"
        desktop-class="pointer-events-auto w-[min(420px,calc(100%-1rem))]"
        @update:open="handleMenuOpenChange"
        @update:query="handleMenuQueryChange"
        @select="handleMenuSelect"
      />

      <div
        v-if="diffPanelOpen"
        class="pointer-events-auto w-full rounded-lg border border-border/70 bg-background/95 shadow-lg backdrop-blur overflow-hidden flex flex-col min-h-0"
        :style="sessionDiffPanelStyle"
      >
        <div class="flex items-center justify-between gap-2 px-3 py-0.5 border-b border-border/60">
          <div class="text-xs font-medium leading-4 text-foreground">{{ t('chat.sessionDiff.panelTitle') }}</div>
          <IconButton
            size="sm"
            class="text-muted-foreground hover:text-foreground"
            :title="t('chat.sessionDiff.close')"
            :aria-label="t('chat.sessionDiff.close')"
            data-testid="session-diff-close-button"
            @click.stop="closeDiffPanel"
          >
            <RiCloseLine class="h-4 w-4" />
          </IconButton>
        </div>

        <div v-if="sessionDiffPanelView === 'loading'" class="px-3 py-6 text-xs text-muted-foreground">
          {{ t('chat.sessionDiff.loading') }}
        </div>
        <div v-else-if="sessionDiffPanelView === 'error'" class="px-3 py-6 text-xs text-destructive">
          {{ chat.selectedSessionDiffError }}
        </div>
        <div v-else-if="sessionDiffPanelView === 'empty'" class="px-3 py-6 text-xs text-muted-foreground">
          {{ t('chat.sessionDiff.empty') }}
        </div>
        <div
          v-else
          class="flex min-h-0 flex-col h-[min(56dvh,calc(100dvh-var(--oc-safe-area-top,0px)-var(--oc-safe-area-bottom,0px)-9rem))] max-h-[520px] min-h-[280px] sm:min-h-[320px]"
          :class="sessionDiffNavigationView === 'split' ? 'sm:flex-row' : ''"
        >
          <div
            v-if="sessionDiffNavigationView !== 'detail'"
            ref="diffListEl"
            class="flex-1 min-h-0 overflow-auto border-border/60 sm:w-72 sm:max-w-72 sm:min-w-72 sm:border-r"
            @scroll.passive="handleDiffListScroll"
          >
            <div
              v-if="sessionDiffNavigationView === 'list'"
              class="px-3 py-2 text-[11px] font-medium text-muted-foreground"
            >
              {{ t('chat.sessionDiff.listTitle') }}
            </div>
            <button
              v-for="entry in sessionDiff"
              :key="entry.file"
              type="button"
              class="w-full px-3 py-2 text-left border-b border-border/50 hover:bg-secondary/40 transition-colors"
              :class="selectedDiffPath === entry.file ? 'bg-secondary/60' : ''"
              @click.stop="selectDiffFile(entry.file)"
            >
              <div class="text-xs truncate" :title="entry.file">{{ entry.file }}</div>
              <div class="mt-1 text-[11px] font-mono">
                <span class="text-emerald-600 dark:text-emerald-400">+{{ entry.additions }}</span>
                <span class="ml-2 text-red-600 dark:text-red-400">-{{ entry.deletions }}</span>
              </div>
            </button>
            <div v-if="sessionDiffLoadingMore" class="px-3 py-2 text-[11px] text-muted-foreground">
              {{ t('chat.sessionDiff.loading') }}
            </div>
          </div>
          <div v-if="sessionDiffNavigationView === 'detail'" class="flex min-h-0 flex-1 flex-col">
            <div class="flex items-center gap-2 border-b border-border/50 px-2 py-1">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                :title="t('chat.sessionDiff.backToList')"
                :aria-label="t('chat.sessionDiff.backToList')"
                @click.stop="backToDiffList"
              >
                <RiArrowLeftSLine class="h-4 w-4" />
                <span>{{ t('chat.sessionDiff.backToList') }}</span>
              </button>
              <div class="min-w-0 text-[11px] font-medium text-foreground truncate" :title="selectedDiffPath">
                {{ selectedDiffPath }}
              </div>
              <button
                type="button"
                class="ml-auto inline-flex h-6 items-center rounded-md border border-border/60 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                :aria-pressed="sessionDiffWrap"
                @click.stop="sessionDiffWrap = !sessionDiffWrap"
              >
                {{ sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable') }}
              </button>
            </div>
            <div class="min-w-0 flex-1 min-h-[200px]">
              <MonacoDiffEditor
                class="h-full"
                :path="selectedDiffPreview?.path || selectedDiffPath"
                :language-path="selectedDiffPreview?.path || selectedDiffPath"
                :model-id="selectedDiffPreview?.modelId || ''"
                :original-model-id="selectedDiffPreview ? `${selectedDiffPreview.modelId}:base` : ''"
                :original-value="selectedDiffPreview?.original || ''"
                :modified-value="selectedDiffPreview?.modified || ''"
                :use-files-theme="true"
                :read-only="true"
                :wrap="sessionDiffWrap"
              />
            </div>
          </div>
          <div
            v-else-if="sessionDiffNavigationView === 'split'"
            class="min-w-0 flex flex-1 min-h-[200px] flex-col sm:min-h-0"
          >
            <div class="flex items-center gap-2 border-b border-border/50 px-2 py-1">
              <div class="min-w-0 flex-1 text-[11px] font-medium text-foreground truncate" :title="selectedDiffPath">
                {{ selectedDiffPath }}
              </div>
              <button
                type="button"
                class="inline-flex h-6 items-center rounded-md border border-border/60 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                :aria-pressed="sessionDiffWrap"
                @click.stop="sessionDiffWrap = !sessionDiffWrap"
              >
                {{ sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable') }}
              </button>
            </div>
            <MonacoDiffEditor
              class="h-full"
              :path="selectedDiffPreview?.path || selectedDiffPath"
              :language-path="selectedDiffPreview?.path || selectedDiffPath"
              :model-id="selectedDiffPreview?.modelId || ''"
              :original-model-id="selectedDiffPreview ? `${selectedDiffPreview.modelId}:base` : ''"
              :original-value="selectedDiffPreview?.original || ''"
              :modified-value="selectedDiffPreview?.modified || ''"
              :use-files-theme="true"
              :read-only="true"
              :wrap="sessionDiffWrap"
            />
          </div>
        </div>
      </div>

      <div
        v-if="lspPanelOpen"
        class="pointer-events-auto w-full rounded-lg border border-border/70 bg-background/95 shadow-lg backdrop-blur overflow-hidden flex flex-col min-h-0"
        :style="sessionDiffPanelStyle"
      >
        <div class="flex items-center justify-between gap-2 px-3 py-0.5 border-b border-border/60">
          <div class="text-xs font-medium leading-4 text-foreground">{{ t('chat.lspStatus.panelTitle') }}</div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
              :disabled="lspRuntimeLoading"
              :title="t('common.refresh')"
              :aria-label="t('common.refresh')"
              @click.stop="refreshLspRuntimeStatus"
            >
              <RiLoader4Line v-if="lspRuntimeLoading" class="h-3 w-3 animate-spin" />
              <RiRefreshLine v-else class="h-3 w-3" />
              <span>{{ t('common.refresh') }}</span>
            </button>
            <IconButton
              size="sm"
              class="text-muted-foreground hover:text-foreground"
              :title="t('chat.lspStatus.close')"
              :aria-label="t('chat.lspStatus.close')"
              @click.stop="closeLspPanel"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div v-if="lspRuntimeLoading" class="px-3 py-6 text-xs text-muted-foreground">
          {{ t('chat.lspStatus.loading') }}
        </div>
        <div v-else-if="lspRuntimeError" class="px-3 py-6 text-xs text-destructive">
          {{ lspRuntimeError }}
        </div>
        <div v-else-if="lspRuntimeItems.length === 0" class="px-3 py-6 text-xs text-muted-foreground">
          {{ t('chat.lspStatus.empty') }}
        </div>
        <div
          v-else
          class="flex min-h-0 flex-col h-[min(56dvh,calc(100dvh-var(--oc-safe-area-top,0px)-var(--oc-safe-area-bottom,0px)-9rem))] max-h-[520px] min-h-[240px]"
        >
          <div class="px-3 py-2 text-[11px] font-medium text-muted-foreground">
            {{ t('chat.lspStatus.listTitle') }}
          </div>
          <div class="flex-1 min-h-0 overflow-auto">
            <div
              v-for="runtime in lspRuntimeItems"
              :key="runtime.id"
              class="w-full px-3 py-2 border-b border-border/50 hover:bg-secondary/30 transition-colors"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="min-w-0 truncate text-xs" :title="runtime.name">{{ runtime.name }}</span>
                <span
                  class="inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                  :class="
                    runtimeStatusTone(runtime.status) === 'ok'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : runtimeStatusTone(runtime.status) === 'warn'
                        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                        : 'bg-muted text-muted-foreground'
                  "
                >
                  {{ runtime.status || t('common.unknown') }}
                </span>
              </div>
              <div class="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                <div v-if="runtime.rootDir" class="truncate" :title="runtime.rootDir">{{ runtime.rootDir }}</div>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]">
                  <span>{{ runtime.id }}</span>
                  <span v-if="runtime.transport">{{ runtime.transport }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="!launcherHidden"
        :class="
          isComposerPlacement
            ? 'pointer-events-none w-full flex justify-end pb-1'
            : 'pointer-events-none w-full flex justify-end'
        "
      >
        <div class="pointer-events-none inline-flex items-center gap-1.5">
          <button
            v-if="chat.selectedSessionId"
            type="button"
            class="pointer-events-auto relative h-7 sm:h-8 w-7 sm:w-8 inline-flex items-center justify-center rounded-md border border-border/60 bg-background/80 shadow-sm backdrop-blur transition-colors text-muted-foreground hover:text-foreground hover:bg-background"
            :title="t('chat.sessionDiff.toggleAria')"
            :aria-label="t('chat.sessionDiff.toggleAria')"
            :aria-expanded="diffPanelOpen"
            data-oc-keyboard-tap="keep"
            @pointerdown.prevent.stop
            @click.stop="toggleDiffPanel"
          >
            <RiFileList2Line class="h-4 w-4" />
            <span
              v-if="sessionDiffCount > 0"
              class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-mono text-center"
              aria-hidden="true"
            >
              {{ sessionDiffBadge }}
            </span>
          </button>

          <button
            v-if="chat.selectedSessionId"
            type="button"
            class="pointer-events-auto relative h-7 sm:h-8 min-w-7 sm:min-w-8 px-1 sm:px-1.5 inline-flex items-center justify-center rounded-md border border-border/60 bg-background/80 shadow-sm backdrop-blur transition-colors text-muted-foreground hover:text-foreground hover:bg-background"
            :title="t('chat.lspStatus.toggleAria')"
            :aria-label="t('chat.lspStatus.toggleAria')"
            :aria-expanded="lspPanelOpen"
            data-oc-keyboard-tap="keep"
            @pointerdown.prevent.stop
            @click.stop="toggleLspPanel"
          >
            <span class="text-[9px] font-semibold leading-none">LSP</span>
            <span
              v-if="lspRuntimeBadge"
              class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-mono text-center"
              aria-hidden="true"
            >
              {{ lspRuntimeBadge }}
            </span>
          </button>

          <button
            v-if="hasMounts"
            ref="launcherBtnEl"
            type="button"
            class="pointer-events-auto h-7 sm:h-8 w-7 sm:w-8 inline-flex items-center justify-center rounded-md border border-border/60 bg-background/80 shadow-sm backdrop-blur transition-colors"
            :class="'text-muted-foreground hover:text-foreground hover:bg-background'"
            :title="launcherAria"
            :aria-label="launcherAria"
            :aria-expanded="menuOpen"
            data-oc-keyboard-tap="keep"
            @pointerdown.prevent.stop
            @click.stop="toggleMenu"
          >
            <RiPlugLine class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div v-else-if="menuOpen && hasMounts" class="pointer-events-none w-full relative h-0">
        <span ref="launcherAnchorEl" class="absolute top-0 right-0 h-0 w-0 pointer-events-none" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
