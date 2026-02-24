<script setup lang="ts">
import { RiAddLine, RiDeleteBinLine, RiEyeOffLine, RiPencilLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import type { OptionMenuItem } from '@/components/ui/OptionMenu.vue'
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
  (e: 'stageAll'): void
  (e: 'stage', path: string): void
  (e: 'rename', path: string): void
  (e: 'discard', path: string): void
  (e: 'ignore', path: string): void
  (e: 'showMore'): void
}>()

function toggle() {
  emit('update:expanded', !props.expanded)
}

function mobileActionsForFile(path: string): OptionMenuItem[] {
  return [
    {
      id: 'stage',
      label: t('git.ui.workingTree.actions.stage'),
      icon: RiAddLine,
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
      id: 'ignore',
      label: t('git.ui.workingTree.actions.ignore'),
      icon: RiEyeOffLine,
      description: path,
      monospace: true,
    },
    {
      id: 'discard',
      label: t('git.ui.workingTree.actions.deleteFile'),
      icon: RiDeleteBinLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: t('git.ui.workingTree.confirmDeleteUntracked.title'),
      confirmDescription: t('git.ui.workingTree.confirmDeleteUntracked.description'),
      confirmText: t('git.ui.workingTree.actions.deleteFile'),
      cancelText: t('common.cancel'),
    },
  ]
}

function runMobileAction(path: string, actionId: string) {
  if (actionId === 'stage') {
    emit('stage', path)
    return
  }
  if (actionId === 'rename') {
    emit('rename', path)
    return
  }
  if (actionId === 'ignore') {
    emit('ignore', path)
    return
  }
  if (actionId === 'discard') {
    emit('discard', path)
  }
}
</script>

<template>
  <div class="oc-vscode-section select-none">
    <SectionToggleButton :open="expanded" :label="t('git.ui.workingTree.sections.untracked')" :count="count" @toggle="toggle">
      <template #actions>
        <SidebarIconButton
          size="sm"
          :title="t('git.ui.workingTree.actions.stageAll')"
          :aria-label="t('git.ui.workingTree.actions.stageAll')"
          @click.stop="$emit('stageAll')"
        >
          <RiAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
      </template>
    </SectionToggleButton>

    <div v-if="expanded" class="space-y-0.5 px-1 pb-1">
      <GitStatusListItem
        v-for="f in files"
        :key="f.path"
        :path="f.path"
        :active="selectedFile === f.path && diffSource === 'working'"
        status-label="??"
        status-class="oc-vscode-status-untracked"
        :insertions="f.insertions ?? 0"
        :is-mobile-pointer="isMobilePointer"
        :mobile-action-items="mobileActionsForFile(f.path)"
        :mobile-action-title="t('git.ui.workingTree.fileActionsTitle')"
        @select="$emit('select', f.path)"
        @mobileAction="(id) => runMobileAction(f.path, id)"
      >
        <template #actions>
          <SidebarIconButton
            size="sm"
            :title="t('git.ui.workingTree.actions.stage')"
            :aria-label="t('git.ui.workingTree.actions.stage')"
            @click.stop="$emit('stage', f.path)"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton size="sm" :title="t('common.rename')" :aria-label="t('common.rename')" @click.stop="$emit('rename', f.path)">
            <RiPencilLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :title="t('git.ui.workingTree.actions.ignore')"
            :aria-label="t('git.ui.workingTree.actions.ignore')"
            @click.stop="$emit('ignore', f.path)"
          >
            <RiEyeOffLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <ConfirmPopover
            :title="t('git.ui.workingTree.confirmDeleteUntracked.title')"
            :description="t('git.ui.workingTree.confirmDeleteUntracked.description')"
            :confirm-text="t('git.ui.workingTree.actions.deleteFile')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="$emit('discard', f.path)"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :title="t('git.ui.workingTree.actions.deleteFile')"
              :aria-label="t('git.ui.workingTree.actions.deleteFile')"
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
