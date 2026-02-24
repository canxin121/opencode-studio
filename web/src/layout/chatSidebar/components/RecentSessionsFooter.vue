<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import type { DirectoryEntry } from '@/features/sessions/model/types'
import type { SessionActionItem } from '@/layout/chatSidebar/useSessionActionMenu'
import type { JsonValue } from '@/types/json'
import SidebarPager from '@/layout/chatSidebar/components/SidebarPager.vue'
import SessionRow from '@/layout/chatSidebar/components/SessionRow.vue'

const { t } = useI18n()

type SessionLike = {
  id: string
  title?: string
  slug?: string
  directory?: string
  time?: { updated?: number | null } | null
  [k: string]: JsonValue
}

type RecentSessionRow = {
  id: string
  session: SessionLike | null
  directory: DirectoryEntry | null
  renderKey: string
  depth: number
  isParent: boolean
  isExpanded: boolean
}

type SessionMenuTarget = { directory: DirectoryEntry; session: SessionLike }
type MenuRefEl = Element | ComponentPublicInstance | null

const props = defineProps<{
  open: boolean
  page: number
  paging?: boolean
  recentSessionsPageCount: number
  recentSessionsTotal: number
  recentSessionRows: RecentSessionRow[]
  selectedSessionId: string | null

  uiIsMobile: boolean
  pinnedSessionIds: string[]
  hasAttention: (sessionId: string) => 'permission' | 'question' | null
  statusLabelForSessionId: (sessionId: string) => { label: string; dotClass: string }

  openSessionActions: (directory: DirectoryEntry, session: SessionLike) => void
  openSessionActionMenu: (directory: DirectoryEntry, session: SessionLike, event?: MouseEvent | PointerEvent) => void
  togglePin: (sessionId: string) => void
  deleteSession: (sessionId: string) => Promise<void>

  sessionActionMenuTarget: SessionMenuTarget | null
  sessionActionMenuAnchorEl: HTMLElement | null
  sessionActionMenuQuery: string
  filteredSessionActionItems: SessionActionItem[]
  setSessionActionMenuRef: (el: MenuRefEl) => void
  runSessionActionMenu: (item: SessionActionItem) => Promise<void>

  isSessionRenaming: (sessionId: string) => boolean
  renameDraft: string
  renameBusy: boolean
  updateRenameDraft: (value: string) => void
  saveRename: () => Promise<void> | void
  cancelRename: () => void
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:page', v: number): void
  (e: 'open-session', sessionId: string): void
  (e: 'toggle-thread', sessionId: string): void
  (e: 'update:sessionActionMenuQuery', v: string): void
}>()

const count = computed(() => Math.max(0, Math.floor(props.recentSessionsTotal || 0)))

function isPinned(sessionId: string) {
  return props.pinnedSessionIds.includes(sessionId)
}

function statusMeta(sessionId: string) {
  return props.statusLabelForSessionId(sessionId)
}
</script>

<template>
  <div class="flex-shrink-0 border-t border-sidebar-border/60 bg-sidebar/95">
    <div class="h-10 px-3 flex items-center justify-between gap-2">
      <button
        type="button"
        class="flex-1 h-full min-w-0 flex items-center gap-2 text-left hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        :aria-expanded="open"
        :aria-label="String(t('chat.sidebar.footers.recent.toggleAria'))"
        @click="emit('update:open', !open)"
      >
        <component :is="open ? RiArrowDownSLine : RiArrowRightSLine" class="h-4 w-4 text-muted-foreground" />
        <span class="typography-ui-label font-medium text-muted-foreground">{{
          t('chat.sidebar.footers.recent.title')
        }}</span>
      </button>
      <div class="flex items-center gap-2 flex-shrink-0">
        <span class="text-[11px] font-mono text-muted-foreground/70">{{ count }}</span>
        <SidebarPager
          v-if="open && recentSessionsPageCount > 1"
          :page="page"
          :page-count="recentSessionsPageCount"
          :disabled="Boolean(paging)"
          :prev-label="String(t('chat.sidebar.footers.recent.prevPage'))"
          :next-label="String(t('chat.sidebar.footers.recent.nextPage'))"
          @update:page="(v) => emit('update:page', v)"
        />
      </div>
    </div>

    <div v-if="open" class="px-2 pb-2">
      <div v-if="count === 0" class="px-2 py-2 text-xs text-muted-foreground">
        {{ t('chat.sidebar.footers.recent.empty') }}
      </div>
      <div v-else class="space-y-1">
        <SessionRow
          v-for="item in recentSessionRows"
          :key="item.renderKey"
          :session-id="item.id"
          :session="item.session"
          :directory="item.directory"
          :ui-is-mobile="uiIsMobile"
          :selected="selectedSessionId === item.id"
          :indent-px="2 + item.depth * 10"
          :is-parent="item.isParent"
          :is-expanded="item.isExpanded"
          :show-thread-placeholder="true"
          :show-directory="true"
          :status-label="statusMeta(item.id).label"
          :status-dot-class="statusMeta(item.id).dotClass"
          :attention="hasAttention(item.id)"
          :pinned="isPinned(item.id)"
          :actions-enabled="Boolean(item.session && item.directory)"
          :session-action-menu-open="sessionActionMenuTarget?.session?.id === item.id"
          :session-action-menu-anchor-el="sessionActionMenuAnchorEl"
          :session-action-menu-query="sessionActionMenuQuery"
          :filtered-session-action-items="filteredSessionActionItems"
          :set-session-action-menu-ref="setSessionActionMenuRef"
          :run-session-action-menu="runSessionActionMenu"
          :renaming="isSessionRenaming(item.id)"
          :rename-draft="renameDraft"
          :rename-busy="renameBusy"
          menu-placement="top-end"
          @open="emit('open-session', item.id)"
          @toggle-thread="emit('toggle-thread', item.id)"
          @open-actions="item.session && item.directory ? openSessionActions(item.directory, item.session) : undefined"
          @open-action-menu="
            (event) =>
              item.session && item.directory ? openSessionActionMenu(item.directory, item.session, event) : undefined
          "
          @toggle-pin="togglePin(item.id)"
          @delete="deleteSession(item.id)"
          @update:renameDraft="updateRenameDraft"
          @rename-save="saveRename"
          @rename-cancel="cancelRename"
          @update:sessionActionMenuQuery="(v) => emit('update:sessionActionMenuQuery', v)"
        />
      </div>
    </div>
  </div>
</template>
