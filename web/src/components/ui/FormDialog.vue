<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties, type ComponentPublicInstance } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'radix-vue'
import { RiCloseLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import IconButton from '@/components/ui/IconButton.vue'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    maxWidth?: string
    mobileTitle?: string
  }>(),
  {
    mobileTitle: '',
  },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:open', value: boolean): void
}>()

const ui = useUiStore()
const isMobileSheet = computed(() => Boolean(ui.isMobilePointer))

const { t } = useI18n()

const MOBILE_SHEET_MARGIN_PX = 8
const MOBILE_SHEET_MIN_MAX_HEIGHT_PX = 180

const panelEl = ref<HTMLElement | ComponentPublicInstance | null>(null)

const mobileSheetStyle = ref<CSSProperties>({
  top: `${MOBILE_SHEET_MARGIN_PX}px`,
  height: 'auto',
  maxHeight: `calc(100dvh - ${MOBILE_SHEET_MARGIN_PX * 2}px)`,
})

const desktopContentClass = computed(() =>
  cn(
    'fixed left-[50%] top-[50%] z-[71] pointer-events-auto flex w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur duration-200 max-h-[calc(100dvh-1rem)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
    props.maxWidth || 'max-w-lg',
  ),
)

const mobileContentClass = computed(() =>
  cn(
    'fixed left-2 right-2 z-[71] pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    props.maxWidth || 'max-w-none',
  ),
)

const contentClass = computed(() => (isMobileSheet.value ? mobileContentClass.value : desktopContentClass.value))
const contentStyle = computed<CSSProperties | undefined>(() =>
  isMobileSheet.value ? mobileSheetStyle.value : undefined,
)
const sheetTitle = computed(() => (isMobileSheet.value && props.mobileTitle ? props.mobileTitle : props.title || ''))

let mobileViewportEventsBound = false

function close() {
  emit('close')
  emit('update:open', false)
}

function onUpdateOpen(next: boolean) {
  if (!next) emit('close')
  emit('update:open', next)
}

function cssVarPx(name: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const parsed = Number.parseFloat(String(raw || '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveViewportHeight(): number {
  if (typeof window === 'undefined') return 0
  const vvHeight = window.visualViewport?.height
  if (typeof vvHeight === 'number' && Number.isFinite(vvHeight) && vvHeight > 0) {
    return vvHeight
  }
  return window.innerHeight
}

function resolvePanelElement(): HTMLElement | null {
  const panel = panelEl.value
  if (!panel) return null
  if (panel instanceof HTMLElement) return panel
  const root = panel.$el
  return root instanceof HTMLElement ? root : null
}

async function syncMobileSheetPosition() {
  if (!props.open || !isMobileSheet.value) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  await nextTick()

  const viewportHeight = resolveViewportHeight()
  if (!viewportHeight) return

  const safeTop = cssVarPx('--oc-safe-area-top', 0)
  const safeBottom = cssVarPx('--oc-safe-area-bottom', 0)
  const bottomNav = cssVarPx('--oc-bottom-nav-height', 56)

  const topInset = safeTop + MOBILE_SHEET_MARGIN_PX
  const bottomInset = safeBottom + bottomNav + MOBILE_SHEET_MARGIN_PX
  const maxHeight = Math.max(MOBILE_SHEET_MIN_MAX_HEIGHT_PX, viewportHeight - topInset - bottomInset)

  // Measure with auto height first so compact forms don't inherit stale large heights.
  mobileSheetStyle.value = {
    top: `${topInset}px`,
    height: 'auto',
    maxHeight: `${Math.round(maxHeight)}px`,
  }

  await nextTick()

  const panel = resolvePanelElement()
  const naturalHeight = panel && panel.scrollHeight > 0 ? panel.scrollHeight : maxHeight
  const clampedHeight = Math.min(maxHeight, naturalHeight)

  const centeredOffset = Math.max(0, Math.round((maxHeight - clampedHeight) / 2))
  const top = topInset + centeredOffset

  mobileSheetStyle.value = {
    top: `${top}px`,
    height: naturalHeight > maxHeight ? `${Math.round(maxHeight)}px` : 'auto',
    maxHeight: `${Math.round(maxHeight)}px`,
  }
}

function onMobileViewportChange() {
  void syncMobileSheetPosition()
}

function bindMobileViewportEvents() {
  if (mobileViewportEventsBound || typeof window === 'undefined') return
  window.addEventListener('resize', onMobileViewportChange)
  window.addEventListener('orientationchange', onMobileViewportChange)
  window.visualViewport?.addEventListener('resize', onMobileViewportChange)
  window.visualViewport?.addEventListener('scroll', onMobileViewportChange)
  mobileViewportEventsBound = true
}

function unbindMobileViewportEvents() {
  if (!mobileViewportEventsBound || typeof window === 'undefined') return
  window.removeEventListener('resize', onMobileViewportChange)
  window.removeEventListener('orientationchange', onMobileViewportChange)
  window.visualViewport?.removeEventListener('resize', onMobileViewportChange)
  window.visualViewport?.removeEventListener('scroll', onMobileViewportChange)
  mobileViewportEventsBound = false
}

watch(
  () => props.open,
  (open) => {
    if (open && isMobileSheet.value) {
      bindMobileViewportEvents()
      void syncMobileSheetPosition()
      return
    }

    unbindMobileViewportEvents()
  },
  { immediate: true },
)

watch(
  () => isMobileSheet.value,
  (mobile) => {
    if (!props.open) return
    if (mobile) {
      bindMobileViewportEvents()
      void syncMobileSheetPosition()
      return
    }

    unbindMobileViewportEvents()
  },
)

onBeforeUnmount(() => {
  unbindMobileViewportEvents()
})
</script>

<template>
  <DialogRoot :open="open" @update:open="onUpdateOpen">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[70] pointer-events-auto bg-black/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent ref="panelEl" :class="contentClass" :style="contentStyle">
        <div class="flex items-start justify-between gap-3 border-b border-border/40 px-4 py-3 sm:px-5 sm:py-3">
          <div class="min-w-0">
            <DialogTitle v-if="sheetTitle" class="text-sm font-semibold text-foreground sm:text-base break-words">
              {{ sheetTitle }}
            </DialogTitle>
            <DialogDescription v-if="description" class="mt-1 text-xs text-muted-foreground break-words sm:text-sm">
              {{ description }}
            </DialogDescription>
          </div>
          <IconButton
            size="sm"
            :tooltip="t('common.close')"
            :is-mobile-pointer="ui.isMobilePointer"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <RiCloseLine class="h-4 w-4" />
          </IconButton>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
