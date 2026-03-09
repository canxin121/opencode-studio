<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiExternalLinkLine, RiLoader4Line, RiRefreshLine, RiSmartphoneLine, RiComputerLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import { apiUrl } from '@/lib/api'
import {
  buildPreviewFrameSrc,
  buildPreviewProxyPath,
  normalizePreviewUrl,
} from '@/features/workspacePreview/model/previewUrl'
import { useDirectoryStore } from '@/stores/directory'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const directoryStore = useDirectoryStore()
const preview = useWorkspacePreviewStore()

const urlDraft = ref(preview.manualUrl)
const frameSrc = shallowRef('')
const iframeLoading = ref(false)
const iframeError = ref('')
const refreshToken = ref(0)

const INPUT_DEBOUNCE_MS = 340
const FRAME_UPDATE_THROTTLE_MS = 220
const AUTO_REFRESH_MS = 12000

let inputTimer: number | null = null
let frameTimer: number | null = null
let pollTimer: number | null = null
let lastFrameUpdateAt = 0
let frameRequestId = 0

const hasActiveUrl = computed(() => Boolean(preview.activeUrl))
const proxyAccessPath = computed(() => buildPreviewProxyPath(preview.activeUrl))
const canOpenInWindow = computed(() => Boolean(proxyAccessPath.value))
const hasInvalidManualDraft = computed(() => Boolean(urlDraft.value.trim()) && !normalizePreviewUrl(urlDraft.value))

const effectiveError = computed(() => {
  if (hasInvalidManualDraft.value) return String(t('workspaceDock.preview.states.invalidUrl'))
  if (iframeError.value) return iframeError.value
  if (preview.resolveError) return preview.resolveError
  return ''
})

const showEmptyState = computed(() => !hasActiveUrl.value && !preview.resolving && !effectiveError.value)

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

function clearInputTimer() {
  if (inputTimer === null) return
  window.clearTimeout(inputTimer)
  inputTimer = null
}

function clearFrameTimer() {
  if (frameTimer === null) return
  window.clearTimeout(frameTimer)
  frameTimer = null
}

async function setFrameUrlNow() {
  clearFrameTimer()
  const src = buildPreviewFrameSrc(preview.activeUrl, refreshToken.value)
  iframeError.value = ''
  if (!src) {
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

function onUrlDraftInput(value: string) {
  urlDraft.value = String(value || '')
  clearInputTimer()
  inputTimer = window.setTimeout(() => {
    inputTimer = null
    preview.setManualUrl(urlDraft.value)
    preview.clearResolveError()
  }, INPUT_DEBOUNCE_MS)
}

async function refreshPreview(opts?: { forceFrameReload?: boolean }) {
  const directory = String(directoryStore.currentDirectory || '')
  await preview.refreshDetectedUrl(directory)
  if (opts?.forceFrameReload) {
    refreshToken.value += 1
  }
}

function openInNewWindow() {
  const src = buildPreviewFrameSrc(preview.activeUrl, refreshToken.value)
  if (!src) return
  window.open(src, '_blank', 'noopener,noreferrer')
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
  () => preview.manualUrl,
  (next) => {
    if (normalizePreviewUrl(urlDraft.value) === next) return
    urlDraft.value = next
  },
)

watch(
  () => [preview.activeUrl, refreshToken.value],
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
  clearInputTimer()
  clearFrameTimer()
  stopAutoRefresh()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3">
    <div class="rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 p-2">
      <div class="flex items-center gap-1.5">
        <input
          :value="urlDraft"
          class="h-8 w-full rounded-md border border-sidebar-border/70 bg-background/70 px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary/55 focus:ring-2 focus:ring-primary/20"
          :placeholder="String(t('workspaceDock.preview.inputPlaceholder'))"
          :aria-label="String(t('workspaceDock.preview.inputAria'))"
          @input="onUrlDraftInput(($event.target as HTMLInputElement).value)"
        />
        <IconButton
          size="sm"
          :tooltip="String(t('workspaceDock.preview.refresh'))"
          :aria-label="String(t('workspaceDock.preview.refresh'))"
          :loading="preview.resolving"
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

      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1 space-y-0.5 text-[11px] text-muted-foreground">
          <p class="truncate">
            {{ t('workspaceDock.preview.targetLabel') }}
            <span class="font-mono">{{ hasActiveUrl ? preview.activeUrl : t('workspaceDock.preview.urlEmpty') }}</span>
          </p>
          <p class="truncate">
            {{ t('workspaceDock.preview.proxyPathLabel') }}
            <span class="font-mono">{{ proxyAccessPath || t('workspaceDock.preview.urlEmpty') }}</span>
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
        <div class="max-w-[24rem] rounded-md border border-dashed border-sidebar-border/70 bg-sidebar-accent/10 p-4">
          <p class="text-sm font-medium">{{ t('workspaceDock.preview.states.emptyTitle') }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('workspaceDock.preview.states.emptyDescription') }}</p>
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
        v-if="iframeLoading || preview.resolving"
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
