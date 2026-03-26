<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'radix-vue'
import { RiAddLine, RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiSubtractLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

const items = computed(() => ui.imageViewerItems)
const activeItem = computed(() => ui.imageViewerActiveItem)
const activeIndex = computed(() => ui.imageViewerActiveIndex)
const total = computed(() => items.value.length)
const canNavigate = computed(() => total.value > 1)
const isTouchDevice = computed(() => ui.isTouchPointer || ui.isMobilePointer || ui.isMobileDevice)
const canZoomIn = computed(() => ui.imageViewerZoom < 5)
const canZoomOut = computed(() => ui.imageViewerZoom > 0.2)
const zoomPercent = computed(() => Math.round(ui.imageViewerZoom * 100))

const viewportEl = ref<HTMLElement | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStartClientX = ref(0)
const dragStartClientY = ref(0)
const dragOriginX = ref(0)
const dragOriginY = ref(0)
const touchMode = ref<'none' | 'pan' | 'swipe' | 'pinch'>('none')
const touchStartX = ref(0)
const touchStartY = ref(0)
const touchStartAt = ref(0)
const pinchStartDistance = ref(0)
const pinchStartZoom = ref(1)

const activeImageStyle = computed(() => ({
  transform: `translate3d(${panX.value}px, ${panY.value}px, 0) scale(${ui.imageViewerZoom})`,
  transformOrigin: 'center center',
  transition: isDragging.value || touchMode.value !== 'none' ? 'none' : 'transform 150ms ease-out',
  cursor: isTouchDevice.value
    ? 'auto'
    : ui.imageViewerZoom > 1.01
      ? isDragging.value
        ? 'grabbing'
        : 'grab'
      : 'zoom-in',
}))

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function close() {
  endMouseDrag()
  ui.closeImageViewer()
}

function prev() {
  ui.prevImageViewerItem()
}

function next() {
  ui.nextImageViewerItem()
}

function computePanBounds() {
  const viewport = viewportEl.value
  const image = imageEl.value
  if (!viewport || !image) return { maxX: 0, maxY: 0 }

  const zoom = Math.max(0.2, Math.min(5, Number(ui.imageViewerZoom) || 1))
  const imageRect = image.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  if (!imageRect.width || !imageRect.height || !viewportRect.width || !viewportRect.height) {
    return { maxX: 0, maxY: 0 }
  }

  const baseWidth = imageRect.width / zoom
  const baseHeight = imageRect.height / zoom
  const scaledWidth = baseWidth * zoom
  const scaledHeight = baseHeight * zoom
  const maxX = Math.max(0, (scaledWidth - viewportRect.width) / 2)
  const maxY = Math.max(0, (scaledHeight - viewportRect.height) / 2)
  return { maxX, maxY }
}

function clampPanPosition() {
  const { maxX, maxY } = computePanBounds()
  panX.value = clamp(panX.value, -maxX, maxX)
  panY.value = clamp(panY.value, -maxY, maxY)
}

function resetPanPosition() {
  panX.value = 0
  panY.value = 0
}

function applyZoom(nextZoomRaw: number, pointerX = 0, pointerY = 0) {
  const prevZoom = Math.max(0.2, Math.min(5, Number(ui.imageViewerZoom) || 1))
  const nextZoom = clamp(nextZoomRaw, 0.2, 5)
  if (Math.abs(nextZoom - prevZoom) < 0.0001) return

  const ratio = nextZoom / prevZoom
  panX.value = panX.value * ratio + pointerX * (1 - ratio)
  panY.value = panY.value * ratio + pointerY * (1 - ratio)

  ui.setImageViewerZoom(nextZoom)
  clampPanPosition()
}

function zoomByStep(step: number, pointerX = 0, pointerY = 0) {
  const current = Math.max(0.2, Math.min(5, Number(ui.imageViewerZoom) || 1))
  applyZoom(current + step, pointerX, pointerY)
}

function zoomInFromToolbar() {
  zoomByStep(0.2)
}

function zoomOutFromToolbar() {
  zoomByStep(-0.2)
}

function resetZoomFromToolbar() {
  ui.resetImageViewerZoom()
  resetPanPosition()
}

function viewportPointerOffset(clientX: number, clientY: number): { x: number; y: number } {
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - (rect.top + rect.height / 2),
  }
}

function onWheel(event: WheelEvent) {
  if (!ui.isImageViewerOpen || isTouchDevice.value) return
  event.preventDefault()
  const { x, y } = viewportPointerOffset(event.clientX, event.clientY)
  const step = event.deltaY < 0 ? 0.18 : -0.18
  zoomByStep(step, x, y)
}

function onMouseMove(event: MouseEvent) {
  if (!isDragging.value) return
  const dx = event.clientX - dragStartClientX.value
  const dy = event.clientY - dragStartClientY.value
  panX.value = dragOriginX.value + dx
  panY.value = dragOriginY.value + dy
  clampPanPosition()
}

function endMouseDrag() {
  isDragging.value = false
  window.removeEventListener('mousemove', onMouseMove, true)
  window.removeEventListener('mouseup', endMouseDrag, true)
}

function startMouseDrag(event: MouseEvent) {
  if (isTouchDevice.value) return
  if (event.button !== 0) return
  if ((Number(ui.imageViewerZoom) || 1) <= 1.01) return

  event.preventDefault()
  isDragging.value = true
  dragStartClientX.value = event.clientX
  dragStartClientY.value = event.clientY
  dragOriginX.value = panX.value
  dragOriginY.value = panY.value
  window.addEventListener('mousemove', onMouseMove, true)
  window.addEventListener('mouseup', endMouseDrag, true)
}

function onImageDoubleClick(event: MouseEvent) {
  if (isTouchDevice.value) return
  const zoom = Number(ui.imageViewerZoom) || 1
  if (zoom > 1.01) {
    resetZoomFromToolbar()
    return
  }
  const { x, y } = viewportPointerOffset(event.clientX, event.clientY)
  applyZoom(2, x, y)
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

function onTouchStart(event: TouchEvent) {
  if (!isTouchDevice.value || !ui.isImageViewerOpen) return

  if (event.touches.length >= 2) {
    touchMode.value = 'pinch'
    pinchStartDistance.value = touchDistance(event.touches[0], event.touches[1])
    pinchStartZoom.value = Number(ui.imageViewerZoom) || 1
    return
  }

  if (event.touches.length !== 1) return
  const touch = event.touches[0]
  touchStartX.value = touch.clientX
  touchStartY.value = touch.clientY
  touchStartAt.value = Date.now()

  if ((Number(ui.imageViewerZoom) || 1) > 1.01) {
    touchMode.value = 'pan'
    dragOriginX.value = panX.value
    dragOriginY.value = panY.value
    return
  }

  touchMode.value = 'swipe'
}

function onTouchMove(event: TouchEvent) {
  if (!isTouchDevice.value || !ui.isImageViewerOpen) return

  if (touchMode.value === 'pinch' && event.touches.length >= 2) {
    const distance = touchDistance(event.touches[0], event.touches[1])
    if (pinchStartDistance.value > 0) {
      const scale = distance / pinchStartDistance.value
      ui.setImageViewerZoom(pinchStartZoom.value * scale)
      clampPanPosition()
    }
    event.preventDefault()
    return
  }

  if (touchMode.value === 'pan' && event.touches.length === 1) {
    const touch = event.touches[0]
    const dx = touch.clientX - touchStartX.value
    const dy = touch.clientY - touchStartY.value
    panX.value = dragOriginX.value + dx
    panY.value = dragOriginY.value + dy
    clampPanPosition()
    event.preventDefault()
    return
  }

  if (touchMode.value === 'swipe' && event.touches.length === 1) {
    const touch = event.touches[0]
    const dx = touch.clientX - touchStartX.value
    const dy = touch.clientY - touchStartY.value
    if (Math.abs(dx) > Math.abs(dy)) {
      event.preventDefault()
    }
  }
}

function onTouchEnd(event: TouchEvent) {
  if (!isTouchDevice.value || !ui.isImageViewerOpen) return

  if (touchMode.value === 'pinch') {
    if (event.touches.length >= 2) return
    if (event.touches.length === 1 && (Number(ui.imageViewerZoom) || 1) > 1.01) {
      const touch = event.touches[0]
      touchMode.value = 'pan'
      touchStartX.value = touch.clientX
      touchStartY.value = touch.clientY
      dragOriginX.value = panX.value
      dragOriginY.value = panY.value
      return
    }
    touchMode.value = 'none'
    clampPanPosition()
    return
  }

  if (touchMode.value === 'pan') {
    if (!event.touches.length) {
      touchMode.value = 'none'
      clampPanPosition()
    }
    return
  }

  if (touchMode.value === 'swipe') {
    touchMode.value = 'none'
    if (!canNavigate.value) return
    const changed = event.changedTouches[0]
    if (!changed) return

    const dx = changed.clientX - touchStartX.value
    const dy = changed.clientY - touchStartY.value
    const elapsed = Date.now() - touchStartAt.value
    if (elapsed > 750) return
    if (Math.abs(dx) < 56) return
    if (Math.abs(dy) > 72) return
    if (dx < 0) next()
    else prev()
  }
}

function onImageLoaded() {
  void nextTick(() => clampPanPosition())
}

function onKeydown(event: KeyboardEvent) {
  if (!ui.isImageViewerOpen) return

  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prev()
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomInFromToolbar()
    return
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoomOutFromToolbar()
    return
  }
  if (event.key === '0') {
    event.preventDefault()
    resetZoomFromToolbar()
  }
}

watch(
  () => ui.isImageViewerOpen,
  (open) => {
    if (open) {
      resetPanPosition()
      window.addEventListener('keydown', onKeydown, true)
      void nextTick(() => clampPanPosition())
      return
    }
    endMouseDrag()
    touchMode.value = 'none'
    resetPanPosition()
    window.removeEventListener('keydown', onKeydown, true)
  },
)

watch(
  () => ui.imageViewerActiveIndex,
  () => {
    resetPanPosition()
    void nextTick(() => clampPanPosition())
  },
)

watch(
  () => ui.imageViewerZoom,
  (zoom) => {
    if ((Number(zoom) || 1) <= 1.01) {
      resetPanPosition()
      return
    }
    void nextTick(() => clampPanPosition())
  },
)

onBeforeUnmount(() => {
  endMouseDrag()
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <DialogRoot :open="ui.isImageViewerOpen" @update:open="(open) => !open && close()">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed inset-0 z-[81] flex min-h-0 flex-col bg-black/20 text-white outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      >
        <DialogTitle class="sr-only">Image viewer</DialogTitle>
        <div class="flex items-center gap-2 border-b border-white/15 bg-black/40 px-3 py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ activeItem?.title || activeItem?.alt || '' }}</div>
            <div class="text-xs text-white/70">{{ total ? `${activeIndex + 1} / ${total}` : '' }}</div>
          </div>

          <div class="inline-flex items-center gap-1">
            <IconButton
              v-if="!isTouchDevice"
              size="xs"
              :tooltip="String(t('common.previous'))"
              :aria-label="String(t('common.previous'))"
              :disabled="!canNavigate"
              @click="prev"
            >
              <RiArrowLeftSLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              v-if="!isTouchDevice"
              size="xs"
              :tooltip="String(t('common.next'))"
              :aria-label="String(t('common.next'))"
              :disabled="!canNavigate"
              @click="next"
            >
              <RiArrowRightSLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="xs"
              :tooltip="String(t('workspaceDock.preview.zoomOut'))"
              :aria-label="String(t('workspaceDock.preview.zoomOut'))"
              :disabled="!canZoomOut"
              @click="zoomOutFromToolbar"
            >
              <RiSubtractLine class="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              class="h-6 rounded-sm border border-white/20 bg-white/10 px-1.5 text-[11px] font-mono text-white/80 transition-colors hover:bg-white/20"
              :title="String(t('workspaceDock.preview.zoomReset'))"
              :aria-label="String(t('workspaceDock.preview.zoomReset'))"
              @click="resetZoomFromToolbar"
            >
              {{ zoomPercent }}%
            </button>
            <IconButton
              size="xs"
              :tooltip="String(t('workspaceDock.preview.zoomIn'))"
              :aria-label="String(t('workspaceDock.preview.zoomIn'))"
              :disabled="!canZoomIn"
              @click="zoomInFromToolbar"
            >
              <RiAddLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="xs"
              :tooltip="String(t('common.close'))"
              :aria-label="String(t('common.close'))"
              @click="close"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div class="relative min-h-0 flex-1">
          <button
            v-if="canNavigate"
            type="button"
            class="absolute inset-y-0 left-0 z-10 my-auto ml-2 h-11 w-11 rounded-full border border-white/20 bg-black/45 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            :title="String(t('common.previous'))"
            :aria-label="String(t('common.previous'))"
            @click="prev"
          >
            <RiArrowLeftSLine class="mx-auto h-6 w-6" />
          </button>

          <button
            v-if="canNavigate"
            type="button"
            class="absolute inset-y-0 right-0 z-10 my-auto mr-2 h-11 w-11 rounded-full border border-white/20 bg-black/45 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            :title="String(t('common.next'))"
            :aria-label="String(t('common.next'))"
            @click="next"
          >
            <RiArrowRightSLine class="mx-auto h-6 w-6" />
          </button>

          <div
            ref="viewportEl"
            class="h-full overflow-hidden"
            :class="isTouchDevice ? 'touch-none' : ''"
            @wheel="onWheel"
            @mousedown="startMouseDrag"
            @touchstart="onTouchStart"
            @touchmove="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchEnd"
          >
            <div class="flex min-h-full w-full items-center justify-center p-4 sm:p-6">
              <img
                v-if="activeItem"
                ref="imageEl"
                :key="activeItem.key || activeItem.src"
                :src="activeItem.src"
                :alt="activeItem.alt || activeItem.title || ''"
                class="max-h-[calc(100dvh-7.5rem)] max-w-full select-none object-contain"
                :style="activeImageStyle"
                draggable="false"
                @load="onImageLoaded"
                @dblclick="onImageDoubleClick"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
