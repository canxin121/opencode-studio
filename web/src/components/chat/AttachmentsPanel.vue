<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { RiAttachmentLine, RiCloseLine, RiFileLine, RiFileUploadLine, RiLoader4Line } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

type AttachedFile = {
  id: string
  filename: string
  size: number
  mime: string
  url?: string
  serverPath?: string
}

type DesktopAnchorLike =
  | HTMLElement
  | {
      triggerEl?: unknown
      $el?: unknown
      getBoundingClientRect?: () => DOMRect | undefined
    }
  | null

const props = withDefaults(
  defineProps<{
    open: boolean
    attachedFiles: AttachedFile[]
    formatBytes: (bytes: number) => string
    busy?: boolean
    isMobilePointer?: boolean
    desktopAnchorEl?: DesktopAnchorLike
    desktopPlacement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
    desktopGapPx?: number
    desktopViewportMarginPx?: number
    title?: string
  }>(),
  {
    busy: false,
    isMobilePointer: false,
    desktopAnchorEl: null,
    desktopPlacement: 'top-start',
    desktopGapPx: 8,
    desktopViewportMarginPx: 8,
    title: '',
  },
)

const { t } = useI18n()

const effectiveTitle = computed(() => String(props.title || '').trim() || String(t('chat.attachments.title')))

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'remove', id: string): void
  (e: 'clear'): void
  (e: 'attachLocal'): void
  (e: 'attachProject'): void
}>()

const panelEl = ref<HTMLElement | null>(null)

const isMobileSheet = computed(() => Boolean(props.isMobilePointer))

const fileCount = computed(() => (Array.isArray(props.attachedFiles) ? props.attachedFiles.length : 0))
const countLabel = computed(() => {
  const n = fileCount.value
  if (n === 1) return String(t('chat.attachments.countLabelOne'))
  return String(t('chat.attachments.countLabelMany', { count: n }))
})

function isImageFile(f: AttachedFile): boolean {
  const mime = String(f?.mime || '')
    .trim()
    .toLowerCase()
  const url = typeof f?.url === 'string' ? f.url : ''
  return mime.startsWith('image/') && url.startsWith('data:')
}

function badgeTextForFilename(filename: string): string {
  const name = String(filename || '').trim()
  const lower = name.toLowerCase()

  if (lower.endsWith('.tar.gz')) return 'TGZ'
  if (lower.endsWith('.tar.bz2')) return 'TBZ2'
  if (lower.endsWith('.tar.xz')) return 'TXZ'

  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot >= name.length - 1) return 'FILE'
  const ext = name
    .slice(dot + 1)
    .trim()
    .toUpperCase()
  if (!ext) return 'FILE'
  return ext.length > 5 ? ext.slice(0, 5) : ext
}

function close() {
  emit('update:open', false)
}

function unwrapRefCandidate(value: unknown): unknown {
  let current = value
  for (let i = 0; i < 4; i += 1) {
    if (!isRef(current)) return current
    current = current.value
  }
  return current
}

function resolveAnchorElCandidate(value: unknown): HTMLElement | null {
  const raw = unwrapRefCandidate(value)
  if (raw instanceof HTMLElement) return raw
  if (!raw || typeof raw !== 'object') return null

  const triggerEl = unwrapRefCandidate((raw as { triggerEl?: unknown }).triggerEl)
  if (triggerEl instanceof HTMLElement) return triggerEl

  if (triggerEl && typeof triggerEl === 'object') {
    const triggerHostEl = unwrapRefCandidate((triggerEl as { $el?: unknown }).$el)
    if (triggerHostEl instanceof HTMLElement) return triggerHostEl
  }

  const hostEl = unwrapRefCandidate((raw as { $el?: unknown }).$el)
  if (hostEl instanceof HTMLElement) return hostEl

  return null
}

function resolveAnchorRectCandidate(value: unknown): DOMRect | null {
  const anchorEl = resolveAnchorElCandidate(value)
  if (anchorEl) return anchorEl.getBoundingClientRect()

  const raw = unwrapRefCandidate(value)
  if (!raw || typeof raw !== 'object') return null

  const getRect = (raw as { getBoundingClientRect?: () => DOMRect | undefined }).getBoundingClientRect
  if (typeof getRect === 'function') {
    const rect = getRect()
    if (rect) return rect
  }

  const triggerEl = unwrapRefCandidate((raw as { triggerEl?: unknown }).triggerEl)
  if (triggerEl && typeof triggerEl === 'object') {
    const triggerGetRect = (triggerEl as { getBoundingClientRect?: () => DOMRect | undefined }).getBoundingClientRect
    if (typeof triggerGetRect === 'function') {
      const rect = triggerGetRect()
      if (rect) return rect
    }
  }

  return null
}

function toNonNegativePx(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.round(n))
}

async function waitForAnimationFrame(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

// Desktop fixed positioning (anchored popover).
const panelGapPx = computed(() => toNonNegativePx(props.desktopGapPx, 8))
const viewportMarginPx = computed(() => toNonNegativePx(props.desktopViewportMarginPx, 8))

const desktopStyle = ref<CSSProperties>({
  left: `${viewportMarginPx.value}px`,
  top: `${viewportMarginPx.value}px`,
  visibility: 'hidden',
})

async function syncDesktopPosition() {
  if (!props.open || isMobileSheet.value) return
  if (typeof window === 'undefined') return

  await nextTick()

  const firstPass = computeDesktopStyle()
  if (!firstPass) return
  desktopStyle.value = firstPass

  await waitForAnimationFrame()
  if (!props.open || isMobileSheet.value) return
  const secondPass = computeDesktopStyle()
  if (!secondPass) return
  desktopStyle.value = secondPass
}

function computeDesktopStyle(): CSSProperties | null {
  if (typeof window === 'undefined') return null

  const panel = panelEl.value
  if (!panel) return null

  const panelRect = panel.getBoundingClientRect()
  const anchorRect = resolveDesktopAnchorRect()
  if (!anchorRect) return null
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const gap = panelGapPx.value
  const margin = viewportMarginPx.value
  const alignEnd = props.desktopPlacement.endsWith('end')
  const placeTop = props.desktopPlacement.startsWith('top')

  let left = alignEnd ? anchorRect.right - panelRect.width : anchorRect.left
  let top = placeTop ? anchorRect.top - panelRect.height - gap : anchorRect.bottom + gap

  if (!placeTop && top + panelRect.height > viewportHeight - margin) {
    top = anchorRect.top - panelRect.height - gap
  } else if (placeTop && top < margin) {
    top = anchorRect.bottom + gap
  }

  left = Math.max(margin, Math.min(left, viewportWidth - panelRect.width - margin))
  top = Math.max(margin, Math.min(top, viewportHeight - panelRect.height - margin))

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    visibility: 'visible',
  }
}

function resolveDesktopAnchorEl(): HTMLElement | null {
  return resolveAnchorElCandidate(props.desktopAnchorEl as unknown)
}

function resolveDesktopAnchorRect(): DOMRect | null {
  return resolveAnchorRectCandidate(props.desktopAnchorEl as unknown)
}

function onDesktopViewportChange() {
  void syncDesktopPosition()
}

function onDocumentClick(event: MouseEvent) {
  if (!props.open || isMobileSheet.value) return
  const target = event.target as Node | null
  if (!target) return
  if (panelEl.value?.contains(target)) return
  const anchor = resolveDesktopAnchorEl()
  if (anchor?.contains(target)) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.open || isMobileSheet.value) return
  if (event.key !== 'Escape') return
  close()
}

let desktopEventsBound = false
function bindDesktopEvents() {
  if (desktopEventsBound || typeof window === 'undefined' || typeof document === 'undefined') return
  window.addEventListener('resize', onDesktopViewportChange)
  window.addEventListener('scroll', onDesktopViewportChange, true)
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
  desktopEventsBound = true
}

function unbindDesktopEvents() {
  if (!desktopEventsBound || typeof window === 'undefined' || typeof document === 'undefined') return
  window.removeEventListener('resize', onDesktopViewportChange)
  window.removeEventListener('scroll', onDesktopViewportChange, true)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
  desktopEventsBound = false
}

// Mobile sheet positioning.
const MOBILE_SHEET_MARGIN_PX = 8
const MOBILE_SHEET_MIN_MAX_HEIGHT_PX = 180
const mobileSheetStyle = ref<CSSProperties>({
  top: `${MOBILE_SHEET_MARGIN_PX}px`,
  maxHeight: `calc(100dvh - ${MOBILE_SHEET_MARGIN_PX * 2}px)`,
})

function cssVarPx(name: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const parsed = Number.parseFloat(String(raw || '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveViewportHeight(): number {
  if (typeof window === 'undefined') return 0
  const vvHeight = window.visualViewport?.height
  if (typeof vvHeight === 'number' && Number.isFinite(vvHeight) && vvHeight > 0) return vvHeight
  return window.innerHeight
}

async function syncMobileSheetPosition() {
  if (!props.open || !isMobileSheet.value) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  await nextTick()

  const panel = panelEl.value
  if (!panel) return

  const viewportHeight = resolveViewportHeight()
  if (!viewportHeight) return

  const safeTop = cssVarPx('--oc-safe-area-top', 0)
  const safeBottom = cssVarPx('--oc-safe-area-bottom', 0)

  const topInset = safeTop + MOBILE_SHEET_MARGIN_PX
  const bottomInset = safeBottom + MOBILE_SHEET_MARGIN_PX
  const maxHeight = Math.max(MOBILE_SHEET_MIN_MAX_HEIGHT_PX, viewportHeight - topInset - bottomInset)
  const panelHeight = Math.min(maxHeight, Math.max(0, panel.scrollHeight))

  const centeredOffset = Math.max(0, Math.round((maxHeight - panelHeight) / 2))
  const top = topInset + centeredOffset

  mobileSheetStyle.value = {
    top: `${Math.round(top)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
}

function onMobileViewportChange() {
  void syncMobileSheetPosition()
}

let mobileViewportEventsBound = false
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
    if (open) {
      const margin = viewportMarginPx.value
      // Reset the desktop style so we avoid flashing stale positions.
      desktopStyle.value = {
        left: `${margin}px`,
        top: `${margin}px`,
        visibility: 'hidden',
      }

      if (isMobileSheet.value) {
        bindMobileViewportEvents()
        void syncMobileSheetPosition()
      } else {
        bindDesktopEvents()
        void syncDesktopPosition()
      }
      return
    }

    unbindDesktopEvents()
    unbindMobileViewportEvents()
  },
  { immediate: true },
)

watch(
  () => isMobileSheet.value,
  (mobile) => {
    if (!props.open) return
    if (mobile) {
      unbindDesktopEvents()
      bindMobileViewportEvents()
      void syncMobileSheetPosition()
      return
    }

    unbindMobileViewportEvents()
    bindDesktopEvents()
    void syncDesktopPosition()
  },
)

watch(
  () =>
    [
      props.desktopAnchorEl,
      props.desktopPlacement,
      props.desktopGapPx,
      props.desktopViewportMarginPx,
      fileCount.value,
      props.busy,
      isMobileSheet.value,
    ] as const,
  () => {
    if (!props.open) return
    if (isMobileSheet.value) void syncMobileSheetPosition()
    else void syncDesktopPosition()
  },
)

onBeforeUnmount(() => {
  unbindDesktopEvents()
  unbindMobileViewportEvents()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && !isMobileSheet"
      ref="panelEl"
      class="pointer-events-auto fixed z-[60] w-[min(420px,calc(100vw-1rem))] max-h-[min(72dvh,560px)] rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur overflow-hidden flex flex-col"
      :style="desktopStyle"
      @pointerdown.stop
      @click.stop
    >
      <div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/40">
        <div class="min-w-0 flex items-center gap-2">
          <RiAttachmentLine class="h-4 w-4 text-muted-foreground" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-foreground truncate">{{ effectiveTitle }}</div>
            <div class="mt-0.5 text-[10px] text-muted-foreground font-mono">
              <span v-if="busy" class="inline-flex items-center gap-1">
                <RiLoader4Line class="h-3.5 w-3.5 animate-spin" />
                {{ t('chat.attachments.attaching') }}
              </span>
              <span v-else>{{ countLabel }}</span>
            </div>
          </div>
        </div>
        <IconButton
          size="sm"
          :tooltip="t('common.close')"
          :is-mobile-pointer="isMobileSheet"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="close"
        >
          <RiCloseLine class="h-4 w-4" />
        </IconButton>
      </div>

      <div class="p-3 flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" class="h-8" @click="$emit('attachLocal')">
            <RiFileUploadLine class="h-4 w-4 mr-1.5" />
            {{ t('chat.attachments.actions.addFromComputer') }}
          </Button>
          <Button size="xs" variant="outline" class="h-8" @click="$emit('attachProject')">
            <RiFileLine class="h-4 w-4 mr-1.5" />
            {{ t('chat.attachments.actions.addFromProject') }}
          </Button>
          <Button
            size="xs"
            variant="ghost-destructive"
            class="h-8 ml-auto"
            :disabled="fileCount === 0"
            @click="$emit('clear')"
          >
            {{ t('chat.attachments.actions.clearAll') }}
          </Button>
        </div>

        <div class="flex-1 min-h-0 overflow-auto pr-1">
          <div
            v-if="busy && fileCount === 0"
            class="rounded-lg border border-border/60 bg-muted/15 px-3 py-3 animate-in fade-in-0 duration-150"
          >
            <div class="space-y-2">
              <Skeleton class="h-3 w-2/3" />
              <Skeleton class="h-3 w-1/2" />
              <div class="space-y-1.5 pt-1">
                <Skeleton class="h-8 w-full" />
                <Skeleton class="h-8 w-11/12" />
                <Skeleton class="h-8 w-10/12" />
              </div>
            </div>
          </div>

          <div
            v-else-if="fileCount === 0"
            class="rounded-lg border border-border/60 bg-muted/15 px-3 py-3 animate-in fade-in-0 duration-150"
          >
            <div class="text-xs font-medium">{{ t('chat.attachments.empty.title') }}</div>
            <div class="mt-1 text-[11px] text-muted-foreground">{{ t('chat.attachments.empty.description') }}</div>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="f in attachedFiles"
              :key="f.id"
              class="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
            >
              <div
                class="h-9 w-9 shrink-0 rounded-lg border border-border/50 bg-muted/10 overflow-hidden flex items-center justify-center"
                aria-hidden="true"
              >
                <img
                  v-if="isImageFile(f)"
                  :src="f.url"
                  :alt="f.filename"
                  class="h-full w-full object-cover"
                  draggable="false"
                />
                <span v-else class="text-[10px] font-mono text-muted-foreground uppercase">
                  {{ badgeTextForFilename(f.filename) }}
                </span>
              </div>

              <div class="min-w-0 flex-1">
                <div class="text-xs font-mono font-medium truncate" :title="f.filename">{{ f.filename }}</div>
                <div
                  v-if="f.serverPath"
                  class="mt-0.5 text-[11px] text-muted-foreground font-mono truncate"
                  :title="f.serverPath"
                >
                  {{ f.serverPath }}
                </div>
              </div>

              <div class="shrink-0 flex items-center gap-2">
                <span class="text-[11px] text-muted-foreground font-mono tabular-nums">
                  <template v-if="f.serverPath">{{ t('chat.attachments.repo') }}</template>
                  <template v-else>{{ formatBytes(f.size) }}</template>
                </span>
                <IconButton
                  size="xs"
                  class="text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  :tooltip="t('common.remove')"
                  :is-mobile-pointer="isMobileSheet"
                  :title="t('common.remove')"
                  :aria-label="t('chat.attachments.removeAttachmentAria')"
                  @click="$emit('remove', f.id)"
                >
                  <RiCloseLine class="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <div v-if="open && isMobileSheet" class="fixed inset-0 z-50" @pointerdown.stop @click="close">
    <div class="absolute inset-0 bg-black/55 backdrop-blur-sm" />
    <div
      ref="panelEl"
      class="absolute left-1/2 w-[calc(100%-1rem)] max-w-[24rem] -translate-x-1/2 rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur overflow-hidden flex flex-col"
      :style="mobileSheetStyle"
      @pointerdown.stop
      @click.stop
    >
      <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <RiAttachmentLine class="h-4.5 w-4.5 text-muted-foreground" />
            <div class="text-sm font-semibold truncate">{{ effectiveTitle }}</div>
          </div>
          <div class="mt-1 text-[12px] text-muted-foreground font-mono">
            <span v-if="busy" class="inline-flex items-center gap-1">
              <RiLoader4Line class="h-4 w-4 animate-spin" />
              {{ t('chat.attachments.attaching') }}
            </span>
            <span v-else>{{ countLabel }}</span>
          </div>
        </div>
        <IconButton
          size="sm"
          :tooltip="t('common.close')"
          :is-mobile-pointer="isMobileSheet"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="close"
        >
          <RiCloseLine class="h-4 w-4" />
        </IconButton>
      </div>

      <div class="p-4 flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" class="h-9" @click="$emit('attachLocal')">
            <RiFileUploadLine class="h-4 w-4 mr-2" />
            {{ t('chat.attachments.actions.addFromComputer') }}
          </Button>
          <Button size="sm" variant="outline" class="h-9" @click="$emit('attachProject')">
            <RiFileLine class="h-4 w-4 mr-2" />
            {{ t('chat.attachments.actions.addFromProject') }}
          </Button>
          <Button
            size="sm"
            variant="ghost-destructive"
            class="h-9 ml-auto"
            :disabled="fileCount === 0"
            @click="$emit('clear')"
          >
            {{ t('chat.attachments.actions.clear') }}
          </Button>
        </div>

        <div class="flex-1 min-h-0 overflow-auto pr-1">
          <div
            v-if="busy && fileCount === 0"
            class="rounded-lg border border-border/60 bg-muted/15 px-3 py-3 animate-in fade-in-0 duration-150"
          >
            <div class="space-y-2.5">
              <Skeleton class="h-3.5 w-2/3" />
              <Skeleton class="h-3.5 w-1/2" />
              <div class="space-y-2 pt-1">
                <Skeleton class="h-9 w-full" />
                <Skeleton class="h-9 w-11/12" />
                <Skeleton class="h-9 w-10/12" />
              </div>
            </div>
          </div>

          <div
            v-else-if="fileCount === 0"
            class="rounded-lg border border-border/60 bg-muted/15 px-3 py-3 animate-in fade-in-0 duration-150"
          >
            <div class="text-sm font-medium">{{ t('chat.attachments.empty.title') }}</div>
            <div class="mt-1 text-[13px] text-muted-foreground">{{ t('chat.attachments.empty.description') }}</div>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="f in attachedFiles"
              :key="f.id"
              class="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
            >
              <div
                class="h-10 w-10 shrink-0 rounded-lg border border-border/50 bg-muted/10 overflow-hidden flex items-center justify-center"
                aria-hidden="true"
              >
                <img
                  v-if="isImageFile(f)"
                  :src="f.url"
                  :alt="f.filename"
                  class="h-full w-full object-cover"
                  draggable="false"
                />
                <span v-else class="text-[10px] font-mono text-muted-foreground uppercase">
                  {{ badgeTextForFilename(f.filename) }}
                </span>
              </div>

              <div class="min-w-0 flex-1">
                <div class="text-sm font-mono font-medium truncate" :title="f.filename">{{ f.filename }}</div>
                <div
                  v-if="f.serverPath"
                  class="mt-0.5 text-[13px] text-muted-foreground font-mono truncate"
                  :title="f.serverPath"
                >
                  {{ f.serverPath }}
                </div>
              </div>

              <div class="shrink-0 flex items-center gap-2">
                <span class="text-[12px] text-muted-foreground font-mono tabular-nums">
                  <template v-if="f.serverPath">{{ t('chat.attachments.repo') }}</template>
                  <template v-else>{{ formatBytes(f.size) }}</template>
                </span>
                <IconButton
                  size="xs"
                  class="text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  :tooltip="t('common.remove')"
                  :is-mobile-pointer="isMobileSheet"
                  :title="t('common.remove')"
                  :aria-label="t('chat.attachments.removeAttachmentAria')"
                  @click="$emit('remove', f.id)"
                >
                  <RiCloseLine class="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
