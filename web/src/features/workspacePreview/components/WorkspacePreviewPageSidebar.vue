<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RiAddLine,
  RiAnticlockwiseLine,
  RiComputerLine,
  RiExternalLinkLine,
  RiRefreshLine,
  RiSmartphoneLine,
  RiSubtractLine,
} from '@remixicon/vue'

import ListItemFrame from '@/components/ui/ListItemFrame.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import { buildPreviewFrameSrc } from '@/features/workspacePreview/model/previewUrl'
import type { WorkspacePreviewSession } from '@/features/workspacePreview/api/workspacePreviewApi'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const ui = useUiStore()
const directoryStore = useDirectoryStore()
const preview = useWorkspacePreviewStore()

const MIN_VIEWPORT_SCALE = 25
const MAX_VIEWPORT_SCALE = 200
const VIEWPORT_SCALE_STEP = 10

const VIEWPORT_SIZE_STEP_PX = 1
const VIEWPORT_SIZE_FAST_STEP_PX = 10

const currentDirectory = computed(() => String(directoryStore.currentDirectory || '').trim())
const activeSession = computed(() => preview.activeSession)
const activeProxyBasePath = computed(() => activeSession.value?.proxyBasePath || '')
const previewSrc = computed(() => buildPreviewFrameSrc(activeProxyBasePath.value, preview.refreshToken))
const canOpenInWindow = computed(() => Boolean(previewSrc.value))

function sessionLabel(session: WorkspacePreviewSession): string {
  const directory = String(session.directory || '')
    .trim()
    .replace(/[\\/]+$/, '')
  if (!directory) return session.id
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || directory
}

async function refreshSessions(opts?: { forceFrameReload?: boolean }) {
  await preview.refreshSessions()
  if (opts?.forceFrameReload) {
    preview.bumpRefreshToken()
  }
}

function clampViewportScale(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) return 100
  return Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, Math.round(raw)))
}

const viewportScalePct = computed(() => clampViewportScale(preview.viewportScale))

const widthDraft = ref(String(preview.viewportWidth || ''))
const heightDraft = ref(String(preview.viewportHeight || ''))
const widthFocused = ref(false)
const heightFocused = ref(false)

watch(
  () => preview.viewportWidth,
  (value) => {
    if (widthFocused.value) return
    widthDraft.value = String(value || '')
  },
  { immediate: true },
)

watch(
  () => preview.viewportHeight,
  (value) => {
    if (heightFocused.value) return
    heightDraft.value = String(value || '')
  },
  { immediate: true },
)

function parseDraftInt(value: string): number | null {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function commitWidthDraft() {
  const parsed = parseDraftInt(widthDraft.value)
  if (parsed === null) return
  preview.setViewportSize({ width: parsed })
  if (!widthFocused.value) widthDraft.value = String(preview.viewportWidth || '')
}

function commitHeightDraft() {
  const parsed = parseDraftInt(heightDraft.value)
  if (parsed === null) return
  preview.setViewportSize({ height: parsed })
  if (!heightFocused.value) heightDraft.value = String(preview.viewportHeight || '')
}

function onWidthBlur() {
  widthFocused.value = false
  const parsed = parseDraftInt(widthDraft.value)
  if (parsed === null) {
    widthDraft.value = String(preview.viewportWidth || '')
    return
  }
  preview.setViewportSize({ width: parsed })
  widthDraft.value = String(preview.viewportWidth || '')
}

function onHeightBlur() {
  heightFocused.value = false
  const parsed = parseDraftInt(heightDraft.value)
  if (parsed === null) {
    heightDraft.value = String(preview.viewportHeight || '')
    return
  }
  preview.setViewportSize({ height: parsed })
  heightDraft.value = String(preview.viewportHeight || '')
}

function bumpViewportWidth(delta: number) {
  preview.setViewportSize({ width: Number(preview.viewportWidth) + delta })
  widthDraft.value = String(preview.viewportWidth || '')
}

function bumpViewportHeight(delta: number) {
  preview.setViewportSize({ height: Number(preview.viewportHeight) + delta })
  heightDraft.value = String(preview.viewportHeight || '')
}

function rotateViewport() {
  const w = Number(preview.viewportWidth)
  const h = Number(preview.viewportHeight)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return
  preview.setViewportSize({ width: h, height: w })
  widthDraft.value = String(preview.viewportWidth || '')
  heightDraft.value = String(preview.viewportHeight || '')
}

function onWidthKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? VIEWPORT_SIZE_FAST_STEP_PX : VIEWPORT_SIZE_STEP_PX
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    bumpViewportWidth(step)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    bumpViewportWidth(-step)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    commitWidthDraft()
    ;(event.currentTarget as HTMLInputElement | null)?.blur()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    widthDraft.value = String(preview.viewportWidth || '')
    ;(event.currentTarget as HTMLInputElement | null)?.blur()
  }
}

function onHeightKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? VIEWPORT_SIZE_FAST_STEP_PX : VIEWPORT_SIZE_STEP_PX
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    bumpViewportHeight(step)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    bumpViewportHeight(-step)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    commitHeightDraft()
    ;(event.currentTarget as HTMLInputElement | null)?.blur()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    heightDraft.value = String(preview.viewportHeight || '')
    ;(event.currentTarget as HTMLInputElement | null)?.blur()
  }
}

function onWidthWheel(event: WheelEvent) {
  const dy = Number(event.deltaY)
  if (!Number.isFinite(dy) || dy === 0) return
  event.preventDefault()
  const step = event.shiftKey ? VIEWPORT_SIZE_FAST_STEP_PX : VIEWPORT_SIZE_STEP_PX
  bumpViewportWidth(dy < 0 ? step : -step)
}

function onHeightWheel(event: WheelEvent) {
  const dy = Number(event.deltaY)
  if (!Number.isFinite(dy) || dy === 0) return
  event.preventDefault()
  const step = event.shiftKey ? VIEWPORT_SIZE_FAST_STEP_PX : VIEWPORT_SIZE_STEP_PX
  bumpViewportHeight(dy < 0 ? step : -step)
}

function setViewportScale(next: number) {
  preview.setViewportScale(clampViewportScale(next))
}

function zoomOut() {
  setViewportScale(viewportScalePct.value - VIEWPORT_SCALE_STEP)
}

function zoomIn() {
  setViewportScale(viewportScalePct.value + VIEWPORT_SCALE_STEP)
}

function resetZoom() {
  setViewportScale(100)
}

function toggleViewportMode() {
  preview.setViewport(preview.viewport === 'desktop' ? 'mobile' : 'desktop')
}

function openInNewWindow() {
  if (!previewSrc.value) return
  window.open(previewSrc.value, '_blank', 'noopener,noreferrer')
}

function selectSession(sessionId: string) {
  preview.selectSession(sessionId)
  if (ui.isMobile) ui.setSessionSwitcherOpen(false)
}
</script>

<template>
  <section class="oc-vscode-pane" :class="ui.isMobile ? 'border-0 rounded-none' : ''">
    <div class="oc-vscode-pane-header">
      <div class="flex min-w-0 items-center gap-2">
        <div class="oc-vscode-pane-title">{{ t('workspaceDock.preview.tab') }}</div>
        <span class="oc-vscode-count-badge" :title="String(preview.sessions.length)">{{
          preview.sessions.length
        }}</span>
      </div>

      <div class="oc-vscode-toolbar">
        <SidebarIconButton
          :active="preview.viewport === 'mobile'"
          :tooltip="
            preview.viewport === 'desktop'
              ? String(t('workspaceDock.preview.viewportDesktop'))
              : String(t('workspaceDock.preview.viewportMobile'))
          "
          :aria-label="
            preview.viewport === 'desktop'
              ? String(t('workspaceDock.preview.viewportDesktop'))
              : String(t('workspaceDock.preview.viewportMobile'))
          "
          :is-mobile-pointer="ui.isMobilePointer"
          @click="toggleViewportMode"
        >
          <RiComputerLine v-if="preview.viewport === 'desktop'" class="h-3.5 w-3.5" />
          <RiSmartphoneLine v-else class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <SidebarIconButton
          :tooltip="String(t('workspaceDock.preview.refresh'))"
          :aria-label="String(t('workspaceDock.preview.refresh'))"
          :is-mobile-pointer="ui.isMobilePointer"
          :disabled="preview.loading"
          @click="refreshSessions({ forceFrameReload: true })"
        >
          <RiRefreshLine class="h-3.5 w-3.5" :class="preview.loading ? 'animate-spin' : ''" />
        </SidebarIconButton>

        <SidebarIconButton
          :tooltip="String(t('workspaceDock.preview.openInWindow'))"
          :aria-label="String(t('workspaceDock.preview.openInWindow'))"
          :is-mobile-pointer="ui.isMobilePointer"
          :disabled="!canOpenInWindow"
          @click="openInNewWindow"
        >
          <RiExternalLinkLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
      </div>
    </div>

    <div class="oc-vscode-section">
      <div class="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <input
            v-model="widthDraft"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            class="h-5 w-[64px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :aria-label="String(t('workspaceDock.preview.viewportWidth'))"
            :title="String(t('workspaceDock.preview.viewportWidth'))"
            @focus="widthFocused = true"
            @blur="onWidthBlur"
            @input="commitWidthDraft"
            @keydown="onWidthKeydown"
            @wheel="onWidthWheel"
          />
          <span class="text-[11px] text-muted-foreground">x</span>
          <input
            v-model="heightDraft"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            class="h-5 w-[64px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :aria-label="String(t('workspaceDock.preview.viewportHeight'))"
            :title="String(t('workspaceDock.preview.viewportHeight'))"
            @focus="heightFocused = true"
            @blur="onHeightBlur"
            @input="commitHeightDraft"
            @keydown="onHeightKeydown"
            @wheel="onHeightWheel"
          />
          <SidebarIconButton
            size="sm"
            :tooltip="String(t('workspaceDock.preview.rotateViewport'))"
            :aria-label="String(t('workspaceDock.preview.rotateViewport'))"
            :is-mobile-pointer="ui.isMobilePointer"
            @click="rotateViewport"
          >
            <RiAnticlockwiseLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </div>

        <div class="flex items-center gap-0.5">
          <SidebarIconButton
            size="sm"
            :tooltip="String(t('workspaceDock.preview.zoomOut'))"
            :aria-label="String(t('workspaceDock.preview.zoomOut'))"
            :is-mobile-pointer="ui.isMobilePointer"
            :disabled="viewportScalePct <= MIN_VIEWPORT_SCALE"
            @click="zoomOut"
          >
            <RiSubtractLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <button
            type="button"
            class="h-5 rounded-sm border border-sidebar-border/70 bg-sidebar-accent/35 px-1 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
            :title="String(t('workspaceDock.preview.zoomReset'))"
            :aria-label="String(t('workspaceDock.preview.zoomReset'))"
            @click="resetZoom"
          >
            {{ viewportScalePct }}%
          </button>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('workspaceDock.preview.zoomIn'))"
            :aria-label="String(t('workspaceDock.preview.zoomIn'))"
            :is-mobile-pointer="ui.isMobilePointer"
            :disabled="viewportScalePct >= MAX_VIEWPORT_SCALE"
            @click="zoomIn"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </div>
      </div>
    </div>

    <div class="oc-vscode-section">
      <div class="flex items-center justify-between gap-2 px-2 py-1.5">
        <div class="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {{ t('workspaceDock.preview.sessionsTitle') }}
        </div>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-1.5 py-1">
      <div v-if="preview.loading && preview.sessions.length === 0" class="px-2 py-6 text-xs text-muted-foreground">
        {{ t('workspaceDock.loading') }}
      </div>
      <div v-else-if="preview.sessions.length === 0" class="px-2 py-6 text-xs text-muted-foreground">
        {{ t('workspaceDock.preview.states.noSessionsForScope') }}
      </div>

      <div v-else class="space-y-1 pb-1">
        <ListItemFrame
          v-for="session in preview.sessions"
          :key="session.id"
          :active="preview.activeSessionId === session.id"
          density="compact"
          @click="selectSession(session.id)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] font-medium text-foreground" :title="session.directory || session.id">
                {{ sessionLabel(session) }}
              </div>
              <div class="truncate text-[11px] text-muted-foreground" :title="session.directory || session.id">
                {{ session.directory || session.id }}
              </div>
            </div>
          </div>

          <template #meta>
            <span
              class="rounded-full border border-sidebar-border/65 bg-sidebar-accent/35 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]"
            >
              {{ session.state }}
            </span>
          </template>
        </ListItemFrame>
      </div>
    </div>
  </section>
</template>
