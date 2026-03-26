<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
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
const canZoomIn = computed(() => ui.imageViewerZoom < 5)
const canZoomOut = computed(() => ui.imageViewerZoom > 0.2)
const zoomPercent = computed(() => Math.round(ui.imageViewerZoom * 100))
const activeImageStyle = computed(() => ({
  transform: `scale(${ui.imageViewerZoom})`,
  transformOrigin: 'center center',
}))

function close() {
  ui.closeImageViewer()
}

function prev() {
  ui.prevImageViewerItem()
}

function next() {
  ui.nextImageViewerItem()
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
    ui.zoomImageViewerIn()
    return
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    ui.zoomImageViewerOut()
    return
  }
  if (event.key === '0') {
    event.preventDefault()
    ui.resetImageViewerZoom()
  }
}

watch(
  () => ui.isImageViewerOpen,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown, { capture: true })
      return
    }
    window.removeEventListener('keydown', onKeydown, { capture: true })
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, { capture: true })
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
              size="xs"
              :tooltip="String(t('common.previous'))"
              :aria-label="String(t('common.previous'))"
              :disabled="!canNavigate"
              @click="prev"
            >
              <RiArrowLeftSLine class="h-4 w-4" />
            </IconButton>
            <IconButton
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
              @click="ui.zoomImageViewerOut()"
            >
              <RiSubtractLine class="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              class="h-6 rounded-sm border border-white/20 bg-white/10 px-1.5 text-[11px] font-mono text-white/80 transition-colors hover:bg-white/20"
              :title="String(t('workspaceDock.preview.zoomReset'))"
              :aria-label="String(t('workspaceDock.preview.zoomReset'))"
              @click="ui.resetImageViewerZoom()"
            >
              {{ zoomPercent }}%
            </button>
            <IconButton
              size="xs"
              :tooltip="String(t('workspaceDock.preview.zoomIn'))"
              :aria-label="String(t('workspaceDock.preview.zoomIn'))"
              :disabled="!canZoomIn"
              @click="ui.zoomImageViewerIn()"
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
            class="absolute inset-y-0 left-0 z-10 my-auto ml-2 h-10 w-10 rounded-full border border-white/20 bg-black/45 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            :title="String(t('common.previous'))"
            :aria-label="String(t('common.previous'))"
            @click="prev"
          >
            <RiArrowLeftSLine class="mx-auto h-6 w-6" />
          </button>

          <button
            v-if="canNavigate"
            type="button"
            class="absolute inset-y-0 right-0 z-10 my-auto mr-2 h-10 w-10 rounded-full border border-white/20 bg-black/45 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            :title="String(t('common.next'))"
            :aria-label="String(t('common.next'))"
            @click="next"
          >
            <RiArrowRightSLine class="mx-auto h-6 w-6" />
          </button>

          <div class="h-full overflow-auto">
            <div class="flex min-h-full w-full items-center justify-center p-4 sm:p-6">
              <img
                v-if="activeItem"
                :key="activeItem.key || activeItem.src"
                :src="activeItem.src"
                :alt="activeItem.alt || activeItem.title || ''"
                class="max-h-[calc(100dvh-7.5rem)] max-w-full select-none object-contain transition-transform duration-150 ease-out"
                :style="activeImageStyle"
                draggable="false"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
