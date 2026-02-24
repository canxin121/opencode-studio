<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiMore2Line,
  RiQuestionLine,
  RiShieldLine,
  RiStarFill,
  RiStarLine,
} from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { directoryEntryLabel, formatTime, sessionLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import type { SessionActionItem } from '@/layout/chatSidebar/useSessionActionMenu'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import SidebarSessionActionMenu from '@/layout/chatSidebar/components/SidebarSessionActionMenu.vue'
import { shouldAcceptSessionActionTap } from '@/layout/chatSidebar/sessionActionTapGuard'

type SessionLike = {
  id?: string | number | null
  title?: string | null
  slug?: string | null
  directory?: string | null
  time?: { updated?: number | string | null } | null
}

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    sessionId: string
    session?: SessionLike | null
    directory?: DirectoryEntry | null

    uiIsMobile: boolean
    selected?: boolean
    highlighted?: boolean

    showDirectory?: boolean
    showTime?: boolean

    indentPx?: number
    isParent?: boolean
    isExpanded?: boolean
    showThreadPlaceholder?: boolean

    statusLabel?: string
    statusDotClass?: string
    attention?: 'permission' | 'question' | null

    pinned?: boolean
    actionsEnabled?: boolean
    canPin?: boolean
    canDelete?: boolean

    renaming?: boolean
    renameDraft?: string
    renameBusy?: boolean

    sessionActionMenuOpen?: boolean
    sessionActionMenuAnchorEl?: HTMLElement | null
    sessionActionMenuQuery?: string
    filteredSessionActionItems?: SessionActionItem[]
    setSessionActionMenuRef?: (el: Element | ComponentPublicInstance | null) => void
    runSessionActionMenu?: (item: SessionActionItem) => Promise<void>
    menuPlacement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
  }>(),
  {
    selected: false,
    highlighted: false,
    showDirectory: false,
    showTime: true,
    indentPx: 8,
    isParent: false,
    isExpanded: false,
    showThreadPlaceholder: false,
    statusLabel: '',
    statusDotClass: '',
    attention: null,
    pinned: false,
    actionsEnabled: true,
    canPin: true,
    canDelete: true,
    renaming: false,
    renameDraft: '',
    renameBusy: false,
    sessionActionMenuOpen: false,
    sessionActionMenuAnchorEl: null,
    sessionActionMenuQuery: '',
    filteredSessionActionItems: () => [],
    menuPlacement: 'bottom-start',
  },
)

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'toggle-thread'): void
  (e: 'open-actions'): void
  (e: 'open-action-menu', event: MouseEvent | PointerEvent): void
  (e: 'toggle-pin'): void
  (e: 'delete'): void
  (e: 'update:renameDraft', v: string): void
  (e: 'rename-save'): void
  (e: 'rename-cancel'): void
  (e: 'update:sessionActionMenuQuery', v: string): void
}>()

const hasSessionContext = computed(() => Boolean(props.session && props.directory))
const hasSession = computed(() => Boolean(props.session))
const rowRootEl = ref<HTMLElement | null>(null)

const statusLabelText = computed(() => {
  const next = String(props.statusLabel || '').trim()
  return next.length > 0 ? next : String(t('chat.sidebar.sessionRow.status.idle'))
})

const canShowActions = computed(() => props.actionsEnabled && hasSessionContext.value)
const renameInputEl = ref<HTMLInputElement | null>(null)

const isInlineRename = computed(() => props.renaming && !props.uiIsMobile && hasSessionContext.value)
const actionsAlwaysVisible = computed(() => isInlineRename.value || (props.uiIsMobile && canShowActions.value))
const renameDraftText = computed(() => String(props.renameDraft || ''))
const canSaveRename = computed(() => !props.renameBusy && renameDraftText.value.trim().length > 0)
const actionPointerDownAtMs = ref(0)

const shouldRenderSessionActionMenu = computed(() => {
  if (isInlineRename.value) return false
  if (!props.sessionActionMenuOpen || !hasSessionContext.value) return false
  const anchor = props.sessionActionMenuAnchorEl
  if (!anchor) return true
  return Boolean(rowRootEl.value?.contains(anchor))
})

const titleText = computed(() => {
  if (!props.session) return props.sessionId
  return sessionLabel(props.session)
})

const directoryText = computed(() => {
  if (!props.directory) return ''
  return directoryEntryLabel(props.directory)
})

const directoryFallbackText = computed(() => {
  const raw = props.session?.directory
  return typeof raw === 'string' ? raw.trim() : ''
})

const updatedAt = computed(() => {
  const session = props.session as { time?: { updated?: number | string | null } } | null | undefined
  const next = Number(session?.time?.updated ?? 0)
  return Number.isFinite(next) ? next : 0
})

watch(isInlineRename, (active) => {
  if (!active) return
  void nextTick(() => {
    const input = renameInputEl.value
    if (!input) return
    input.focus()
    input.select()
  })
})

function onRenameInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('update:renameDraft', target?.value || '')
}

function onActionMenuSelect(item: SessionActionItem) {
  if (!props.runSessionActionMenu) return
  void props.runSessionActionMenu(item)
}

function setMenuRef(el: Element | ComponentPublicInstance | null) {
  if (!props.setSessionActionMenuRef) return
  props.setSessionActionMenuRef(el)
}

function markActionPointerDown() {
  actionPointerDownAtMs.value = Date.now()
}

function handleMobileOpenActionsClick(event: MouseEvent) {
  if (!shouldAcceptSessionActionTap(event, actionPointerDownAtMs.value)) return
  emit('open-actions')
}

function handleDesktopOpenActionMenu(event: MouseEvent) {
  if (!shouldAcceptSessionActionTap(event, actionPointerDownAtMs.value)) return
  emit('open-action-menu', event)
}
</script>

<template>
  <div ref="rowRootEl" class="group relative">
    <SidebarListItem
      :active="selected"
      :indent="indentPx"
      :as="isInlineRename ? 'div' : 'button'"
      :actions-always-visible="actionsAlwaysVisible"
      class="gap-2 relative"
      :class="highlighted ? 'ring-2 ring-primary/40 ring-inset' : ''"
      @click="!isInlineRename && emit('open')"
    >
      <template #icon>
        <div class="flex items-center gap-1.5 min-w-0">
          <span
            v-if="isParent"
            role="button"
            class="h-3.5 w-3.5 flex-shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6 cursor-pointer active:scale-95 transition"
            :aria-label="
              String(
                t(
                  isExpanded
                    ? 'chat.sidebar.sessionRow.threadToggle.collapse'
                    : 'chat.sidebar.sessionRow.threadToggle.expand',
                ),
              )
            "
            @click.stop="emit('toggle-thread')"
          >
            <RiArrowDownSLine v-if="isExpanded" class="h-3 w-3" />
            <RiArrowRightSLine v-else class="h-3 w-3" />
          </span>
          <span v-else-if="showThreadPlaceholder" class="inline-flex h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />

          <span
            v-if="statusDotClass"
            class="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0"
            :class="statusDotClass"
            :title="statusLabelText"
            :aria-label="statusLabelText"
          />
        </div>
      </template>

      <div class="flex w-full items-center min-w-0 gap-2">
        <template v-if="!isInlineRename">
          <div v-if="hasSession" class="flex-1 min-w-0 flex flex-col justify-center">
            <span class="truncate typography-ui-label w-full text-left">{{ titleText }}</span>
            <span
              v-if="showDirectory && (directoryText || directoryFallbackText)"
              class="truncate text-[10px] text-muted-foreground/70 w-full text-left"
              >{{ directoryText || directoryFallbackText }}</span
            >
          </div>

          <div v-else class="flex-1 min-w-0 flex flex-col justify-center">
            <div
              class="h-3 w-36 rounded bg-muted/30 animate-pulse"
              :aria-label="String(t('chat.sidebar.sessionRow.loading.session'))"
            />
            <div
              v-if="showDirectory"
              class="mt-1 h-2.5 w-24 rounded bg-muted/20 animate-pulse"
              :aria-label="String(t('chat.sidebar.sessionRow.loading.directory'))"
            />
          </div>

          <!-- Attention Icons -->
          <span
            v-if="attention === 'permission'"
            class="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive shrink-0"
            :title="String(t('chat.attention.title.permissionRequired'))"
          >
            <RiShieldLine class="h-3 w-3" />
          </span>
          <span
            v-else-if="attention === 'question'"
            class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400 shrink-0"
            :title="String(t('chat.sidebar.sessionRow.attention.questionAsked'))"
          >
            <RiQuestionLine class="h-3 w-3" />
          </span>

          <!-- Time -->
          <span
            v-if="showTime && hasSessionContext"
            class="ml-auto font-mono text-[10px] text-muted-foreground/60 flex-shrink-0"
          >
            {{ formatTime(updatedAt) }}
          </span>
        </template>

        <template v-else>
          <input
            ref="renameInputEl"
            type="text"
            :value="renameDraftText"
            class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/95 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            :placeholder="String(t('chat.sidebar.sessionRow.placeholders.sessionTitle'))"
            @click.stop
            @input="onRenameInput"
            @keydown.enter.prevent.stop="emit('rename-save')"
            @keydown.esc.prevent.stop="emit('rename-cancel')"
          />
        </template>
      </div>

      <template #actions>
        <template v-if="isInlineRename">
          <IconButton
            size="xs"
            class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
            :title="String(t('chat.sidebar.sessionRow.rename.cancel'))"
            :aria-label="String(t('chat.sidebar.sessionRow.rename.cancel'))"
            :disabled="renameBusy"
            @click.stop="emit('rename-cancel')"
          >
            <RiCloseLine class="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            size="xs"
            class="text-primary hover:bg-primary/12"
            :title="
              String(t(renameBusy ? 'chat.sidebar.sessionRow.rename.saving' : 'chat.sidebar.sessionRow.rename.save'))
            "
            :aria-label="
              String(t(renameBusy ? 'chat.sidebar.sessionRow.rename.saving' : 'chat.sidebar.sessionRow.rename.save'))
            "
            :disabled="!canSaveRename"
            @click.stop="emit('rename-save')"
          >
            <RiLoader4Line v-if="renameBusy" class="h-3.5 w-3.5 animate-spin" />
            <RiCheckLine v-else class="h-3.5 w-3.5" />
          </IconButton>
        </template>

        <template v-else-if="uiIsMobile && canShowActions">
          <IconButton
            size="sm"
            class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
            :title="String(t('chat.sidebar.sessionActions.menuTitle'))"
            :aria-label="String(t('chat.sidebar.sessionActions.menuTitle'))"
            @pointerdown="markActionPointerDown"
            @click.stop="handleMobileOpenActionsClick"
          >
            <RiMore2Line class="h-4 w-4" />
          </IconButton>
        </template>

        <template v-else-if="canShowActions">
          <IconButton
            size="xs"
            class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
            :title="String(t('chat.sidebar.sessionActions.menuTitle'))"
            :aria-label="String(t('chat.sidebar.sessionActions.menuTitle'))"
            @pointerdown="markActionPointerDown"
            @click.stop="handleDesktopOpenActionMenu"
          >
            <RiMore2Line class="h-4 w-4" />
          </IconButton>

          <IconButton
            v-if="canPin"
            size="xs"
            class="hover:dark:bg-accent/40 hover:bg-primary/6"
            :class="pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'"
            :title="
              String(t(pinned ? 'chat.sidebar.sessionActions.unpin.label' : 'chat.sidebar.sessionActions.pin.label'))
            "
            :aria-label="
              String(t(pinned ? 'chat.sidebar.sessionActions.unpin.label' : 'chat.sidebar.sessionActions.pin.label'))
            "
            @click.stop="emit('toggle-pin')"
          >
            <component :is="pinned ? RiStarFill : RiStarLine" class="h-4 w-4" />
          </IconButton>

          <ConfirmPopover
            v-if="canDelete"
            :title="String(t('chat.sidebar.sessionActions.delete.confirmTitle'))"
            :description="String(t('chat.sidebar.sessionActions.delete.confirmDescription'))"
            :confirm-text="String(t('chat.sidebar.sessionActions.delete.confirmText'))"
            :cancel-text="String(t('common.cancel'))"
            variant="destructive"
            @confirm="emit('delete')"
          >
            <IconButton
              size="xs"
              class="text-muted-foreground hover:text-destructive hover:dark:bg-accent/40 hover:bg-primary/6"
              :title="String(t('chat.sidebar.sessionActions.delete.label'))"
              :aria-label="String(t('chat.sidebar.sessionActions.delete.label'))"
              @click.stop
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </IconButton>
          </ConfirmPopover>
        </template>
      </template>
    </SidebarListItem>

    <SidebarSessionActionMenu
      v-if="shouldRenderSessionActionMenu"
      :open="true"
      :query="sessionActionMenuQuery"
      :items="filteredSessionActionItems"
      :set-menu-ref="setMenuRef"
      :anchor-el="sessionActionMenuAnchorEl"
      :desktop-placement="menuPlacement"
      @update:query="(v) => emit('update:sessionActionMenuQuery', v)"
      @select="onActionMenuSelect"
    />
  </div>
</template>
