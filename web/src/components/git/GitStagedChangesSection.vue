<script setup lang="ts">
import { RiDeleteBinLine, RiHistoryLine, RiPencilLine, RiSubtractLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import type { OptionMenuItem } from '@/components/ui/optionMenu.types'
import GitStatusListItem from '@/components/git/GitStatusListItem.vue'

import type { GitStatusFile } from '@/types/git'

const { t } = useI18n()

type DiffSource = 'working' | 'staged'

const props = defineProps<{
  expanded: boolean
  count: number
  files: GitStatusFile[]
  selectedFile: string | null
  diffSource: DiffSource
  hasMore: boolean
  loading: boolean
  isMobilePointer: boolean
}>()

const emit = defineEmits<{
  (e: 'update:expanded', value: boolean): void
  (e: 'select', path: string): void
  (e: 'unstageAll'): void
  (e: 'unstage', path: string): void
  (e: 'history', path: string): void
  (e: 'rename', path: string): void
  (e: 'delete', path: string): void
  (e: 'showMore'): void
}>()

function toggle() {
  emit('update:expanded', !props.expanded)
}

function statusClass(code: string): string {
  const lead = (code || '').trim().charAt(0).toUpperCase()
  if (lead === 'A' || lead === 'C') return 'oc-vscode-status-added'
  if (lead === 'D') return 'oc-vscode-status-deleted'
  if (lead === 'M' || lead === 'R' || lead === 'T') return 'oc-vscode-status-modified'
  if (lead === 'U' || lead === '?') return 'oc-vscode-status-untracked'
  return 'text-muted-foreground'
}

function mobileActionsForFile(path: string): OptionMenuItem[] {
  return [
    {
      id: 'unstage',
      label: t('git.ui.workingTree.actions.unstage'),
      icon: RiSubtractLine,
      description: path,
      monospace: true,
    },
    {
      id: 'history',
      label: t('git.ui.workingTree.actions.history'),
      icon: RiHistoryLine,
      description: path,
      monospace: true,
    },
    {
      id: 'rename',
      label: t('common.rename'),
      icon: RiPencilLine,
      description: path,
      monospace: true,
    },
    {
      id: 'delete',
      label: t('common.delete'),
      icon: RiDeleteBinLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: t('git.ui.workingTree.confirmDeleteTracked.title'),
      confirmDescription: t('git.ui.workingTree.confirmDeleteTracked.description'),
      confirmText: t('git.ui.workingTree.actions.deleteFile'),
      cancelText: t('common.cancel'),
    },
  ]
}

function runMobileAction(path: string, actionId: string) {
  if (actionId === 'unstage') {
    emit('unstage', path)
    return
  }
  if (actionId === 'history') {
    emit('history', path)
    return
  }
  if (actionId === 'rename') {
    emit('rename', path)
    return
  }
  if (actionId === 'delete') {
    emit('delete', path)
  }
}
</script>

<template>
  <div class="oc-vscode-section select-none">
    <SectionToggleButton
      :open="expanded"
      :label="t('git.ui.workingTree.sections.stagedChanges')"
      :count="count"
      @toggle="toggle"
    >
      <template #actions>
        <SidebarIconButton
          size="sm"
          :tooltip="t('git.ui.workingTree.actions.unstageAll')"
          :is-mobile-pointer="isMobilePointer"
          :aria-label="t('git.ui.workingTree.actions.unstageAll')"
          @click.stop="$emit('unstageAll')"
        >
          <RiSubtractLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
      </template>
    </SectionToggleButton>

    <div v-if="expanded" class="space-y-0.5 px-1 pb-1">
      <GitStatusListItem
        v-for="f in files"
        :key="f.path"
        :path="f.path"
        :active="selectedFile === f.path && diffSource === 'staged'"
        :status-label="(f.index || '').trim() || 'M'"
        :status-class="statusClass(f.index || '')"
        :insertions="f.insertions ?? 0"
        :deletions="f.deletions ?? 0"
        :is-mobile-pointer="isMobilePointer"
        :mobile-action-items="mobileActionsForFile(f.path)"
        :mobile-action-title="t('git.ui.workingTree.fileActionsTitle')"
        @select="$emit('select', f.path)"
        @mobileAction="(id) => runMobileAction(f.path, id)"
      >
        <template #actions>
          <SidebarIconButton
            size="sm"
            :tooltip="t('git.ui.workingTree.actions.unstage')"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="t('git.ui.workingTree.actions.unstage')"
            @click.stop="$emit('unstage', f.path)"
          >
            <RiSubtractLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :tooltip="t('git.ui.workingTree.actions.history')"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="t('git.ui.workingTree.actions.history')"
            @click.stop="$emit('history', f.path)"
          >
            <RiHistoryLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :tooltip="t('common.rename')"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="t('common.rename')"
            @click.stop="$emit('rename', f.path)"
          >
            <RiPencilLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <ConfirmPopover
            :title="t('git.ui.workingTree.confirmDeleteTracked.title')"
            :description="t('git.ui.workingTree.confirmDeleteTracked.description')"
            :confirm-text="t('git.ui.workingTree.actions.deleteFile')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="$emit('delete', f.path)"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :tooltip="t('common.delete')"
              :is-mobile-pointer="isMobilePointer"
              :aria-label="t('common.delete')"
              @click.stop
            >
              <RiDeleteBinLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>
        </template>
      </GitStatusListItem>

      <button
        v-if="hasMore"
        type="button"
        class="ml-5 rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
        :disabled="loading"
        @click="$emit('showMore')"
      >
        {{ t('git.ui.workingTree.showMoreCount', { shown: files.length, total: count }) }}
      </button>
    </div>
  </div>
</template>
