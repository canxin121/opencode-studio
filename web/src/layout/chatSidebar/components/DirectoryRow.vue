<script setup lang="ts">
import { computed } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiListCheck3,
  RiRefreshLine,
} from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ListItemSelectionIndicator from '@/components/ui/ListItemSelectionIndicator.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import { directoryEntryLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'

const props = withDefaults(
  defineProps<{
    directory: DirectoryEntry
    uiIsCompactLayout: boolean
    collapsed?: boolean
    focused?: boolean
    multiSelectEnabled?: boolean
    multiSelected?: boolean
    sessionMultiSelectEnabled?: boolean
    activityState?: 'running' | 'blocked' | 'mixed' | null
    loading?: boolean
    creatingSession?: boolean
  }>(),
  {
    collapsed: false,
    focused: false,
    multiSelectEnabled: false,
    multiSelected: false,
    sessionMultiSelectEnabled: false,
    activityState: null,
    loading: false,
    creatingSession: false,
  },
)

const emit = defineEmits<{
  (e: 'toggle-collapse'): void
  (e: 'row-click', event: MouseEvent): void
  (e: 'toggle-session-multi-select'): void
  (e: 'open-actions'): void
  (e: 'refresh'): void
  (e: 'new-session'): void
  (e: 'remove'): void
}>()

const { t } = useI18n()

const actionsAlwaysVisible = computed(() => props.uiIsCompactLayout)
const rowActive = computed(() => (props.multiSelectEnabled ? props.multiSelected : props.focused))
const sessionMultiSelectTooltip = computed(() =>
  String(
    t(
      props.sessionMultiSelectEnabled
        ? 'chat.sidebar.multiSelect.actions.exitSessionMultiSelect'
        : 'chat.sidebar.multiSelect.actions.enterSessionMultiSelect',
    ),
  ),
)

const activityTitle = computed(() => {
  if (props.activityState === 'running') {
    return String(t('chat.sidebar.directoriesList.activity.runningTooltip'))
  }
  if (props.activityState === 'blocked') {
    return String(t('chat.sidebar.directoriesList.activity.blockedTooltip'))
  }
  if (props.activityState === 'mixed') {
    return String(t('chat.sidebar.directoriesList.activity.mixedTooltip'))
  }
  return ''
})

const activityDotClass = computed(() => {
  if (props.activityState === 'running') {
    return 'bg-primary animate-pulse'
  }
  if (props.activityState === 'blocked') {
    return 'bg-destructive'
  }
  if (props.activityState === 'mixed') {
    return 'bg-destructive animate-pulse ring-1 ring-primary/40 ring-offset-1 ring-offset-sidebar'
  }
  return ''
})

function handleMobileOpenActionsClick() {
  emit('open-actions')
}
</script>

<template>
  <SidebarListItem
    :active="rowActive"
    :actions-always-visible="actionsAlwaysVisible"
    class="relative gap-1.5"
    @click="emit('row-click', $event)"
  >
    <template #icon>
      <ListItemSelectionIndicator v-if="multiSelectEnabled" :selected="multiSelected" />
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

    <div class="flex min-w-0 flex-col justify-center gap-0.5 py-px">
      <div
        class="typography-ui-label min-w-0 pb-px text-left leading-[1.4]"
        :class="focused ? 'text-primary' : 'text-foreground'"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1 truncate">{{ directoryEntryLabel(directory) }}</div>
          <span
            v-if="activityState"
            class="inline-flex items-center flex-shrink-0"
            :title="activityTitle"
            :aria-label="activityTitle"
          >
            <span class="inline-flex h-1.5 w-1.5 rounded-full" :class="activityDotClass" />
            <span class="sr-only">{{ activityTitle }}</span>
          </span>
        </div>
      </div>
      <div class="typography-micro min-w-0 truncate pb-px font-mono text-left leading-tight text-muted-foreground/60">
        {{ directory.path }}
      </div>
    </div>

    <template #actions>
      <template v-if="multiSelectEnabled" />
      <template v-else-if="uiIsCompactLayout">
        <ListItemOverflowActionButton
          mobile
          :label="String(t('chat.sidebar.directoriesList.directoryActions'))"
          @trigger="handleMobileOpenActionsClick"
        />
      </template>

      <template v-else>
        <IconButton
          size="xs"
          :class="
            props.sessionMultiSelectEnabled
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6'
          "
          :title="sessionMultiSelectTooltip"
          :aria-label="sessionMultiSelectTooltip"
          @click.stop="emit('toggle-session-multi-select')"
        >
          <RiListCheck3 class="h-4 w-4" />
        </IconButton>

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
