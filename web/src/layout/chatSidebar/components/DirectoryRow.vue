<script setup lang="ts">
import { computed } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiDeleteBinLine, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import { directoryEntryLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'

const props = withDefaults(
  defineProps<{
    directory: DirectoryEntry
    uiIsMobile: boolean
    collapsed?: boolean
    focused?: boolean
    activityState?: 'running' | 'blocked' | 'mixed' | null
    loading?: boolean
    creatingSession?: boolean
  }>(),
  {
    collapsed: false,
    focused: false,
    activityState: null,
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

const activityLabel = computed(() => {
  if (props.activityState === 'running') {
    return String(t('chat.sidebar.directoriesList.activity.running'))
  }
  if (props.activityState === 'blocked') {
    return String(t('chat.sidebar.directoriesList.activity.blocked'))
  }
  if (props.activityState === 'mixed') {
    return String(t('chat.sidebar.directoriesList.activity.mixed'))
  }
  return ''
})

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

const activityBadgeClass = computed(() => {
  if (props.activityState === 'running') {
    return 'bg-primary/10 text-primary'
  }
  if (props.activityState === 'blocked') {
    return 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
  }
  if (props.activityState === 'mixed') {
    return 'bg-orange-500/12 text-orange-700 dark:text-orange-400'
  }
  return ''
})

const activityDotClass = computed(() => {
  if (props.activityState === 'running') {
    return 'bg-primary animate-pulse'
  }
  if (props.activityState === 'blocked') {
    return 'bg-amber-500'
  }
  if (props.activityState === 'mixed') {
    return 'bg-orange-500 animate-pulse'
  }
  return ''
})

function handleMobileOpenActionsClick() {
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

    <div class="flex min-w-0 flex-col justify-center gap-0.5 py-px">
      <div
        class="typography-ui-label min-w-0 pb-px text-left leading-[1.4]"
        :class="focused ? 'text-primary' : 'text-foreground'"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1 truncate">{{ directoryEntryLabel(directory) }}</div>
          <span
            v-if="activityState"
            class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0"
            :class="activityBadgeClass"
            :title="activityTitle"
            :aria-label="activityTitle"
          >
            <span class="inline-flex h-1.5 w-1.5 rounded-full" :class="activityDotClass" />
            <span class="max-w-[6rem] truncate">{{ activityLabel }}</span>
          </span>
        </div>
      </div>
      <div class="typography-micro min-w-0 truncate pb-px font-mono text-left leading-tight text-muted-foreground/60">
        {{ directory.path }}
      </div>
    </div>

    <template #actions>
      <template v-if="uiIsMobile">
        <ListItemOverflowActionButton
          mobile
          :label="String(t('chat.sidebar.directoriesList.directoryActions'))"
          @trigger="handleMobileOpenActionsClick"
        />
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
