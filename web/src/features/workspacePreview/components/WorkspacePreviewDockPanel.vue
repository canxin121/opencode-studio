<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  RiArrowDownSLine,
  RiAddLine,
  RiAnticlockwiseLine,
  RiComputerLine,
  RiExternalLinkLine,
  RiHand,
  RiLoader4Line,
  RiPlayLine,
  RiRefreshLine,
  RiSmartphoneLine,
  RiStopLine,
  RiSubtractLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { apiUrl } from '@/lib/api'
import type { WorkspacePreviewSession } from '@/features/workspacePreview/api/workspacePreviewApi'
import { buildPreviewFrameSrc } from '@/features/workspacePreview/model/previewUrl'
import { useChatStore } from '@/stores/chat'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const route = useRoute()
const chat = useChatStore()
const directoryStore = useDirectoryStore()
const ui = useUiStore()
const preview = useWorkspacePreviewStore()

type PreviewViewerMode = 'fill' | 'responsive'

type PreviewControlsVariant = 'full' | 'viewport'

const props = withDefaults(
  defineProps<{
    showControls?: boolean
    controlsVariant?: PreviewControlsVariant
    viewerMode?: PreviewViewerMode
  }>(),
  {
    showControls: true,
    controlsVariant: 'full',
    viewerMode: 'fill',
  },
)

const controlsVisible = computed(() => props.showControls !== false)

const controlsVariant = computed<PreviewControlsVariant>(() =>
  props.controlsVariant === 'viewport' ? 'viewport' : 'full',
)

const viewerMode = computed<PreviewViewerMode>(() => (props.viewerMode === 'responsive' ? 'responsive' : 'fill'))

const MIN_VIEWPORT_SCALE = 25
const MAX_VIEWPORT_SCALE = 500

// Common desktop browser zoom levels (Ctrl+ / Ctrl-)
const BROWSER_ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const

function nextZoomIn(current: number): number {
  for (const level of BROWSER_ZOOM_LEVELS) {
    if (level > current) return level
  }
  return BROWSER_ZOOM_LEVELS[BROWSER_ZOOM_LEVELS.length - 1] || 100
}

function nextZoomOut(current: number): number {
  for (let i = BROWSER_ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    const level = BROWSER_ZOOM_LEVELS[i]
    if (level < current) return level
  }
  return BROWSER_ZOOM_LEVELS[0] || 100
}

const headerViewportScalePct = computed(() =>
  Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, Math.round(Number(preview.viewportScale) || 100))),
)

function zoomOut() {
  preview.setViewportScale(nextZoomOut(headerViewportScalePct.value))
}

function zoomIn() {
  preview.setViewportScale(nextZoomIn(headerViewportScalePct.value))
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
const zoomedViewportWidthPx = computed(() => {
  const zoom = viewportScale.value || 1
  return Math.max(1, Math.round(viewportWidthPx.value / zoom))
})
const zoomedViewportHeightPx = computed(() => {
  const zoom = viewportScale.value || 1
  return Math.max(1, Math.round(viewportHeightPx.value / zoom))
})

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
  axis: 'both' | 'x' | 'y'
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

const viewportResize = ref<ViewportResizeState | null>(null)
const resizingViewport = computed(() => viewerMode.value === 'responsive' && viewportResize.value !== null)

function startViewportResize(event: PointerEvent, axis: ViewportResizeState['axis']) {
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
    axis,
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

  const dx = event.clientX - state.startX
  const dy = event.clientY - state.startY

  const next: { width?: number; height?: number } = {}
  if (state.axis === 'both' || state.axis === 'x') {
    next.width = Math.round(state.startWidth + dx)
  }
  if (state.axis === 'both' || state.axis === 'y') {
    next.height = Math.round(state.startHeight + dy)
  }
  preview.setViewportSize(next)
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

const touchSimulationSupported = computed(
  () => viewerMode.value === 'responsive' && preview.viewport === 'mobile' && ui.isMobilePointer !== true,
)

const touchSimulationEnabled = computed(() => touchSimulationSupported.value && preview.touchSimulation === true)
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
  const maxX = Math.max(0, zoomedViewportWidthPx.value - 1)
  const maxY = Math.max(0, zoomedViewportHeightPx.value - 1)
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
    const HTMLElementCtor = (ctx.win as unknown as { HTMLElement?: unknown }).HTMLElement
    if (typeof HTMLElementCtor === 'function' && target instanceof (HTMLElementCtor as unknown as typeof HTMLElement)) {
      const el = target as unknown as HTMLElement
      if (typeof el.click === 'function') {
        el.click()
        return
      }
    }

    const MouseEventCtor = (ctx.win as unknown as { MouseEvent?: unknown }).MouseEvent
    const Ctor =
      typeof MouseEventCtor === 'function'
        ? (MouseEventCtor as new (type: string, init: MouseEventInit) => MouseEvent)
        : MouseEvent
    const ev = new Ctor('click', {
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
  const scale = viewportScale.value || 1
  try {
    ctx.win.scrollBy((event.deltaX || 0) / scale, (event.deltaY || 0) / scale)
  } catch {
    // ignore
  }
}

let zoomScrollRequestId = 0

async function keepIframeCenterOnZoom() {
  const ctx = resolveIframeContext()
  if (!ctx) return
  const win = ctx.win

  const anchorX = Number(win.scrollX) + Number(win.innerWidth) / 2
  const anchorY = Number(win.scrollY) + Number(win.innerHeight) / 2
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return

  const requestId = (zoomScrollRequestId += 1)
  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  if (requestId !== zoomScrollRequestId) return

  const ctx2 = resolveIframeContext()
  if (!ctx2) return
  const win2 = ctx2.win
  const w = Number(win2.innerWidth)
  const h = Number(win2.innerHeight)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return

  try {
    win2.scrollTo({ left: Math.max(0, anchorX - w / 2), top: Math.max(0, anchorY - h / 2), behavior: 'auto' })
  } catch {
    // ignore
  }
}

const frameSrc = shallowRef('')
const iframeLoading = ref(false)
const iframeError = ref('')
const createPreviewId = ref('')
const createRunDirectory = ref('')
const createCommand = ref('')
const createArgsText = ref('')
const createLogsPath = ref('')
const createTargetUrl = ref('')
const createDialogOpen = ref(false)
const actionLoading = ref<'create' | ''>('')
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

const runtimeAction = ref<'start' | 'stop' | ''>('')
const runtimeBusy = computed(() => Boolean(runtimeAction.value))
const activeSessionStateNorm = computed(() =>
  String(activeSession.value?.state || '')
    .trim()
    .toLowerCase(),
)
const activeSessionIsRunning = computed(() => activeSessionStateNorm.value === 'running')

const opencodeSessionId = computed(() => {
  const path = String(route.path || '')
    .trim()
    .toLowerCase()
  if (path.startsWith('/preview')) return ''
  return String(chat.selectedSessionId || '').trim()
})

const createPreviewIdNorm = computed(() => String(createPreviewId.value || '').trim())
const createPreviewIdValid = computed(() => /^[A-Za-z0-9_-]+$/.test(createPreviewIdNorm.value))

const createRunDirectoryNorm = computed(() => String(createRunDirectory.value || '').trim())
const createCommandNorm = computed(() => String(createCommand.value || '').trim())
const createArgsList = computed(() =>
  String(createArgsText.value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean),
)
const createLogsPathNorm = computed(() => String(createLogsPath.value || '').trim())

const canCreateSession = computed(() =>
  Boolean(
    currentDirectory.value.trim() &&
    createPreviewIdNorm.value &&
    createPreviewIdValid.value &&
    createRunDirectoryNorm.value &&
    createCommandNorm.value &&
    createArgsList.value.length > 0 &&
    createLogsPathNorm.value &&
    createTargetUrl.value.trim() &&
    !actionLoading.value,
  ),
)
const actionLoadingMessage = computed(() => {
  if (actionLoading.value === 'create') return String(t('workspaceDock.preview.emptyState.createLoading'))
  return ''
})

const effectiveError = computed(() => {
  if (preview.error) {
    const detail = preview.error.trim() || String(t('workspaceDock.preview.states.sessionsFetchFailedNoDetail'))
    return String(t('workspaceDock.preview.states.sessionsFetchFailed', { detail }))
  }
  if (String(preview.activeSessionId || '').trim() && !activeSession.value) {
    return String(t('workspaceDock.preview.states.activeSessionMissing'))
  }
  if (activeSession.value && !activeProxyBasePath.value) {
    return String(t('workspaceDock.preview.states.missingProxyBasePath'))
  }
  if (iframeError.value) return iframeError.value
  return ''
})

const showEmptyState = computed(() => {
  if (preview.loading || effectiveError.value) return false
  if (preview.sessions.length === 0) return true
  return !activeSession.value
})

const emptyStateTitle = computed(() => {
  if (preview.sessions.length > 0 && !activeSession.value) return String(t('workspaceDock.preview.urlEmpty'))
  return String(t('workspaceDock.preview.states.emptyTitle'))
})

const emptyStateDescription = computed(() => String(t('workspaceDock.preview.states.emptyDescription')))

const sessionPickerLabel = computed(() => String(t('workspaceDock.preview.sessionsTitle')))

const activeSessionLabel = computed(() => {
  const active = preview.sessions.find((session) => session.id === preview.activeSessionId)
  if (active) return sessionLabel(active)
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
  return String(session.id || '').trim()
}

function suggestPreviewIdFromDirectory(directory: string): string {
  const trimmed = String(directory || '')
    .trim()
    .replace(/[\\/]+$/, '')
  if (!trimmed) return ''
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const base = String(parts[parts.length - 1] || '').trim()
  if (!base) return ''
  const normalized = base
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return normalized
}

function suggestLogsPath(sessionId: string): string {
  const clean = String(sessionId || '').trim() || 'preview'
  return `.opencode/preview/${clean}.log`
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
  await preview.refreshSessions()
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
  if (!currentDirectory.value.trim()) {
    actionError.value = String(t('workspaceDock.preview.emptyState.directoryRequired'))
    return
  }

  if (!createPreviewIdNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.sessionIdRequired'))
    return
  }
  if (!createPreviewIdValid.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.sessionIdInvalid'))
    return
  }

  if (!createRunDirectoryNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.runDirectoryRequired'))
    return
  }

  if (!createCommandNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.commandRequired'))
    return
  }

  if (createArgsList.value.length === 0) {
    actionError.value = String(t('workspaceDock.preview.emptyState.argsRequired'))
    return
  }

  if (!createLogsPathNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.logsPathRequired'))
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
    await preview.createSession({
      id: createPreviewIdNorm.value,
      directory: currentDirectory.value,
      runDirectory: createRunDirectoryNorm.value,
      command: createCommandNorm.value,
      args: createArgsList.value,
      logsPath: createLogsPathNorm.value,
      targetUrl,
      ...(opencodeSessionId.value ? { opencodeSessionId: opencodeSessionId.value } : {}),
      select: true,
    })
    createPreviewId.value = ''
    createRunDirectory.value = ''
    createCommand.value = ''
    createArgsText.value = ''
    createLogsPath.value = ''
    createTargetUrl.value = ''
    createDialogOpen.value = false
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    actionError.value = String(t('workspaceDock.preview.emptyState.createFailed', { detail }))
  } finally {
    actionLoading.value = ''
  }
}

function openCreateDialog() {
  actionError.value = ''
  const suggestedId = createPreviewIdNorm.value || suggestPreviewIdFromDirectory(currentDirectory.value)
  if (!createPreviewIdNorm.value) {
    createPreviewId.value = suggestedId
  }
  if (!createRunDirectoryNorm.value) {
    createRunDirectory.value = currentDirectory.value
  }
  if (!createLogsPathNorm.value) {
    createLogsPath.value = suggestLogsPath(suggestedId)
  }
  createDialogOpen.value = true
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

function toggleTouchSimulation() {
  preview.setTouchSimulation(!preview.touchSimulation)
}

async function startActiveSession() {
  const sid = String(activeSession.value?.id || '').trim()
  if (!sid) return
  runtimeAction.value = 'start'
  iframeError.value = ''
  try {
    await preview.startSession(sid)
  } catch (err) {
    iframeError.value = err instanceof Error ? err.message : String(err)
  } finally {
    runtimeAction.value = ''
  }
}

async function stopActiveSession() {
  const sid = String(activeSession.value?.id || '').trim()
  if (!sid) return
  runtimeAction.value = 'stop'
  iframeError.value = ''
  try {
    await preview.stopSession(sid)
  } catch (err) {
    iframeError.value = err instanceof Error ? err.message : String(err)
  } finally {
    runtimeAction.value = ''
  }
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

watch(
  viewportScalePct,
  (next, prev) => {
    if (next === prev) return
    void keepIframeCenterOnZoom()
  },
  { flush: 'pre' },
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
      <div v-if="controlsVariant === 'full'" class="relative flex items-center gap-1.5">
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
            :tooltip="String(t('workspaceDock.preview.emptyState.addAction'))"
            :aria-label="String(t('workspaceDock.preview.emptyState.addAction'))"
            :disabled="Boolean(actionLoading)"
            @click="openCreateDialog"
          >
            <RiAddLine class="h-4 w-4" />
          </IconButton>

          <IconButton
            v-if="viewerMode !== 'responsive'"
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
            :tooltip="
              String(
                t(
                  activeSessionIsRunning
                    ? 'workspaceDock.preview.sidebar.actions.stop'
                    : 'workspaceDock.preview.sidebar.actions.start',
                ),
              )
            "
            :aria-label="
              String(
                t(
                  activeSessionIsRunning
                    ? 'workspaceDock.preview.sidebar.actions.stop'
                    : 'workspaceDock.preview.sidebar.actions.start',
                ),
              )
            "
            :disabled="runtimeBusy || !activeSession"
            @click="activeSessionIsRunning ? stopActiveSession() : startActiveSession()"
          >
            <RiLoader4Line v-if="runtimeBusy" class="h-4 w-4 animate-spin" />
            <RiStopLine v-else-if="activeSessionIsRunning" class="h-4 w-4" />
            <RiPlayLine v-else class="h-4 w-4" />
          </IconButton>
          <IconButton
            v-if="viewerMode !== 'responsive'"
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

      <div
        v-if="viewerMode === 'responsive'"
        class="flex flex-wrap items-center justify-between gap-1.5"
        :class="controlsVariant === 'full' ? 'mt-1' : ''"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <input
            v-model="widthDraft"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            class="h-6 w-[56px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            class="h-6 w-[56px] rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 text-[11px] font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            v-if="touchSimulationSupported"
            size="xs"
            class="transition-colors"
            :class="touchSimulationEnabled ? 'bg-sidebar-accent/70 text-foreground shadow-inner' : ''"
            :aria-pressed="touchSimulationEnabled"
            :tooltip="
              touchSimulationEnabled
                ? String(t('workspaceDock.preview.touchSimulationOn'))
                : String(t('workspaceDock.preview.touchSimulationOff'))
            "
            :aria-label="
              touchSimulationEnabled
                ? String(t('workspaceDock.preview.touchSimulationOn'))
                : String(t('workspaceDock.preview.touchSimulationOff'))
            "
            @click="toggleTouchSimulation"
          >
            <RiHand class="h-4 w-4" />
          </IconButton>

          <IconButton
            size="xs"
            :tooltip="String(t('workspaceDock.preview.openInWindow'))"
            :aria-label="String(t('workspaceDock.preview.openInWindow'))"
            :disabled="!canOpenInWindow"
            @click="openInNewWindow"
          >
            <RiExternalLinkLine class="h-4 w-4" />
          </IconButton>

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

    <FormDialog
      :open="createDialogOpen"
      :title="String(t('workspaceDock.preview.addDialog.title'))"
      :description="String(t('workspaceDock.preview.addDialog.description'))"
      max-width="max-w-md"
      @close="createDialogOpen = false"
      @update:open="createDialogOpen = $event"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-id-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.sessionIdLabel') }}
          </label>
          <Input
            id="workspace-preview-id-dialog"
            v-model="createPreviewId"
            type="text"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
            :disabled="Boolean(actionLoading)"
            class="h-8 bg-background/80 text-xs font-mono"
            @keydown.enter.prevent="createManagedSession"
          />
          <p class="text-[11px] text-muted-foreground">
            {{ t('workspaceDock.preview.emptyState.sessionIdHelp') }}
          </p>
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-run-dir-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.runDirectoryLabel') }}
          </label>
          <Input
            id="workspace-preview-run-dir-dialog"
            v-model="createRunDirectory"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.runDirectoryPlaceholder'))"
            :disabled="Boolean(actionLoading)"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-command-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.commandLabel') }}
          </label>
          <Input
            id="workspace-preview-command-dialog"
            v-model="createCommand"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.commandPlaceholder'))"
            :disabled="Boolean(actionLoading)"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-args-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.argsLabel') }}
          </label>
          <Input
            id="workspace-preview-args-dialog"
            v-model="createArgsText"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.argsPlaceholder'))"
            :disabled="Boolean(actionLoading)"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-logs-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.logsPathLabel') }}
          </label>
          <Input
            id="workspace-preview-logs-dialog"
            v-model="createLogsPath"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.logsPathPlaceholder'))"
            :disabled="Boolean(actionLoading)"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-target-url-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.targetUrlLabel') }}
          </label>
          <Input
            id="workspace-preview-target-url-dialog"
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
          <span class="font-mono">{{ currentDirectory || t('workspaceDock.preview.emptyState.directoryEmpty') }}</span>
        </p>

        <p v-if="actionError" class="text-xs text-destructive">{{ actionError }}</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" :disabled="Boolean(actionLoading)" @click="createDialogOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="!canCreateSession" @click="createManagedSession">
            {{ t('workspaceDock.preview.emptyState.addAction') }}
          </Button>
        </div>

        <p v-if="actionLoadingMessage" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
          {{ actionLoadingMessage }}
        </p>
      </div>
    </FormDialog>

    <div class="relative min-h-0 flex-1 overflow-hidden rounded-md border border-sidebar-border/65 bg-background/80">
      <div v-if="showEmptyState" class="flex h-full items-center justify-center p-4 text-center">
        <div
          class="max-w-[24rem] rounded-md border border-dashed border-sidebar-border/70 bg-sidebar-accent/10 p-4 text-left"
        >
          <p class="text-sm font-medium">{{ emptyStateTitle }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ emptyStateDescription }}</p>
          <p class="mt-3 truncate text-[11px] text-muted-foreground">
            {{ t('workspaceDock.preview.directoryLabel') }}
            <span class="font-mono">{{
              currentDirectory || t('workspaceDock.preview.emptyState.directoryEmpty')
            }}</span>
          </p>
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
            <div class="relative" :style="{ width: `${viewportWidthPx}px`, height: `${viewportHeightPx}px` }">
              <div
                class="relative h-full w-full overflow-hidden rounded-md border border-sidebar-border/60 bg-background shadow-sm"
              >
                <div
                  class="origin-top-left"
                  :style="{
                    width: `${zoomedViewportWidthPx}px`,
                    height: `${zoomedViewportHeightPx}px`,
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
                  {{ zoomedViewportWidthPx }} x {{ zoomedViewportHeightPx }} · {{ viewportScalePct }}%
                </div>
              </div>

              <!-- Firefox-like resize handles (external) -->
              <button
                type="button"
                class="group absolute -right-4 top-0 bottom-0 z-30 w-4 touch-none cursor-ew-resize"
                :title="String(t('workspaceDock.preview.resizeViewport'))"
                :aria-label="String(t('workspaceDock.preview.resizeViewport'))"
                @pointerdown.prevent.stop="startViewportResize($event, 'x')"
                @pointermove="moveViewportResize"
                @pointerup="stopViewportResize"
                @pointercancel="stopViewportResize"
              >
                <span
                  class="absolute left-1/2 top-6 bottom-6 w-px -translate-x-1/2 rounded bg-sidebar-border/60 transition-colors group-hover:bg-sidebar-border"
                />
              </button>

              <button
                type="button"
                class="group absolute left-0 right-0 -bottom-4 z-30 h-4 touch-none cursor-ns-resize"
                :title="String(t('workspaceDock.preview.resizeViewport'))"
                :aria-label="String(t('workspaceDock.preview.resizeViewport'))"
                @pointerdown.prevent.stop="startViewportResize($event, 'y')"
                @pointermove="moveViewportResize"
                @pointerup="stopViewportResize"
                @pointercancel="stopViewportResize"
              >
                <span
                  class="absolute top-1/2 left-6 right-6 h-px -translate-y-1/2 rounded bg-sidebar-border/60 transition-colors group-hover:bg-sidebar-border"
                />
              </button>

              <button
                type="button"
                class="group absolute -right-5 -bottom-5 z-40 h-5 w-5 touch-none cursor-nwse-resize"
                :title="String(t('workspaceDock.preview.resizeViewport'))"
                :aria-label="String(t('workspaceDock.preview.resizeViewport'))"
                @pointerdown.prevent.stop="startViewportResize($event, 'both')"
                @pointermove="moveViewportResize"
                @pointerup="stopViewportResize"
                @pointercancel="stopViewportResize"
              >
                <span
                  class="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-sidebar-border/70 transition-colors group-hover:border-sidebar-border"
                />
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
