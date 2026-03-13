<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiExternalLinkLine, RiLoader4Line, RiRefreshLine, RiSmartphoneLine, RiComputerLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import { apiUrl } from '@/lib/api'
import {
  createWorkspacePreviewSession,
  discoverWorkspacePreviewSession,
  type WorkspacePreviewSession,
} from '@/features/workspacePreview/api/workspacePreviewApi'
import { buildPreviewFrameSrc, type WorkspacePreviewScope } from '@/features/workspacePreview/model/previewUrl'
import { useDirectoryStore } from '@/stores/directory'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const directoryStore = useDirectoryStore()
const preview = useWorkspacePreviewStore()

const props = withDefaults(
  defineProps<{
    showControls?: boolean
  }>(),
  {
    showControls: true,
  },
)

const controlsVisible = computed(() => props.showControls !== false)

const frameSrc = shallowRef('')
const iframeLoading = ref(false)
const iframeError = ref('')
const createTargetUrl = ref('')
const actionLoading = ref<'create' | 'discover' | ''>('')
const actionError = ref('')

const FRAME_UPDATE_THROTTLE_MS = 220
const AUTO_REFRESH_MS = 12000

let frameTimer: number | null = null
let pollTimer: number | null = null
let lastFrameUpdateAt = 0
let frameRequestId = 0

const activeSession = computed(() => preview.activeSession)
const activeProxyBasePath = computed(() => activeSession.value?.proxyBasePath || '')
const previewSrc = computed(() => buildPreviewFrameSrc(activeProxyBasePath.value, preview.refreshToken))
const canOpenInWindow = computed(() => Boolean(previewSrc.value))
const currentDirectory = computed(() => String(directoryStore.currentDirectory || '').trim())
const canCreateSession = computed(() =>
  Boolean(currentDirectory.value && createTargetUrl.value.trim() && !actionLoading.value),
)
const canDiscoverSession = computed(() => Boolean(currentDirectory.value && !actionLoading.value))
const actionLoadingMessage = computed(() => {
  if (actionLoading.value === 'create') return String(t('workspaceDock.preview.emptyState.createLoading'))
  if (actionLoading.value === 'discover') return String(t('workspaceDock.preview.emptyState.discoverLoading'))
  return ''
})

const effectiveError = computed(() => {
  if (preview.error) {
    const detail = preview.error.trim() || String(t('workspaceDock.preview.states.sessionsFetchFailedNoDetail'))
    return String(t('workspaceDock.preview.states.sessionsFetchFailed', { detail }))
  }
  if (preview.sessions.length > 0 && !activeSession.value) {
    return String(t('workspaceDock.preview.states.activeSessionMissing'))
  }
  if (activeSession.value && !activeProxyBasePath.value) {
    return String(t('workspaceDock.preview.states.missingProxyBasePath'))
  }
  if (iframeError.value) return iframeError.value
  return ''
})

const showEmptyState = computed(() => preview.sessions.length === 0 && !preview.loading && !effectiveError.value)

function sessionLabel(session: WorkspacePreviewSession): string {
  const directory = String(session.directory || '')
    .trim()
    .replace(/[\\/]+$/, '')
  if (!directory) return session.id
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || directory
}

function extractProxyErrorDetail(raw: string, contentType: string): string {
  const body = String(raw || '').trim()
  if (!body) return ''

  const loweredType = String(contentType || '').toLowerCase()
  if (loweredType.includes('application/json') || body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const detail =
        (typeof parsed.error === 'string' && parsed.error.trim()) ||
        (typeof parsed.message === 'string' && parsed.message.trim()) ||
        (parsed.error &&
        typeof parsed.error === 'object' &&
        typeof (parsed.error as { message?: unknown }).message === 'string'
          ? String((parsed.error as { message?: unknown }).message || '').trim()
          : '')
      if (detail) return detail
    } catch {
      // Keep fallback text extraction below.
    }
  }

  return body.replace(/\s+/g, ' ').slice(0, 180)
}

function formatProxyHttpError(status: number, detail: string): string {
  const cleanDetail = String(detail || '').trim() || String(t('workspaceDock.preview.states.proxyHttpErrorNoDetail'))
  return String(t('workspaceDock.preview.states.proxyHttpError', { status, detail: cleanDetail }))
}

async function probePreviewProxy(src: string): Promise<string> {
  try {
    const response = await fetch(apiUrl(src), {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    })
    if (response.ok) return ''

    const body = await response.text().catch(() => '')
    const detail = extractProxyErrorDetail(body, response.headers.get('content-type') || '')
    return formatProxyHttpError(response.status, detail)
  } catch {
    return String(t('workspaceDock.preview.states.proxyRequestFailed'))
  }
}

function clearFrameTimer() {
  if (frameTimer === null) return
  window.clearTimeout(frameTimer)
  frameTimer = null
}

async function setFrameUrlNow() {
  clearFrameTimer()
  const src = previewSrc.value
  iframeError.value = ''
  if (!src || effectiveError.value) {
    frameSrc.value = ''
    iframeLoading.value = false
    lastFrameUpdateAt = Date.now()
    return
  }

  const requestId = ++frameRequestId
  iframeLoading.value = true
  const proxyError = await probePreviewProxy(src)
  if (requestId !== frameRequestId) return

  if (proxyError) {
    frameSrc.value = ''
    iframeLoading.value = false
    iframeError.value = proxyError
    lastFrameUpdateAt = Date.now()
    return
  }

  frameSrc.value = src
  lastFrameUpdateAt = Date.now()
}

function scheduleFrameUpdate() {
  clearFrameTimer()
  const elapsed = Date.now() - lastFrameUpdateAt
  const waitMs = Math.max(0, FRAME_UPDATE_THROTTLE_MS - elapsed)
  frameTimer = window.setTimeout(() => {
    frameTimer = null
    void setFrameUrlNow()
  }, waitMs)
}

async function refreshPreview(opts?: { forceFrameReload?: boolean }) {
  const directory = String(directoryStore.currentDirectory || '')
  const scopes = new Set<WorkspacePreviewScope>(['current', preview.scope])
  for (const scope of scopes) {
    await preview.refreshSessions(directory, scope)
  }
  if (opts?.forceFrameReload) {
    preview.bumpRefreshToken()
  }
}

async function selectSessionAfterAction(session: WorkspacePreviewSession) {
  await refreshPreview()
  preview.selectSession(session.id)
  preview.bumpRefreshToken()
}

async function createManagedSession() {
  if (!currentDirectory.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.directoryRequired'))
    return
  }

  const targetUrl = createTargetUrl.value.trim()
  if (!targetUrl) {
    actionError.value = String(t('workspaceDock.preview.emptyState.targetUrlRequired'))
    return
  }

  actionLoading.value = 'create'
  actionError.value = ''
  try {
    const session = await createWorkspacePreviewSession(currentDirectory.value, targetUrl)
    createTargetUrl.value = ''
    await selectSessionAfterAction(session)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    actionError.value = String(t('workspaceDock.preview.emptyState.createFailed', { detail }))
  } finally {
    actionLoading.value = ''
  }
}

async function discoverManagedSession() {
  if (!currentDirectory.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.directoryRequired'))
    return
  }

  actionLoading.value = 'discover'
  actionError.value = ''
  try {
    const session = await discoverWorkspacePreviewSession(currentDirectory.value)
    await selectSessionAfterAction(session)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    actionError.value = String(t('workspaceDock.preview.emptyState.discoverFailed', { detail }))
  } finally {
    actionLoading.value = ''
  }
}

async function onScopeChange(scope: WorkspacePreviewScope) {
  if (preview.scope === scope) return
  preview.setScope(scope)
  await preview.refreshSessions(String(directoryStore.currentDirectory || ''), scope)
}

function openInNewWindow() {
  if (!previewSrc.value) return
  window.open(previewSrc.value, '_blank', 'noopener,noreferrer')
}

function startAutoRefresh() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  pollTimer = window.setInterval(() => {
    void refreshPreview()
  }, AUTO_REFRESH_MS)
}

function stopAutoRefresh() {
  if (pollTimer === null) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

function onIframeLoad() {
  iframeLoading.value = false
  iframeError.value = ''
}

function onIframeError() {
  iframeLoading.value = false
  iframeError.value = String(t('workspaceDock.preview.states.errorDescription'))
}

defineExpose({
  refresh: () => refreshPreview({ forceFrameReload: true }),
})

watch(
  () => [activeProxyBasePath.value, preview.refreshToken, preview.error, preview.activeSessionId],
  () => {
    scheduleFrameUpdate()
  },
  { immediate: true },
)

watch(
  () => directoryStore.currentDirectory,
  () => {
    void refreshPreview()
  },
)

onMounted(() => {
  void refreshPreview()
  startAutoRefresh()
})

onBeforeUnmount(() => {
  clearFrameTimer()
  stopAutoRefresh()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3">
    <div v-if="controlsVisible" class="rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 p-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div
          class="inline-flex items-center gap-0.5 rounded-md border border-sidebar-border/65 bg-sidebar-accent/35 p-0.5"
        >
          <SegmentedButton :active="preview.scope === 'current'" size="xs" @click="onScopeChange('current')">
            {{ t('workspaceDock.preview.scope.current') }}
          </SegmentedButton>
          <SegmentedButton :active="preview.scope === 'all'" size="xs" @click="onScopeChange('all')">
            {{ t('workspaceDock.preview.scope.all') }}
          </SegmentedButton>
        </div>

        <div class="flex items-center gap-1.5">
          <IconButton
            size="sm"
            :tooltip="String(t('workspaceDock.preview.refresh'))"
            :aria-label="String(t('workspaceDock.preview.refresh'))"
            :loading="preview.loading"
            @click="refreshPreview({ forceFrameReload: true })"
          >
            <RiRefreshLine class="h-4 w-4" />
          </IconButton>
          <IconButton
            size="sm"
            :tooltip="String(t('workspaceDock.preview.openInWindow'))"
            :aria-label="String(t('workspaceDock.preview.openInWindow'))"
            :disabled="!canOpenInWindow"
            @click="openInNewWindow"
          >
            <RiExternalLinkLine class="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div class="mt-2 rounded-md border border-sidebar-border/60 bg-background/55 p-1.5">
        <div
          class="flex items-center justify-between gap-2 px-1 pb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
        >
          <span>{{ t('workspaceDock.preview.sessionsTitle') }}</span>
          <span>{{ preview.sessions.length }}</span>
        </div>
        <div v-if="preview.sessions.length > 0" class="max-h-36 space-y-1 overflow-auto pr-1">
          <button
            v-for="session in preview.sessions"
            :key="session.id"
            type="button"
            class="w-full rounded-md border px-2 py-1.5 text-left transition-colors"
            :class="
              preview.activeSessionId === session.id
                ? 'border-primary/45 bg-primary/10 text-foreground'
                : 'border-transparent bg-sidebar-accent/20 text-foreground hover:border-sidebar-border/65 hover:bg-sidebar-accent/35'
            "
            @click="preview.selectSession(session.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-xs font-medium">{{ sessionLabel(session) }}</span>
              <span
                class="shrink-0 rounded-full border border-sidebar-border/65 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
              >
                {{ session.state }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ session.directory || session.id }}</p>
          </button>
        </div>
        <p v-else class="px-1 py-2 text-xs text-muted-foreground">
          {{ t('workspaceDock.preview.states.noSessionsForScope') }}
        </p>
      </div>

      <div class="mt-2 flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1 space-y-0.5 text-[11px] text-muted-foreground">
          <p class="truncate">
            {{ t('workspaceDock.preview.directoryLabel') }}
            <span class="font-mono">{{ activeSession?.directory || t('workspaceDock.preview.urlEmpty') }}</span>
          </p>
          <p class="truncate">
            {{ t('workspaceDock.preview.targetLabel') }}
            <span class="font-mono">{{ activeSession?.targetUrl || t('workspaceDock.preview.urlEmpty') }}</span>
          </p>
          <p class="truncate">
            {{ t('workspaceDock.preview.proxyPathLabel') }}
            <span class="font-mono">{{ activeProxyBasePath || t('workspaceDock.preview.urlEmpty') }}</span>
          </p>
        </div>
        <div
          class="inline-flex items-center gap-0.5 rounded-md border border-sidebar-border/65 bg-sidebar-accent/35 p-0.5"
        >
          <SegmentedButton :active="preview.viewport === 'desktop'" size="xs" @click="preview.setViewport('desktop')">
            <span class="inline-flex items-center gap-1">
              <RiComputerLine class="h-3 w-3" />
              {{ t('workspaceDock.preview.viewportDesktop') }}
            </span>
          </SegmentedButton>
          <SegmentedButton :active="preview.viewport === 'mobile'" size="xs" @click="preview.setViewport('mobile')">
            <span class="inline-flex items-center gap-1">
              <RiSmartphoneLine class="h-3 w-3" />
              {{ t('workspaceDock.preview.viewportMobile') }}
            </span>
          </SegmentedButton>
        </div>
      </div>
    </div>

    <div class="relative min-h-0 flex-1 overflow-hidden rounded-md border border-sidebar-border/65 bg-background/80">
      <div v-if="showEmptyState" class="flex h-full items-center justify-center p-4 text-center">
        <div
          class="max-w-[24rem] rounded-md border border-dashed border-sidebar-border/70 bg-sidebar-accent/10 p-4 text-left"
        >
          <p class="text-sm font-medium">{{ t('workspaceDock.preview.states.emptyTitle') }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('workspaceDock.preview.states.emptyDescription') }}</p>
          <div class="mt-3 space-y-2">
            <div class="space-y-1">
              <label
                class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                for="workspace-preview-target-url"
              >
                {{ t('workspaceDock.preview.emptyState.targetUrlLabel') }}
              </label>
              <Input
                id="workspace-preview-target-url"
                v-model="createTargetUrl"
                type="url"
                :placeholder="String(t('workspaceDock.preview.emptyState.targetUrlPlaceholder'))"
                :disabled="Boolean(actionLoading)"
                class="h-8 bg-background/80 text-xs"
                @keydown.enter.prevent="createManagedSession"
              />
            </div>

            <p class="truncate text-[11px] text-muted-foreground">
              {{ t('workspaceDock.preview.directoryLabel') }}
              <span class="font-mono">{{
                currentDirectory || t('workspaceDock.preview.emptyState.directoryEmpty')
              }}</span>
            </p>

            <div class="flex flex-wrap gap-2">
              <Button size="sm" :disabled="!canCreateSession" @click="createManagedSession">
                {{ t('workspaceDock.preview.emptyState.addAction') }}
              </Button>
              <Button size="sm" variant="outline" :disabled="!canDiscoverSession" @click="discoverManagedSession">
                {{ t('workspaceDock.preview.emptyState.autoDetectAction') }}
              </Button>
            </div>

            <p v-if="actionLoadingMessage" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
              {{ actionLoadingMessage }}
            </p>
            <p v-else-if="actionError" class="text-xs text-destructive">{{ actionError }}</p>
          </div>
        </div>
      </div>

      <div v-else-if="effectiveError" class="flex h-full items-center justify-center p-4 text-center">
        <div class="max-w-[24rem] rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <p class="text-sm font-medium text-destructive">{{ t('workspaceDock.preview.states.errorTitle') }}</p>
          <p class="mt-1 text-xs text-destructive/90">{{ effectiveError }}</p>
        </div>
      </div>

      <div v-else class="flex h-full items-center justify-center p-2">
        <div
          class="h-full w-full overflow-hidden rounded-md border border-sidebar-border/55 bg-background"
          :class="preview.viewport === 'mobile' ? 'max-w-[390px]' : ''"
        >
          <iframe
            v-if="frameSrc"
            :src="frameSrc"
            class="h-full w-full border-0"
            :title="String(t('workspaceDock.preview.iframeTitle'))"
            loading="eager"
            @load="onIframeLoad"
            @error="onIframeError"
          />
        </div>
      </div>

      <div
        v-if="iframeLoading || preview.loading"
        class="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[1px]"
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border/60 bg-sidebar/85 px-2 py-1 text-xs"
        >
          <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
          {{ t('workspaceDock.preview.states.loading') }}
        </span>
      </div>
    </div>
  </div>
</template>
