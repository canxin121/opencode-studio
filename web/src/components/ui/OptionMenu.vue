<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiMore2Line,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import ListRowButton from '@/components/ui/ListRowButton.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { cn } from '@/lib/utils'

type ResolvedGroup = OptionMenuGroup & {
  _key: string
  _sourceIndex: number
}

const props = withDefaults(
  defineProps<{
    open: boolean
    query?: string
    groups: OptionMenuGroup[]
    title?: string
    mobileTitle?: string
    searchable?: boolean
    searchPlaceholder?: string
    emptyText?: string
    helperText?: string
    isMobilePointer?: boolean
    closeLabel?: string
    desktopPlacement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
    desktopClass?: string
    desktopStyle?: CSSProperties
    desktopFixed?: boolean
    desktopAnchorEl?: HTMLElement | null
    desktopContentMaxHeightClass?: string
    filterMode?: 'internal' | 'external'
    closeOnSelect?: boolean
    autoFocusSearch?: boolean
    paginated?: boolean
    pageSize?: number
    paginationMode?: 'group' | 'item'
    collapsibleGroups?: boolean
  }>(),
  {
    query: '',
    title: '',
    mobileTitle: '',
    searchable: true,
    searchPlaceholder: '',
    emptyText: '',
    helperText: '',
    isMobilePointer: false,
    closeLabel: '',
    desktopPlacement: 'bottom-start',
    desktopClass: 'w-64',
    desktopStyle: undefined,
    desktopFixed: false,
    desktopAnchorEl: null,
    desktopContentMaxHeightClass: 'max-h-64',
    filterMode: 'internal',
    closeOnSelect: true,
    autoFocusSearch: true,
    paginated: false,
    pageSize: 80,
    paginationMode: 'group',
    collapsibleGroups: false,
  },
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:query', value: string): void
  (e: 'select', item: OptionMenuItem): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const effectiveSearchPlaceholder = computed(() =>
  props.searchPlaceholder && props.searchPlaceholder.trim() ? props.searchPlaceholder : t('common.searchOptions'),
)
const effectiveEmptyText = computed(() =>
  props.emptyText && props.emptyText.trim() ? props.emptyText : t('common.noOptionsFound'),
)
const effectiveCloseLabel = computed(() =>
  props.closeLabel && props.closeLabel.trim() ? props.closeLabel : t('common.close'),
)

const rootEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const collapsedGroupByKey = ref<Record<string, boolean>>({})
const currentPage = ref(1)

const isMobileSheet = computed(() => Boolean(props.isMobilePointer))
const normalizedQuery = computed(() =>
  String(props.query || '')
    .trim()
    .toLowerCase(),
)
const effectivePageSize = computed(() => Math.max(1, Math.floor(Number(props.pageSize) || 80)))

const desktopPlacementClass = computed(() => {
  switch (props.desktopPlacement) {
    case 'top-start':
      return 'left-0 bottom-full mb-2'
    case 'top-end':
      return 'right-0 bottom-full mb-2'
    case 'bottom-end':
      return 'right-0 top-full mt-2'
    case 'bottom-start':
    default:
      return 'left-0 top-full mt-2'
  }
})

const PANEL_GAP_PX = 8
const PANEL_VIEWPORT_MARGIN_PX = 8
const MOBILE_SHEET_MARGIN_PX = 8

const desktopFixedStyle = ref<CSSProperties>({
  left: `${PANEL_VIEWPORT_MARGIN_PX}px`,
  top: `${PANEL_VIEWPORT_MARGIN_PX}px`,
  visibility: 'hidden',
})

const mobileSheetStyle = ref<CSSProperties>({
  top: `${MOBILE_SHEET_MARGIN_PX}px`,
  maxHeight: `calc(100dvh - ${MOBILE_SHEET_MARGIN_PX * 2}px)`,
})

let desktopFixedEventsBound = false
let dismissEventsBound = false
let mobileViewportEventsBound = false
const onViewportChange = () => {
  void syncDesktopFixedPosition()
}
const onMobileViewportChange = () => {
  void syncMobileSheetPosition()
}

function onDocumentClick(event: MouseEvent) {
  if (!props.open || isMobileSheet.value) return
  const target = event.target as Node | null
  if (containsTarget(target)) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.open || isMobileSheet.value) return
  if (event.key !== 'Escape') return
  closeMenu()
}

function resolveDesktopAnchor(): HTMLElement | null {
  if (props.desktopAnchorEl instanceof HTMLElement) return props.desktopAnchorEl
  const root = rootEl.value
  if (!root) return null
  if (root.parentElement instanceof HTMLElement) return root.parentElement
  return root
}

function resetDesktopFixedStyle() {
  desktopFixedStyle.value = {
    ...(props.desktopStyle || {}),
    left: `${PANEL_VIEWPORT_MARGIN_PX}px`,
    top: `${PANEL_VIEWPORT_MARGIN_PX}px`,
    visibility: 'hidden',
  }
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

async function syncDesktopFixedPosition() {
  if (!props.desktopFixed || !props.open || isMobileSheet.value) return
  if (typeof window === 'undefined') return

  await nextTick()

  const panel = panelEl.value
  const anchor = resolveDesktopAnchor()
  if (!panel || !anchor) return

  const panelRect = panel.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const alignEnd = props.desktopPlacement.endsWith('end')
  const placeTop = props.desktopPlacement.startsWith('top')

  let left = alignEnd ? anchorRect.right - panelRect.width : anchorRect.left
  let top = placeTop ? anchorRect.top - panelRect.height - PANEL_GAP_PX : anchorRect.bottom + PANEL_GAP_PX

  if (!placeTop && top + panelRect.height > viewportHeight - PANEL_VIEWPORT_MARGIN_PX) {
    top = anchorRect.top - panelRect.height - PANEL_GAP_PX
  } else if (placeTop && top < PANEL_VIEWPORT_MARGIN_PX) {
    top = anchorRect.bottom + PANEL_GAP_PX
  }

  left = Math.max(PANEL_VIEWPORT_MARGIN_PX, Math.min(left, viewportWidth - panelRect.width - PANEL_VIEWPORT_MARGIN_PX))
  top = Math.max(PANEL_VIEWPORT_MARGIN_PX, Math.min(top, viewportHeight - panelRect.height - PANEL_VIEWPORT_MARGIN_PX))

  desktopFixedStyle.value = {
    ...(props.desktopStyle || {}),
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    visibility: 'visible',
  }
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
  const maxHeight = Math.max(180, viewportHeight - topInset - bottomInset)
  const panelHeight = Math.min(maxHeight, Math.max(0, panel.scrollHeight))

  const centeredOffset = Math.max(0, Math.round((maxHeight - panelHeight) / 2))
  const top = topInset + centeredOffset

  mobileSheetStyle.value = {
    top: `${Math.round(top)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
}

function bindDesktopFixedEvents() {
  if (desktopFixedEventsBound || typeof window === 'undefined') return
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  desktopFixedEventsBound = true
}

function unbindDesktopFixedEvents() {
  if (!desktopFixedEventsBound || typeof window === 'undefined') return
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  desktopFixedEventsBound = false
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

function bindDismissEvents() {
  if (dismissEventsBound || typeof document === 'undefined') return
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
  dismissEventsBound = true
}

function unbindDismissEvents() {
  if (!dismissEventsBound || typeof document === 'undefined') return
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
  dismissEventsBound = false
}

function itemHaystack(item: OptionMenuItem): string {
  return `${item.id} ${item.label || ''} ${item.description || ''} ${item.keywords || ''}`.toLowerCase()
}

const allGroups = computed<ResolvedGroup[]>(() => {
  const groups = Array.isArray(props.groups) ? props.groups : []
  return groups.map((group, index) => ({
    ...group,
    items: Array.isArray(group.items) ? group.items : [],
    _key: String(group.id || `group-${index}`),
    _sourceIndex: index,
  }))
})

const visibleGroups = computed<ResolvedGroup[]>(() => {
  const groups = allGroups.value
  if (props.filterMode === 'external' || !props.searchable || !normalizedQuery.value) return groups

  const q = normalizedQuery.value
  return groups
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => itemHaystack(item).includes(q)),
    }))
    .filter((group) => (group.items || []).length > 0)
})

watch(
  () => visibleGroups.value,
  (groups) => {
    const next = { ...collapsedGroupByKey.value }
    for (const group of groups) {
      if (!(group._key in next)) {
        next[group._key] = Boolean(group.defaultCollapsed)
      }
    }
    collapsedGroupByKey.value = next
  },
  { immediate: true },
)

function canCollapseGroup(group: ResolvedGroup): boolean {
  if (!props.collapsibleGroups) return false
  if (group.collapsible === false) return false
  return Boolean(group.title || group.subtitle)
}

function isGroupCollapsed(group: ResolvedGroup): boolean {
  if (!canCollapseGroup(group)) return false
  return Boolean(collapsedGroupByKey.value[group._key])
}

function toggleGroupCollapsed(group: ResolvedGroup) {
  if (!canCollapseGroup(group)) return
  collapsedGroupByKey.value = {
    ...collapsedGroupByKey.value,
    [group._key]: !isGroupCollapsed(group),
  }
}

const groupedPages = computed<ResolvedGroup[][]>(() => {
  const groups = visibleGroups.value
  if (!props.paginated) return [groups]
  if (groups.length === 0) return [[]]

  const pageSize = effectivePageSize.value

  if (props.paginationMode === 'item') {
    const pages: ResolvedGroup[][] = []
    let currentGroups: ResolvedGroup[] = []
    let currentGroupMap = new Map<string, ResolvedGroup>()
    let currentCount = 0

    for (const group of groups) {
      for (const item of group.items) {
        if (currentCount >= pageSize) {
          pages.push(currentGroups)
          currentGroups = []
          currentGroupMap = new Map<string, ResolvedGroup>()
          currentCount = 0
        }

        let bucket = currentGroupMap.get(group._key)
        if (!bucket) {
          bucket = {
            ...group,
            items: [],
          }
          currentGroupMap.set(group._key, bucket)
          currentGroups.push(bucket)
        }
        bucket.items.push(item)
        currentCount += 1
      }
    }

    if (currentGroups.length > 0) pages.push(currentGroups)
    return pages.length > 0 ? pages : [[]]
  }

  const pages: ResolvedGroup[][] = []
  let currentGroups: ResolvedGroup[] = []
  let currentCount = 0

  for (const group of groups) {
    const groupCount = group.items.length

    if (currentGroups.length === 0) {
      currentGroups = [group]
      currentCount = groupCount
      continue
    }

    if (currentCount + groupCount > pageSize) {
      pages.push(currentGroups)
      currentGroups = [group]
      currentCount = groupCount
      continue
    }

    currentGroups.push(group)
    currentCount += groupCount
  }

  if (currentGroups.length > 0) pages.push(currentGroups)
  return pages.length > 0 ? pages : [[]]
})

const pageCount = computed(() => Math.max(1, groupedPages.value.length))

const pagedGroups = computed<ResolvedGroup[]>(() => {
  const idx = Math.max(0, Math.min(pageCount.value - 1, currentPage.value - 1))
  return groupedPages.value[idx] || []
})

const totalVisibleItemCount = computed(() => visibleGroups.value.reduce((sum, group) => sum + group.items.length, 0))
const hasVisibleItems = computed(() => totalVisibleItemCount.value > 0)

const showPager = computed(() => props.paginated && hasVisibleItems.value && pageCount.value > 1)

const pagerLabel = computed(() => `${currentPage.value}/${pageCount.value}`)

watch(
  () => pageCount.value,
  (count) => {
    if (currentPage.value > count) currentPage.value = count
    if (currentPage.value < 1) currentPage.value = 1
  },
  { immediate: true },
)

watch(
  () => normalizedQuery.value,
  () => {
    if (!props.paginated) return
    currentPage.value = 1
  },
)

watch(
  () => [props.query, totalVisibleItemCount.value, showPager.value] as const,
  () => {
    if (!props.open || !isMobileSheet.value) return
    void syncMobileSheetPosition()
  },
)

const desktopInputClass = computed(() => 'h-8 text-xs')
const mobileInputClass = computed(() => 'h-9 text-sm')
const desktopPanelStyle = computed<CSSProperties | undefined>(() =>
  props.desktopFixed ? desktopFixedStyle.value : props.desktopStyle,
)

function closeMenu() {
  emit('update:open', false)
  emit('close')
}

function selectItem(item: OptionMenuItem) {
  if (item.disabled) return
  emit('select', item)
  if (props.closeOnSelect) closeMenu()
}

function updateQuery(value: string | number) {
  emit('update:query', String(value || ''))
}

function goToPrevPage() {
  if (currentPage.value <= 1) return
  currentPage.value -= 1
}

function goToNextPage() {
  if (currentPage.value >= pageCount.value) return
  currentPage.value += 1
}

async function focusSearch() {
  await nextTick()
  const root = panelEl.value
  if (!root || !props.searchable) return
  const input = root.querySelector('input') as HTMLInputElement | null
  input?.focus()
}

function containsTarget(target: Node | null): boolean {
  if (!target) return false
  return Boolean(rootEl.value?.contains(target) || panelEl.value?.contains(target))
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      if (isMobileSheet.value) {
        bindMobileViewportEvents()
        void syncMobileSheetPosition()
      } else {
        bindDismissEvents()
      }
      if (props.paginated) currentPage.value = 1
      if (props.desktopFixed && !isMobileSheet.value) {
        resetDesktopFixedStyle()
        bindDesktopFixedEvents()
        void syncDesktopFixedPosition()
      }
      if (props.autoFocusSearch && props.searchable && !isMobileSheet.value) {
        void focusSearch()
      }
      return
    }

    unbindDismissEvents()
    unbindDesktopFixedEvents()
    unbindMobileViewportEvents()
  },
  { immediate: true },
)

watch(
  () => isMobileSheet.value,
  (mobile) => {
    if (!props.open) return
    if (mobile) {
      unbindDismissEvents()
      unbindDesktopFixedEvents()
      bindMobileViewportEvents()
      void syncMobileSheetPosition()
    } else {
      unbindMobileViewportEvents()
      bindDismissEvents()
      if (props.desktopFixed) {
        resetDesktopFixedStyle()
        bindDesktopFixedEvents()
        void syncDesktopFixedPosition()
      }
    }
  },
)

watch(
  () =>
    [
      props.desktopFixed,
      props.desktopPlacement,
      props.desktopAnchorEl,
      props.desktopStyle,
      props.open,
      isMobileSheet.value,
    ] as const,
  ([fixed, _placement, _anchor, _style, open, mobile]) => {
    if (!fixed || !open || mobile) return
    resetDesktopFixedStyle()
    void syncDesktopFixedPosition()
  },
)

onBeforeUnmount(() => {
  unbindDismissEvents()
  unbindDesktopFixedEvents()
  unbindMobileViewportEvents()
})

defineExpose({ containsTarget, focusSearch })
</script>

<template>
  <div ref="rootEl" class="contents">
    <Teleport to="body" :disabled="!desktopFixed">
      <div
        v-if="open && !isMobileSheet"
        ref="panelEl"
        data-oc-keyboard-tap="keep"
        :class="
          cn(
            desktopFixed
              ? 'pointer-events-auto fixed z-[60] rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur overflow-hidden'
              : 'pointer-events-auto absolute z-[60] rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur overflow-hidden',
            desktopFixed ? '' : desktopPlacementClass,
            desktopClass,
          )
        "
        :style="desktopPanelStyle"
        @pointerdown.stop
        @click.stop
      >
        <div v-if="title" class="px-3 py-2 border-b border-border/40 text-xs font-semibold text-foreground">
          {{ title }}
        </div>

        <div v-if="searchable" class="p-2 border-b border-border/40">
          <Input
            :model-value="query"
            :placeholder="effectiveSearchPlaceholder"
            :class="desktopInputClass"
            @update:model-value="updateQuery"
          />
        </div>

        <div class="p-1 overflow-auto" :class="desktopContentMaxHeightClass">
          <template v-if="hasVisibleItems">
            <div
              v-for="(group, groupIndex) in pagedGroups"
              :key="group._key || `group-${groupIndex}`"
              :class="groupIndex > 0 ? 'mt-1 pt-1 border-t border-border/40' : ''"
            >
              <div v-if="group.title || group.subtitle" class="px-2 py-1">
                <button
                  v-if="canCollapseGroup(group)"
                  type="button"
                  class="w-full flex items-start gap-1.5 rounded px-1 py-1 text-left hover:bg-secondary/40"
                  @click="toggleGroupCollapsed(group)"
                >
                  <RiArrowDownSLine
                    class="h-3.5 w-3.5 mt-0.5 text-muted-foreground transition-transform"
                    :class="isGroupCollapsed(group) ? '-rotate-90' : ''"
                  />
                  <div class="min-w-0 flex-1">
                    <div
                      v-if="group.title"
                      class="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground"
                    >
                      {{ group.title }}
                    </div>
                    <div v-if="group.subtitle" class="text-[10px] text-muted-foreground/70">{{ group.subtitle }}</div>
                  </div>
                  <span class="text-[10px] text-muted-foreground/70 tabular-nums">{{ group.items.length }}</span>
                </button>

                <div v-else>
                  <div
                    v-if="group.title"
                    class="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground"
                  >
                    {{ group.title }}
                  </div>
                  <div v-if="group.subtitle" class="text-[10px] text-muted-foreground/70">{{ group.subtitle }}</div>
                </div>
              </div>

              <template v-if="!isGroupCollapsed(group)">
                <template v-for="item in group.items" :key="item.id">
                  <ConfirmPopover
                    v-if="item.confirmTitle"
                    :title="item.confirmTitle"
                    :description="item.confirmDescription || ''"
                    :confirm-text="item.confirmText || t('common.confirm')"
                    :cancel-text="item.cancelText || t('common.cancel')"
                    :variant="item.variant === 'destructive' ? 'destructive' : 'default'"
                    @confirm="selectItem(item)"
                  >
                    <ListRowButton
                      size="sm"
                      class="text-xs"
                      :disabled="item.disabled"
                      :destructive="item.variant === 'destructive'"
                      @click.stop
                    >
                      <component :is="item.icon || RiMore2Line" class="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div class="min-w-0 flex-1">
                        <div class="text-xs font-medium truncate" :class="item.monospace ? 'font-mono' : ''">
                          {{ item.label }}
                        </div>
                        <div v-if="item.description" class="text-[11px] text-muted-foreground truncate">
                          {{ item.description }}
                        </div>
                      </div>
                      <RiCheckLine v-if="item.checked" class="h-4 w-4 text-primary flex-shrink-0" />
                    </ListRowButton>
                  </ConfirmPopover>

                  <ListRowButton
                    v-else
                    size="sm"
                    class="text-xs"
                    :disabled="item.disabled"
                    :destructive="item.variant === 'destructive'"
                    @click="selectItem(item)"
                  >
                    <component :is="item.icon || RiMore2Line" class="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-medium truncate" :class="item.monospace ? 'font-mono' : ''">
                        {{ item.label }}
                      </div>
                      <div v-if="item.description" class="text-[11px] text-muted-foreground truncate">
                        {{ item.description }}
                      </div>
                    </div>
                    <RiCheckLine v-if="item.checked" class="h-4 w-4 text-primary flex-shrink-0" />
                  </ListRowButton>
                </template>
              </template>
            </div>

            <div v-if="helperText" class="px-3 py-2 text-[11px] text-muted-foreground">{{ helperText }}</div>
          </template>

          <div v-else class="px-3 py-3 text-xs text-muted-foreground">{{ effectiveEmptyText }}</div>
        </div>

        <div
          v-if="showPager"
          class="border-t border-border/40 px-2 py-1.5 flex items-center justify-between gap-2 bg-background/80"
        >
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            :title="t('common.previousPage')"
            :aria-label="t('common.previousPage')"
            :disabled="currentPage <= 1"
            @click="goToPrevPage"
          >
            <RiArrowLeftSLine class="h-4 w-4" />
          </Button>
          <div class="text-[11px] text-muted-foreground tabular-nums text-center">{{ pagerLabel }}</div>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            :title="t('common.nextPage')"
            :aria-label="t('common.nextPage')"
            :disabled="currentPage >= pageCount"
            @click="goToNextPage"
          >
            <RiArrowRightSLine class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="open && isMobileSheet"
        class="fixed inset-0 z-50"
        data-oc-keyboard-tap="keep"
        @pointerdown.stop
        @click="closeMenu"
      >
        <div class="absolute inset-0 bg-black/55 backdrop-blur-sm" />
        <div
          ref="panelEl"
          class="absolute left-1/2 w-[calc(100%-1rem)] max-w-[21rem] -translate-x-1/2 rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur overflow-hidden flex flex-col"
          :style="mobileSheetStyle"
          @pointerdown.stop
          @click.stop
        >
          <div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/40">
            <div class="text-sm font-semibold">{{ mobileTitle || title || t('common.options') }}</div>
            <IconButton size="sm" :title="effectiveCloseLabel" :aria-label="effectiveCloseLabel" @click="closeMenu">
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
          </div>

          <div v-if="searchable" class="p-3 border-b border-border/40">
            <Input
              :model-value="query"
              :placeholder="effectiveSearchPlaceholder"
              :class="mobileInputClass"
              @update:model-value="updateQuery"
            />
          </div>

          <div class="flex-1 min-h-0 overflow-auto px-2 py-1.5">
            <template v-if="hasVisibleItems">
              <div
                v-for="(group, groupIndex) in pagedGroups"
                :key="group._key || `mobile-group-${groupIndex}`"
                :class="groupIndex > 0 ? 'mt-1 pt-1 border-t border-border/40' : ''"
              >
                <div v-if="group.title || group.subtitle" class="px-2 py-1">
                  <button
                    v-if="canCollapseGroup(group)"
                    type="button"
                    class="w-full flex items-start gap-2 rounded px-1 py-1 text-left hover:bg-secondary/40"
                    @click="toggleGroupCollapsed(group)"
                  >
                    <RiArrowDownSLine
                      class="h-4 w-4 mt-0.5 text-muted-foreground transition-transform"
                      :class="isGroupCollapsed(group) ? '-rotate-90' : ''"
                    />
                    <div class="min-w-0 flex-1">
                      <div
                        v-if="group.title"
                        class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground"
                      >
                        {{ group.title }}
                      </div>
                      <div v-if="group.subtitle" class="text-[11px] text-muted-foreground/70">{{ group.subtitle }}</div>
                    </div>
                    <span class="text-[11px] text-muted-foreground/70 tabular-nums">{{ group.items.length }}</span>
                  </button>

                  <div v-else>
                    <div
                      v-if="group.title"
                      class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground"
                    >
                      {{ group.title }}
                    </div>
                    <div v-if="group.subtitle" class="text-[11px] text-muted-foreground/70">{{ group.subtitle }}</div>
                  </div>
                </div>

                <template v-if="!isGroupCollapsed(group)">
                  <template v-for="item in group.items" :key="item.id">
                    <ConfirmPopover
                      v-if="item.confirmTitle"
                      :title="item.confirmTitle"
                      :description="item.confirmDescription || ''"
                      :confirm-text="item.confirmText || t('common.confirm')"
                      :cancel-text="item.cancelText || t('common.cancel')"
                      :variant="item.variant === 'destructive' ? 'destructive' : 'default'"
                      @confirm="selectItem(item)"
                    >
                      <ListRowButton
                        size="md"
                        class="px-4"
                        :disabled="item.disabled"
                        :destructive="item.variant === 'destructive'"
                        @click.stop
                      >
                        <div class="mx-auto flex w-full max-w-[18rem] items-center gap-3">
                          <component :is="item.icon || RiMore2Line" class="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div class="min-w-0 flex-1">
                            <div class="text-sm font-medium truncate" :class="item.monospace ? 'font-mono' : ''">
                              {{ item.label }}
                            </div>
                            <div v-if="item.description" class="text-[13px] text-muted-foreground truncate">
                              {{ item.description }}
                            </div>
                          </div>
                          <RiCheckLine v-if="item.checked" class="h-4 w-4 text-primary flex-shrink-0" />
                        </div>
                      </ListRowButton>
                    </ConfirmPopover>

                    <ListRowButton
                      v-else
                      size="md"
                      class="px-4"
                      :disabled="item.disabled"
                      :destructive="item.variant === 'destructive'"
                      @click="selectItem(item)"
                    >
                      <div class="mx-auto flex w-full max-w-[18rem] items-center gap-3">
                        <component :is="item.icon || RiMore2Line" class="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-medium truncate" :class="item.monospace ? 'font-mono' : ''">
                            {{ item.label }}
                          </div>
                          <div v-if="item.description" class="text-[13px] text-muted-foreground truncate">
                            {{ item.description }}
                          </div>
                        </div>
                        <RiCheckLine v-if="item.checked" class="h-4 w-4 text-primary flex-shrink-0" />
                      </div>
                    </ListRowButton>
                  </template>
                </template>
              </div>

              <div v-if="helperText" class="px-3 py-2 text-[13px] text-muted-foreground">{{ helperText }}</div>
            </template>

            <div v-else class="px-3 py-3 text-sm text-muted-foreground">{{ effectiveEmptyText }}</div>
          </div>

          <div
            v-if="showPager"
            class="border-t border-border/40 px-3 py-2 flex items-center justify-between gap-2 bg-background/80"
          >
            <Button
              size="sm"
              variant="ghost"
              class="h-8 w-8 p-0"
              :title="t('common.previousPage')"
              :aria-label="t('common.previousPage')"
              :disabled="currentPage <= 1"
              @click="goToPrevPage"
            >
              <RiArrowLeftSLine class="h-4 w-4" />
            </Button>
            <div class="text-xs text-muted-foreground tabular-nums text-center">{{ pagerLabel }}</div>
            <Button
              size="sm"
              variant="ghost"
              class="h-8 w-8 p-0"
              :title="t('common.nextPage')"
              :aria-label="t('common.nextPage')"
              :disabled="currentPage >= pageCount"
              @click="goToNextPage"
            >
              <RiArrowRightSLine class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
