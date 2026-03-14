<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RiArrowDownSLine,
  RiAddLine,
  RiAnticlockwiseLine,
  RiComputerLine,
  RiExternalLinkLine,
  RiFileList2Line,
  RiLoader4Line,
  RiRefreshLine,
  RiSmartphoneLine,
  RiSubtractLine,
  RiStackLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { apiUrl } from '@/lib/api'
import {
  createWorkspacePreviewSession,
  discoverWorkspacePreviewSession,
  type WorkspacePreviewSession,
} from '@/features/workspacePreview/api/workspacePreviewApi'
import { buildPreviewFrameSrc, type WorkspacePreviewScope } from '@/features/workspacePreview/model/previewUrl'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const directoryStore = useDirectoryStore()
const ui = useUiStore()
const preview = useWorkspacePreviewStore()

type PreviewViewerMode = 'fill' | 'responsive'

const props = withDefaults(
  defineProps<{
    showControls?: boolean
    viewerMode?: PreviewViewerMode
  }>(),
  {
    showControls: true,
    viewerMode: 'fill',
  },
)

const controlsVisible = computed(() => props.showControls !== false)

const viewerMode = computed<PreviewViewerMode>(() => (props.viewerMode === 'responsive' ? 'responsive' : 'fill'))

const MIN_VIEWPORT_SCALE = 25
const MAX_VIEWPORT_SCALE = 200
const VIEWPORT_SCALE_STEP = 10

const headerViewportScalePct = computed(() =>
  Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, Math.round(Number(preview.viewportScale) || 100))),
)

function zoomOut() {
  preview.setViewportScale(headerViewportScalePct.value - VIEWPORT_SCALE_STEP)
}

function zoomIn() {
  preview.setViewportScale(headerViewportScalePct.value + VIEWPORT_SCALE_STEP)
}

function resetZoom() {
  preview.setViewportScale(100)
}

const MIN_VIEWPORT_WIDTH = 240
const MIN_VIEWPORT_HEIGHT = 180
const MAX_VIEWPORT_WIDTH = 4096
const MAX_VIEWPORT_HEIGHT = 4096

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

const viewportWidthPx = computed(() => clampInt(preview.viewportWidth, 1024, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH))
const viewportHeightPx = computed(() => clampInt(preview.viewportHeight, 768, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT))
const viewportScalePct = computed(() => clampInt(preview.viewportScale, 100, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE))
const viewportScale = computed(() => viewportScalePct.value / 100)
const scaledViewportWidthPx = computed(() => Math.max(1, Math.round(viewportWidthPx.value * viewportScale.value)))
const scaledViewportHeightPx = computed(() => Math.max(1, Math.round(viewportHeightPx.value * viewportScale.value)))

const VIEWPORT_SIZE_STEP_PX = 1
const VIEWPORT_SIZE_FAST_STEP_PX = 10

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
  preview.setViewportSize({ width: viewportWidthPx.value + delta })
  widthDraft.value = String(preview.viewportWidth || '')
}

function bumpViewportHeight(delta: number) {
  preview.setViewportSize({ height: viewportHeightPx.value + delta })
  heightDraft.value = String(preview.viewportHeight || '')
}

function rotateViewport() {
  preview.setViewportSize({ width: viewportHeightPx.value, height: viewportWidthPx.value })
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

type ViewportResizeState = {
  pointerId: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

const viewportResize = ref<ViewportResizeState | null>(null)
const resizingViewport = computed(() => viewerMode.value === 'responsive' && viewportResize.value !== null)

function startViewportResize(event: PointerEvent) {
  if (viewerMode.value !== 'responsive') return
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return

  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // ignore
  }

  viewportResize.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: viewportWidthPx.value,
    startHeight: viewportHeightPx.value,
  }
}

function moveViewportResize(event: PointerEvent) {
  const state = viewportResize.value
  if (!state) return
  if (event.pointerId !== state.pointerId) return
  event.preventDefault()

  const scale = viewportScale.value || 1
  const dx = (event.clientX - state.startX) / scale
  const dy = (event.clientY - state.startY) / scale
  preview.setViewportSize({ width: Math.round(state.startWidth + dx), height: Math.round(state.startHeight + dy) })
}

function stopViewportResize(event: PointerEvent) {
  const state = viewportResize.value
  if (!state) return
  if (event.pointerId !== state.pointerId) return
  viewportResize.value = null

  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  try {
    target.releasePointerCapture(event.pointerId)
  } catch {
    // ignore
  }
}

const iframeEl = ref<HTMLIFrameElement | null>(null)
const touchOverlayEl = ref<HTMLElement | null>(null)

const touchSimulationEnabled = computed(() => viewerMode.value === 'responsive' && preview.viewport === 'mobile')
const touchSimulationReady = ref(false)

type TouchSimAxis = 'none' | 'x' | 'y'

type TouchSimState = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  axis: TouchSimAxis
  target: Element | null
  moved: boolean
}

const touchSim = ref<TouchSimState | null>(null)

const TOUCH_TAP_SLOP_PX = 6
const TOUCH_AXIS_LOCK_RATIO = 1.15

function resolveIframeContext(): { win: Window; doc: Document } | null {
  const iframe = iframeEl.value
  if (!iframe) return null
  try {
    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    if (!win || !doc) return null
    // Touch simulation only works for same-origin previews.
    void doc.body
    return { win, doc }
  } catch {
    return null
  }
}

function resolveViewportPoint(event: PointerEvent): { x: number; y: number } | null {
  const overlay = touchOverlayEl.value
  if (!overlay) return null
  const rect = overlay.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const scale = viewportScale.value || 1

  const rawX = (event.clientX - rect.left) / scale
  const rawY = (event.clientY - rect.top) / scale
  const maxX = Math.max(0, viewportWidthPx.value - 1)
  const maxY = Math.max(0, viewportHeightPx.value - 1)
  return {
    x: Math.max(0, Math.min(maxX, Math.round(rawX))),
    y: Math.max(0, Math.min(maxY, Math.round(rawY))),
  }
}

function elementAtPoint(ctx: { doc: Document }, point: { x: number; y: number }): Element | null {
  try {
    return (ctx.doc.elementFromPoint(point.x, point.y) as Element | null) || ctx.doc.body || ctx.doc.documentElement
  } catch {
    return ctx.doc.body || ctx.doc.documentElement
  }
}

function tryDispatchTouchEvent(
  ctx: { win: Window; doc: Document },
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  target: Element,
  point: { x: number; y: number },
): boolean | null {
  const TouchCtor = (ctx.win as unknown as { Touch?: unknown }).Touch
  const TouchEventCtor = (ctx.win as unknown as { TouchEvent?: unknown }).TouchEvent
  if (typeof TouchCtor !== 'function' || typeof TouchEventCtor !== 'function') return null

  try {
    const touch = new (TouchCtor as new (init: any) => Touch)({
      identifier: 0,
      target,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      pageX: point.x + ctx.win.scrollX,
      pageY: point.y + ctx.win.scrollY,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 0.5,
    })

    const touches = type === 'touchend' || type === 'touchcancel' ? [] : [touch]
    const changedTouches = [touch]
    const ev = new (TouchEventCtor as new (type: string, init: TouchEventInit) => TouchEvent)(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches,
      targetTouches: touches,
      changedTouches,
    })
    return target.dispatchEvent(ev)
  } catch {
    return null
  }
}

function tryDispatchPointerEvent(
  ctx: { win: Window },
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  target: Element,
  point: { x: number; y: number },
  input: { pointerId: number; buttons: number },
): boolean | null {
  const PointerEventCtor = (ctx.win as unknown as { PointerEvent?: unknown }).PointerEvent
  if (typeof PointerEventCtor !== 'function') return null
  try {
    const ev = new (PointerEventCtor as new (type: string, init: PointerEventInit) => PointerEvent)(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: input.pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
      buttons: input.buttons,
      button: input.buttons ? 0 : -1,
      pressure: input.buttons ? 0.5 : 0,
    })
    return target.dispatchEvent(ev)
  } catch {
    return null
  }
}

function dispatchClick(ctx: { win: Window }, target: Element, point: { x: number; y: number }) {
  try {
    const ev = new ctx.win.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
    })
    target.dispatchEvent(ev)
  } catch {
    // ignore
  }
}

function touchOverlayPointerDown(event: PointerEvent) {
  if (!touchSimulationEnabled.value || !touchSimulationReady.value) return
  if (event.button !== 0) return

  const ctx = resolveIframeContext()
  if (!ctx) return
  const point = resolveViewportPoint(event)
  if (!point) return

  const target = elementAtPoint(ctx, point)
  if (!target) return

  event.preventDefault()
  event.stopPropagation()

  try {
    touchOverlayEl.value?.setPointerCapture(event.pointerId)
  } catch {
    // ignore
  }

  touchSim.value = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    lastX: point.x,
    lastY: point.y,
    axis: 'none',
    target,
    moved: false,
  }

  void tryDispatchTouchEvent(ctx, 'touchstart', target, point)
  void tryDispatchPointerEvent(ctx, 'pointerdown', target, point, { pointerId: event.pointerId, buttons: 1 })
}

function touchOverlayPointerMove(event: PointerEvent) {
  const state = touchSim.value
  if (!state) return
  if (event.pointerId !== state.pointerId) return

  const ctx = resolveIframeContext()
  if (!ctx) return
  const point = resolveViewportPoint(event)
  if (!point) return

  event.preventDefault()

  const dxFromStart = point.x - state.startX
  const dyFromStart = point.y - state.startY
  const absDxFromStart = Math.abs(dxFromStart)
  const absDyFromStart = Math.abs(dyFromStart)

  if (!state.moved && Math.max(absDxFromStart, absDyFromStart) >= TOUCH_TAP_SLOP_PX) {
    state.moved = true
  }

  if (state.axis === 'none' && Math.max(absDxFromStart, absDyFromStart) >= TOUCH_TAP_SLOP_PX) {
    state.axis = absDyFromStart > absDxFromStart * TOUCH_AXIS_LOCK_RATIO ? 'y' : 'x'
  }

  const target = state.target || elementAtPoint(ctx, point)
  if (!target) return

  const touchOk = tryDispatchTouchEvent(ctx, 'touchmove', target, point)
  const pointerOk = tryDispatchPointerEvent(ctx, 'pointermove', target, point, {
    pointerId: state.pointerId,
    buttons: 1,
  })
  const allowDefault = touchOk !== false && pointerOk !== false

  if (state.axis === 'y' && allowDefault) {
    const dy = point.y - state.lastY
    try {
      ctx.win.scrollBy(0, -dy)
    } catch {
      // ignore
    }
  }

  state.lastX = point.x
  state.lastY = point.y
}

function touchOverlayPointerUp(event: PointerEvent) {
  const state = touchSim.value
  if (!state) return
  if (event.pointerId !== state.pointerId) return

  const ctx = resolveIframeContext()
  touchSim.value = null

  try {
    touchOverlayEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    // ignore
  }

  if (!ctx) return
  const point = resolveViewportPoint(event)
  if (!point) return

  const target = elementAtPoint(ctx, point)
  if (!target) return

  void tryDispatchTouchEvent(ctx, 'touchend', target, point)
  void tryDispatchPointerEvent(ctx, 'pointerup', target, point, { pointerId: event.pointerId, buttons: 0 })

  const absDx = Math.abs(point.x - state.startX)
  const absDy = Math.abs(point.y - state.startY)
  if (Math.max(absDx, absDy) < TOUCH_TAP_SLOP_PX) {
    dispatchClick(ctx, target, point)
  }
}

function touchOverlayPointerCancel(event: PointerEvent) {
  const state = touchSim.value
  if (!state) return
  if (event.pointerId !== state.pointerId) return

  const ctx = resolveIframeContext()
  touchSim.value = null

  try {
    touchOverlayEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    // ignore
  }

  if (!ctx) return
  const point = resolveViewportPoint(event)
  if (!point) return
  const target = state.target || elementAtPoint(ctx, point)
  if (!target) return

  void tryDispatchTouchEvent(ctx, 'touchcancel', target, point)
  void tryDispatchPointerEvent(ctx, 'pointercancel', target, point, { pointerId: event.pointerId, buttons: 0 })
}

function touchOverlayWheel(event: WheelEvent) {
  if (!touchSimulationEnabled.value || !touchSimulationReady.value) return
  const ctx = resolveIframeContext()
  if (!ctx) return
  try {
    ctx.win.scrollBy(event.deltaX || 0, event.deltaY || 0)
  } catch {
    // ignore
  }
}

const frameSrc = shallowRef('')
const iframeLoading = ref(false)
const iframeError = ref('')
const createTargetUrl = ref('')
const actionLoading = ref<'create' | 'discover' | ''>('')
const actionError = ref('')
const sessionMenuOpen = ref(false)
const sessionMenuQuery = ref('')

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

const sessionPickerLabel = computed(() => String(t('workspaceDock.preview.sessionsTitle')))

const activeSessionLabel = computed(() => {
  const active = preview.sessions.find((session) => session.id === preview.activeSessionId)
  if (active) return sessionLabel(active)
  if (preview.sessions.length > 0) return sessionLabel(preview.sessions[0]!)
  return String(t('workspaceDock.preview.urlEmpty'))
})

const sessionMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'workspace-preview-sessions',
    items: preview.sessions.map((session) => ({
      id: session.id,
      label: sessionLabel(session),
      description: String(session.state || ''),
      checked: preview.activeSessionId === session.id,
      keywords: `${sessionLabel(session)} ${session.id} ${session.state || ''} ${session.directory || ''} ${
        session.targetUrl || ''
      }`,
    })),
  },
])

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

function setSessionMenuOpen(open: boolean) {
  sessionMenuOpen.value = Boolean(open)
  if (!open) sessionMenuQuery.value = ''
}

function setSessionMenuQuery(value: string) {
  sessionMenuQuery.value = String(value || '')
}

function onSessionMenuSelect(item: OptionMenuItem) {
  preview.selectSession(item.id)
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
  touchSimulationReady.value = touchSimulationEnabled.value && Boolean(resolveIframeContext())
}

function onIframeError() {
  iframeLoading.value = false
  iframeError.value = String(t('workspaceDock.preview.states.errorDescription'))
  touchSimulationReady.value = false
}

defineExpose({
  refresh: () => refreshPreview({ forceFrameReload: true }),
})

watch(
  touchSimulationEnabled,
  (enabled) => {
    if (!enabled) {
      touchSimulationReady.value = false
      return
    }
    touchSimulationReady.value = Boolean(resolveIframeContext())
  },
  { immediate: true },
)

watch(frameSrc, () => {
  touchSimulationReady.value = false
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
      <div class="relative flex items-center gap-1.5">
        <IconButton
          size="sm"
          :disabled="preview.loading"
          :tooltip="
            preview.scope === 'current'
              ? String(t('workspaceDock.preview.scope.current'))
              : String(t('workspaceDock.preview.scope.all'))
          "
          :aria-label="
            preview.scope === 'current'
              ? String(t('workspaceDock.preview.scope.current'))
              : String(t('workspaceDock.preview.scope.all'))
          "
          @click="onScopeChange(preview.scope === 'current' ? 'all' : 'current')"
        >
          <RiFileList2Line v-if="preview.scope === 'current'" class="h-4 w-4" />
          <RiStackLine v-else class="h-4 w-4" />
        </IconButton>

        <button
          type="button"
          class="inline-flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border-0 bg-transparent px-1.5 text-xs text-foreground transition-colors hover:bg-sidebar-accent/35 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="preview.loading || preview.sessions.length === 0"
          :aria-label="sessionPickerLabel"
          @click.stop="setSessionMenuOpen(!sessionMenuOpen)"
        >
          <span class="min-w-0 truncate text-left text-xs font-medium">{{ activeSessionLabel }}</span>
          <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        <div class="flex h-8 items-center gap-0.5">
          <IconButton
            size="sm"
            class="transition-colors"
            :class="preview.viewport === 'mobile' ? 'bg-sidebar-accent/70 text-foreground shadow-inner' : ''"
            :aria-pressed="preview.viewport === 'mobile'"
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
            @click="preview.setViewport(preview.viewport === 'desktop' ? 'mobile' : 'desktop')"
          >
            <RiComputerLine v-if="preview.viewport === 'desktop'" class="h-4 w-4" />
            <RiSmartphoneLine v-else class="h-4 w-4" />
          </IconButton>
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

        <OptionMenu
          :open="sessionMenuOpen"
          :query="sessionMenuQuery"
          :groups="sessionMenuGroups"
          :title="sessionPickerLabel"
          :mobile-title="sessionPickerLabel"
          :searchable="true"
          :is-mobile-pointer="ui.isMobilePointer"
          :paginated="true"
          :page-size="18"
          :loading="preview.loading"
          desktop-placement="bottom-start"
          desktop-class="w-72"
          @update:open="setSessionMenuOpen"
          @update:query="setSessionMenuQuery"
          @select="onSessionMenuSelect"
        />
      </div>

      <div v-if="viewerMode === 'responsive'" class="mt-1 flex flex-wrap items-center justify-between gap-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <input
            v-model="widthDraft"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            class="h-6 w-[64px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            class="h-6 w-[64px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :aria-label="String(t('workspaceDock.preview.viewportHeight'))"
            :title="String(t('workspaceDock.preview.viewportHeight'))"
            @focus="heightFocused = true"
            @blur="onHeightBlur"
            @input="commitHeightDraft"
            @keydown="onHeightKeydown"
            @wheel="onHeightWheel"
          />
          <IconButton
            size="xs"
            :tooltip="String(t('workspaceDock.preview.rotateViewport'))"
            :aria-label="String(t('workspaceDock.preview.rotateViewport'))"
            @click="rotateViewport"
          >
            <RiAnticlockwiseLine class="h-4 w-4" />
          </IconButton>
        </div>

        <div class="flex items-center gap-0.5">
          <IconButton
            size="xs"
            :tooltip="String(t('workspaceDock.preview.zoomOut'))"
            :aria-label="String(t('workspaceDock.preview.zoomOut'))"
            :disabled="headerViewportScalePct <= MIN_VIEWPORT_SCALE"
            @click="zoomOut"
          >
            <RiSubtractLine class="h-4 w-4" />
          </IconButton>
          <button
            type="button"
            class="h-6 rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-sidebar-accent/35 hover:text-foreground"
            :title="String(t('workspaceDock.preview.zoomReset'))"
            :aria-label="String(t('workspaceDock.preview.zoomReset'))"
            @click="resetZoom"
          >
            {{ headerViewportScalePct }}%
          </button>
          <IconButton
            size="xs"
            :tooltip="String(t('workspaceDock.preview.zoomIn'))"
            :aria-label="String(t('workspaceDock.preview.zoomIn'))"
            :disabled="headerViewportScalePct >= MAX_VIEWPORT_SCALE"
            @click="zoomIn"
          >
            <RiAddLine class="h-4 w-4" />
          </IconButton>
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

      <div v-else class="h-full">
        <div v-if="viewerMode === 'responsive'" class="flex h-full w-full overflow-auto bg-sidebar-accent/10 p-4">
          <div class="mx-auto my-auto">
            <div
              class="relative overflow-hidden rounded-md border border-sidebar-border/60 bg-background shadow-sm"
              :style="{ width: `${scaledViewportWidthPx}px`, height: `${scaledViewportHeightPx}px` }"
            >
              <div
                class="origin-top-left"
                :style="{
                  width: `${viewportWidthPx}px`,
                  height: `${viewportHeightPx}px`,
                  transform: `scale(${viewportScale})`,
                }"
              >
                <iframe
                  v-if="frameSrc"
                  ref="iframeEl"
                  :src="frameSrc"
                  class="h-full w-full border-0"
                  :class="resizingViewport ? 'pointer-events-none' : ''"
                  :title="String(t('workspaceDock.preview.iframeTitle'))"
                  loading="eager"
                  @load="onIframeLoad"
                  @error="onIframeError"
                />
              </div>

              <div
                v-if="touchSimulationReady && frameSrc"
                ref="touchOverlayEl"
                class="absolute inset-0 z-10 touch-none cursor-grab active:cursor-grabbing"
                :class="resizingViewport ? 'pointer-events-none' : ''"
                @pointerdown="touchOverlayPointerDown"
                @pointermove="touchOverlayPointerMove"
                @pointerup="touchOverlayPointerUp"
                @pointercancel="touchOverlayPointerCancel"
                @wheel.prevent="touchOverlayWheel"
              />

              <div
                class="pointer-events-none absolute left-2 top-2 rounded-sm border border-sidebar-border/60 bg-background/75 px-1.5 py-1 text-[11px] font-mono text-muted-foreground backdrop-blur"
              >
                {{ viewportWidthPx }} x {{ viewportHeightPx }} · {{ viewportScalePct }}%
              </div>

              <button
                type="button"
                class="absolute bottom-0 right-0 z-20 h-6 w-6 touch-none cursor-nwse-resize"
                :title="String(t('workspaceDock.preview.resizeViewport'))"
                :aria-label="String(t('workspaceDock.preview.resizeViewport'))"
                @pointerdown.prevent.stop="startViewportResize"
                @pointermove="moveViewportResize"
                @pointerup="stopViewportResize"
                @pointercancel="stopViewportResize"
              >
                <span class="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-sidebar-border/70" />
              </button>
            </div>
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
