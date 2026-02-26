<script setup lang="ts">
import { computed, ref } from 'vue'
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
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import { directoryEntryLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { shouldAcceptSessionActionTap } from '@/layout/chatSidebar/sessionActionTapGuard'

const props = withDefaults(
  defineProps<{
    directory: DirectoryEntry
    uiIsMobile: boolean
    collapsed?: boolean
    focused?: boolean
    hasActiveOrBlocked?: boolean
    loading?: boolean
    creatingSession?: boolean
  }>(),
  {
    collapsed: false,
    focused: false,
    hasActiveOrBlocked: false,
    loading: false,
    creatingSession: false,
  },
)

const emit = defineEmits<{
  (e: 'toggle-collapse'): void
  (e: 'open-actions'): void
  (e: 'refresh'): void
  (e: 'new-session'): void
  (e: 'remove'): void
}>()

const { t } = useI18n()

const actionsAlwaysVisible = computed(() => props.uiIsMobile)
const actionPointerDownAtMs = ref(0)

function markActionPointerDown() {
  actionPointerDownAtMs.value = Date.now()
}

function handleMobileOpenActionsClick(event: MouseEvent) {
  if (!shouldAcceptSessionActionTap(event, actionPointerDownAtMs.value)) return
  emit('open-actions')
}
</script>

<template>
  <SidebarListItem
    :active="focused"
    :actions-always-visible="actionsAlwaysVisible"
    class="relative gap-1.5"
    @click="emit('toggle-collapse')"
  >
    <template #icon>
      <span
        role="button"
        class="h-3.5 w-3.5 flex-shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6 cursor-pointer active:scale-95 transition"
        :aria-label="
          collapsed
            ? String(t('chat.sidebar.directoriesList.expandDirectory'))
            : String(t('chat.sidebar.directoriesList.collapseDirectory'))
        "
        @click.stop="emit('toggle-collapse')"
      >
        <RiArrowRightSLine v-if="collapsed" class="h-3 w-3" />
        <RiArrowDownSLine v-else class="h-3 w-3" />
      </span>
    </template>

    <div class="flex min-w-0 flex-col justify-center">
      <span
        class="typography-ui-label truncate text-left leading-tight"
        :class="focused ? 'text-primary' : 'text-foreground'"
      >
        <span class="inline-flex items-center gap-2 min-w-0">
          <span class="truncate">{{ directoryEntryLabel(directory) }}</span>
          <span
            v-if="hasActiveOrBlocked"
            class="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"
            :title="String(t('chat.sidebar.directoriesList.activeSessions'))"
            :aria-label="String(t('chat.sidebar.directoriesList.activeSessions'))"
          />
        </span>
      </span>
      <span class="typography-micro truncate font-mono text-left leading-tight text-muted-foreground/60">{{
        directory.path
      }}</span>
    </div>

    <template #actions>
      <template v-if="uiIsMobile">
        <IconButton
          size="sm"
          class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
          :title="String(t('chat.sidebar.directoriesList.directoryActions'))"
          :aria-label="String(t('chat.sidebar.directoriesList.directoryActions'))"
          @pointerdown="markActionPointerDown"
          @click.stop="handleMobileOpenActionsClick"
        >
          <RiMore2Line class="h-4 w-4" />
        </IconButton>
      </template>

      <template v-else>
        <IconButton
          size="xs"
          class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
          :title="String(t('chat.sidebar.directoryActions.refresh.label'))"
          :aria-label="String(t('chat.sidebar.directoryActions.refresh.label'))"
          :disabled="loading"
          @click.stop="emit('refresh')"
        >
          <RiRefreshLine class="h-4 w-4" />
        </IconButton>

        <IconButton
          size="xs"
          class="text-muted-foreground hover:text-primary hover:dark:bg-accent/40 hover:bg-primary/6"
          :title="String(t('chat.sidebar.directoryActions.newSession.label'))"
          :aria-label="String(t('chat.sidebar.directoryActions.newSession.label'))"
          :disabled="creatingSession"
          @click.stop="emit('new-session')"
        >
          <RiAddLine class="h-4 w-4" />
        </IconButton>

        <ConfirmPopover
          :title="String(t('chat.sidebar.directoryActions.remove.confirmTitle'))"
          :description="String(t('chat.sidebar.directoryActions.remove.confirmDescription'))"
          :confirm-text="String(t('common.remove'))"
          :cancel-text="String(t('common.cancel'))"
          variant="destructive"
          @confirm="emit('remove')"
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
      </template>
    </template>
  </SidebarListItem>
</template>
