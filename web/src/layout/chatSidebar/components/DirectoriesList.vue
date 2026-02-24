<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiMore2Line,
  RiRefreshLine,
} from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SidebarTextButton from '@/components/ui/SidebarTextButton.vue'
import { directoryEntryLabel, sessionLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import type { FlatTreeRow } from '@/features/sessions/model/tree'
import type { SessionActionItem } from '@/layout/chatSidebar/useSessionActionMenu'
import type { JsonValue } from '@/types/json'
import SidebarPager from '@/layout/chatSidebar/components/SidebarPager.vue'
import SessionRow from '@/layout/chatSidebar/components/SessionRow.vue'

type SessionLike = {
  id: string
  title?: string
  slug?: string
  directory?: string
  time?: { updated?: number | null } | null
  [k: string]: JsonValue
}

type SessionSearchHit = {
  directory: DirectoryEntry
  session: {
    id?: string | number | null
    title?: string | null
    slug?: string | null
    [k: string]: JsonValue
  }
}

type ThreadSessionRow = {
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
  uiIsMobile: boolean
  directories: DirectoryEntry[]
  pagedDirectories: DirectoryEntry[]
  visibleDirectories: DirectoryEntry[]
  sidebarQueryNorm: string
  searchWarming: boolean
  sessionSearchHits: SessionSearchHit[]
  locateFromSearch: (hit: SessionSearchHit) => Promise<void>

  locatedSessionId: string
  setSessionEl: (sessionId: string, el: MenuRefEl) => void

  pinnedSessionIds: string[]
  chatSelectedSessionId: string | null

  creatingSession: boolean

  aggregateLoadingByDirectoryId: Record<string, boolean>
  aggregateAttemptedByDirectoryId: Record<string, boolean>
  hasCachedSessionsForDirectory: (directoryId: string) => boolean

  isDirectoryCollapsed: (directoryId: string) => boolean
  toggleDirectoryCollapse: (directoryId: string, directoryPath: string) => void
  isDirectoryFocused: (directory: DirectoryEntry) => boolean
  directoryHasActiveOrBlocked: (directory: DirectoryEntry) => boolean

  openDirectoryActions: (directory: DirectoryEntry) => void
  refreshDirectoryInline: (directory: DirectoryEntry) => Promise<void>
  newSessionInline: (directory: DirectoryEntry) => Promise<void>
  removeDirectoryInline: (directory: DirectoryEntry) => Promise<void>

  aggregatedSessionsForDirectory: (directoryId: string, directoryPath: string) => SessionLike[]
  selectDirectory: (directoryId: string, directoryPath: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>

  openSessionActions: (directory: DirectoryEntry, session: SessionLike) => void
  openSessionActionMenu: (directory: DirectoryEntry, session: SessionLike, event?: MouseEvent | PointerEvent) => void

  togglePin: (sessionId: string) => void
  deleteSession: (sessionId: string) => Promise<void>

  hasAttention: (sessionId: string) => 'permission' | 'question' | null
  statusLabelForSessionId: (sessionId: string) => { label: string; dotClass: string }

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

  pinnedRowsForDirectory: (directoryId: string) => ThreadSessionRow[]
  pagedRowsForDirectory: (directoryId: string) => FlatTreeRow[]
  toggleExpandedParent: (sessionId: string) => void
  sessionRootPageCount: (directoryId: string) => number
  sessionRootPage: (directoryId: string) => number
  setSessionRootPage: (directoryId: string, page: number) => void
}>()

const emit = defineEmits<{
  (e: 'update:sessionActionMenuQuery', v: string): void
}>()

const { t } = useI18n()

function sessionsForDirectory(directory: DirectoryEntry) {
  return props.aggregatedSessionsForDirectory(directory.id, directory.path)
}

function pinnedRows(directoryId: string) {
  return props.pinnedRowsForDirectory(directoryId)
}

function statusMeta(sessionId: string) {
  return props.statusLabelForSessionId(sessionId)
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
    <div class="space-y-1 pb-1 pl-2.5 pr-1">
      <div v-if="directories.length === 0" class="px-2 py-6 text-center text-muted-foreground">
        <div class="typography-ui-label font-semibold">{{ t('chat.sidebar.directoriesList.empty.title') }}</div>
        <div class="typography-meta mt-1">{{ t('chat.sidebar.directoriesList.empty.description') }}</div>
      </div>

      <div v-else>
        <div v-if="sidebarQueryNorm" class="px-1.5 pb-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {{ t('chat.sidebar.directoriesList.search.sessionsTitle') }}
            </div>
            <div v-if="searchWarming" class="text-[10px] font-mono text-muted-foreground/60">{{ t('common.loading') }}</div>
          </div>

          <div v-if="sessionSearchHits.length" class="mt-1 space-y-1">
            <SidebarTextButton
              v-for="hit in sessionSearchHits"
              :key="String(hit.session.id)"
              class="w-full rounded-md px-2 py-1.5 hover:dark:bg-accent/40 hover:bg-primary/6"
              @click="props.locateFromSearch(hit)"
            >
              <div class="typography-ui-label font-medium truncate">{{ sessionLabel(hit.session) }}</div>
              <div class="text-[10px] text-muted-foreground/70 truncate">{{ directoryEntryLabel(hit.directory) }}</div>
            </SidebarTextButton>
          </div>

          <div v-else class="mt-2 text-xs text-muted-foreground">
            <div class="font-medium">{{ t('chat.sidebar.directoriesList.search.noMatchingSessions') }}</div>
            <div v-if="searchWarming" class="mt-1 font-mono text-[10px] text-muted-foreground/60">
              {{ t('chat.sidebar.directoriesList.search.loadingDirectories') }}
            </div>
          </div>
        </div>

        <div v-if="visibleDirectories.length === 0" class="px-2 py-6 text-center text-muted-foreground">
          <div class="typography-ui-label font-semibold">{{ t('chat.sidebar.directoriesList.noMatchingDirectories.title') }}</div>
          <div class="typography-meta mt-1">{{ t('chat.sidebar.directoriesList.noMatchingDirectories.description') }}</div>
        </div>

        <div v-else class="space-y-1">
          <div v-for="directory in pagedDirectories" :key="directory.id" class="relative">
            <div
              class="sticky top-0 z-20 pt-2 pb-1.5 w-full border-b select-none bg-sidebar group"
              :class="
                props.isDirectoryCollapsed(directory.id)
                  ? 'bg-sidebar border-sidebar-border/30'
                  : 'bg-sidebar border-sidebar-border/60'
              "
            >
              <div class="flex items-center gap-1 px-1">
                <button
                  type="button"
                  class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  :aria-label=
                    "props.isDirectoryCollapsed(directory.id)
                      ? String(t('chat.sidebar.directoriesList.expandDirectory'))
                      : String(t('chat.sidebar.directoriesList.collapseDirectory'))"
                  @click="props.toggleDirectoryCollapse(directory.id, directory.path)"
                >
                  <RiArrowRightSLine v-if="props.isDirectoryCollapsed(directory.id)" class="h-4 w-4" />
                  <RiArrowDownSLine v-else class="h-4 w-4" />
                </button>

                <SidebarTextButton
                  class="flex-1 rounded-sm"
                  :title="directory.path"
                  @click="props.toggleDirectoryCollapse(directory.id, directory.path)"
                >
                  <div
                    class="typography-ui font-semibold truncate"
                    :class="props.isDirectoryFocused(directory) ? 'text-primary' : 'text-foreground'"
                  >
                    <span class="inline-flex items-center gap-2 min-w-0">
                      <span class="truncate">{{ directoryEntryLabel(directory) }}</span>
                      <span
                        v-if="props.directoryHasActiveOrBlocked(directory)"
                        class="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"
                        :title="String(t('chat.sidebar.directoriesList.activeSessions'))"
                        :aria-label="String(t('chat.sidebar.directoriesList.activeSessions'))"
                      />
                    </span>
                  </div>
                  <div class="typography-micro text-muted-foreground/60 truncate font-mono">{{ directory.path }}</div>
                </SidebarTextButton>

                <div class="flex items-center gap-1">
                  <IconButton
                    v-if="uiIsMobile"
                    size="sm"
                    class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
                    :title="String(t('chat.sidebar.directoriesList.directoryActions'))"
                    :aria-label="String(t('chat.sidebar.directoriesList.directoryActions'))"
                    @click.stop="props.openDirectoryActions(directory)"
                  >
                    <RiMore2Line class="h-4 w-4" />
                  </IconButton>

                  <div
                    v-else
                    class="flex items-center gap-1 w-0 overflow-hidden opacity-0 pointer-events-none transition-opacity group-hover:w-20 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:w-20 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                  >
                    <IconButton
                      size="xs"
                      class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
                      :title="String(t('chat.sidebar.directoryActions.refresh.label'))"
                      :aria-label="String(t('chat.sidebar.directoryActions.refresh.label'))"
                      :disabled="aggregateLoadingByDirectoryId[directory.id]"
                      @click.stop="props.refreshDirectoryInline(directory)"
                    >
                      <RiRefreshLine class="h-4 w-4" />
                    </IconButton>

                    <IconButton
                      size="xs"
                      class="text-muted-foreground hover:text-primary hover:dark:bg-accent/40 hover:bg-primary/6"
                      :title="String(t('chat.sidebar.directoryActions.newSession.label'))"
                      :aria-label="String(t('chat.sidebar.directoryActions.newSession.label'))"
                      :disabled="props.creatingSession"
                      @click.stop="props.newSessionInline(directory)"
                    >
                      <RiAddLine class="h-4 w-4" />
                    </IconButton>

                    <ConfirmPopover
                      :title="String(t('chat.sidebar.directoryActions.remove.confirmTitle'))"
                      :description="String(t('chat.sidebar.directoryActions.remove.confirmDescription'))"
                      :confirm-text="String(t('common.remove'))"
                      :cancel-text="String(t('common.cancel'))"
                      variant="destructive"
                      @confirm="props.removeDirectoryInline(directory)"
                    >
                      <IconButton
                        size="xs"
                        class="text-muted-foreground hover:text-destructive hover:dark:bg-accent/40 hover:bg-primary/6"
                        :title="String(t('chat.sidebar.directoryActions.remove.label'))"
                        :aria-label="String(t('chat.sidebar.directoryActions.remove.label'))"
                        @click.stop
                      >
                        <RiDeleteBinLine class="h-4 w-4" />
                      </IconButton>
                    </ConfirmPopover>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="!props.isDirectoryCollapsed(directory.id)" class="py-1 pl-1">
              <div class="space-y-1">
                <div
                  v-if="
                    (aggregateLoadingByDirectoryId[directory.id] || !aggregateAttemptedByDirectoryId[directory.id]) &&
                    !props.hasCachedSessionsForDirectory(directory.id)
                  "
                  class="px-1.5 py-2"
                >
                  <div class="text-xs text-muted-foreground">{{ t('chat.sidebar.directoriesList.loadingSessions') }}</div>
                  <div class="mt-2 space-y-2 animate-pulse">
                    <div class="h-3 w-3/4 rounded bg-muted/30" />
                    <div class="h-3 w-2/3 rounded bg-muted/30" />
                    <div class="h-3 w-1/2 rounded bg-muted/30" />
                  </div>
                </div>

                <div
                  v-else-if="sessionsForDirectory(directory).length === 0"
                  class="px-1.5 py-1 text-xs text-muted-foreground"
                >
                  {{ t('chat.sidebar.directoriesList.noSessionsYet') }}
                </div>

                <template v-else>
                  <div v-if="pinnedRows(directory.id).length" class="space-y-1">
                    <div class="px-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {{ t('chat.sidebar.directoriesList.pinnedTitle') }}
                    </div>

                    <div
                      v-for="row in pinnedRows(directory.id)"
                      :key="row.renderKey"
                      :ref="(el) => props.setSessionEl(row.id, el)"
                    >
                      <SessionRow
                        :session-id="row.id"
                        :session="row.session"
                        :directory="row.directory || directory"
                        :ui-is-mobile="uiIsMobile"
                        :selected="chatSelectedSessionId === row.id"
                        :highlighted="locatedSessionId === row.id"
                        :indent-px="2 + row.depth * 10"
                        :is-parent="row.isParent"
                        :is-expanded="row.isExpanded"
                        :show-thread-placeholder="true"
                        :status-label="statusMeta(row.id).label"
                        :status-dot-class="statusMeta(row.id).dotClass"
                        :attention="props.hasAttention(row.id)"
                        :pinned="props.pinnedSessionIds.includes(row.id)"
                        :actions-enabled="Boolean(row.session && row.directory)"
                        :session-action-menu-open="sessionActionMenuTarget?.session?.id === row.id"
                        :session-action-menu-anchor-el="sessionActionMenuAnchorEl"
                        :session-action-menu-query="sessionActionMenuQuery"
                        :filtered-session-action-items="filteredSessionActionItems"
                        :set-session-action-menu-ref="props.setSessionActionMenuRef"
                        :run-session-action-menu="props.runSessionActionMenu"
                        :renaming="props.isSessionRenaming(row.id)"
                        :rename-draft="props.renameDraft"
                        :rename-busy="props.renameBusy"
                        @open="
                          async () => {
                            await props.selectDirectory(directory.id, directory.path)
                            await props.selectSession(row.id)
                          }
                        "
                        @toggle-thread="props.toggleExpandedParent(row.id)"
                        @open-actions="
                          row.session && row.directory
                            ? props.openSessionActions(row.directory, row.session)
                            : undefined
                        "
                        @open-action-menu="
                          (event) =>
                            row.session && row.directory
                              ? props.openSessionActionMenu(row.directory, row.session, event)
                              : undefined
                        "
                        @toggle-pin="props.togglePin(row.id)"
                        @delete="props.deleteSession(row.id)"
                        @update:renameDraft="props.updateRenameDraft"
                        @rename-save="props.saveRename"
                        @rename-cancel="props.cancelRename"
                        @update:sessionActionMenuQuery="(v) => emit('update:sessionActionMenuQuery', v)"
                      />
                    </div>
                  </div>

                  <div class="space-y-1">
                    <div class="px-1.5 flex items-center justify-between gap-2">
                      <div class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        {{ t('chat.sidebar.directoriesList.recentTitle') }}
                      </div>
                      <SidebarPager
                        v-if="props.sessionRootPageCount(directory.id) > 1"
                        :page="props.sessionRootPage(directory.id)"
                        :page-count="props.sessionRootPageCount(directory.id)"
                        :disabled="Boolean(aggregateLoadingByDirectoryId[directory.id])"
                        :prev-label="String(t('chat.sidebar.directoriesList.prevSessionsPage'))"
                        :next-label="String(t('chat.sidebar.directoriesList.nextSessionsPage'))"
                        @update:page="(next) => props.setSessionRootPage(directory.id, next)"
                      />
                    </div>

                    <div
                      v-for="row in props.pagedRowsForDirectory(directory.id)"
                      :key="row.id"
                      :ref="(el) => props.setSessionEl(row.id, el)"
                    >
                      <SessionRow
                        :session-id="row.id"
                        :session="row.session"
                        :directory="directory"
                        :ui-is-mobile="uiIsMobile"
                        :selected="chatSelectedSessionId === row.id"
                        :highlighted="locatedSessionId === row.id"
                        :indent-px="2 + row.depth * 10"
                        :is-parent="row.isParent"
                        :is-expanded="row.isExpanded"
                        :show-thread-placeholder="true"
                        :status-label="statusMeta(row.id).label"
                        :status-dot-class="statusMeta(row.id).dotClass"
                        :attention="props.hasAttention(row.id)"
                        :pinned="props.pinnedSessionIds.includes(row.id)"
                        :session-action-menu-open="sessionActionMenuTarget?.session?.id === row.session.id"
                        :session-action-menu-anchor-el="sessionActionMenuAnchorEl"
                        :session-action-menu-query="sessionActionMenuQuery"
                        :filtered-session-action-items="filteredSessionActionItems"
                        :set-session-action-menu-ref="props.setSessionActionMenuRef"
                        :run-session-action-menu="props.runSessionActionMenu"
                        :renaming="props.isSessionRenaming(row.id)"
                        :rename-draft="props.renameDraft"
                        :rename-busy="props.renameBusy"
                        @open="
                          async () => {
                            await props.selectDirectory(directory.id, directory.path)
                            await props.selectSession(row.id)
                          }
                        "
                        @toggle-thread="props.toggleExpandedParent(row.id)"
                        @open-actions="props.openSessionActions(directory, row.session)"
                        @open-action-menu="(event) => props.openSessionActionMenu(directory, row.session, event)"
                        @toggle-pin="props.togglePin(row.id)"
                        @delete="props.deleteSession(row.id)"
                        @update:renameDraft="props.updateRenameDraft"
                        @rename-save="props.saveRename"
                        @rename-cancel="props.cancelRename"
                        @update:sessionActionMenuQuery="(v) => emit('update:sessionActionMenuQuery', v)"
                      />
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
