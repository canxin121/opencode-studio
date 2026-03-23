<script setup lang="ts">
import { computed } from 'vue'
import { RiAddLine, RiArrowGoBackLine, RiDeleteBinLine, RiHistoryLine, RiPencilLine } from '@remixicon/vue'
import { RiCloseLine, RiListCheck3, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import type { OptionMenuItem } from '@/components/ui/optionMenu.types'
import GitStatusListItem from '@/components/git/GitStatusListItem.vue'

import type { GitStatusFile } from '@/types/git'

const { t } = useI18n()

type DiffSource = 'working' | 'staged'

const props = withDefaults(
  defineProps<{
    expanded: boolean
    count: number
    files: GitStatusFile[]
    selectedFile: string | null
    diffSource: DiffSource
    hasMore: boolean
    loading: boolean
    isMobilePointer: boolean
    multiSelectMode?: boolean
    selectedPaths?: string[]
  }>(),
  {
    multiSelectMode: false,
    selectedPaths: () => [],
  },
)

const emit = defineEmits<{
  (e: 'update:expanded', value: boolean): void
  (e: 'select', path: string): void
  (e: 'toggleSelect', path: string, event: MouseEvent): void
  (e: 'toggleMultiSelect'): void
  (e: 'selectAllSelected'): void
  (e: 'invertSelected'): void
  (e: 'stageSelected'): void
  (e: 'discardSelected'): void
  (e: 'deleteSelected'): void
  (e: 'stageAll'): void
  (e: 'discardAll'): void
  (e: 'stage', path: string): void
  (e: 'history', path: string): void
  (e: 'rename', path: string): void
  (e: 'discard', path: string): void
  (e: 'delete', path: string): void
  (e: 'showMore'): void
}>()

function toggle() {
  emit('update:expanded', !props.expanded)
}

function isPathSelected(path: string) {
  return props.selectedPaths.includes(path)
}

function onFileSelect(path: string, event: MouseEvent) {
  if (props.multiSelectMode) {
    emit('toggleSelect', path, event)
    return
  }
  emit('select', path)
}

const selectedCount = computed(() => props.files.filter((f) => isPathSelected(f.path)).length)
const selectableCount = computed(() => props.files.length)

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
      id: 'stage',
      label: t('git.ui.workingTree.actions.stage'),
      icon: RiAddLine,
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
      id: 'discard',
      label: t('git.ui.workingTree.actions.discardChanges'),
      icon: RiArrowGoBackLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: t('git.ui.workingTree.confirmDiscard.title'),
      confirmDescription: t('git.ui.workingTree.confirmDiscard.description'),
      confirmText: t('common.discard'),
      cancelText: t('common.cancel'),
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
  if (actionId === 'stage') {
    emit('stage', path)
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
  if (actionId === 'discard') {
    emit('discard', path)
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
      :label="t('git.ui.workingTree.sections.changes')"
      :count="count"
      @toggle="toggle"
    >
      <template #actions>
        <template v-if="multiSelectMode">
          <span
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-foreground/80"
            :title="String(t('git.ui.workingTree.multiSelect.selectedCount', { count: selectedCount }))"
            :aria-label="String(t('git.ui.workingTree.multiSelect.selectedCount', { count: selectedCount }))"
          >
            {{ selectedCount }}
          </span>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('common.selectAll'))"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="String(t('common.selectAll'))"
            :disabled="selectableCount === 0 || selectedCount === selectableCount"
            @click.stop="emit('selectAllSelected')"
          >
            <RiListCheck3 class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('common.invertSelection'))"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="String(t('common.invertSelection'))"
            :disabled="selectableCount === 0"
            @click.stop="emit('invertSelected')"
          >
            <RiRefreshLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.stageSelected'))"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="String(t('git.ui.workingTree.actions.stageSelected'))"
            :disabled="selectedCount === 0"
            @click.stop="emit('stageSelected')"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <ConfirmPopover
            :title="t('git.ui.workingTree.confirmDiscardSelected.title')"
            :description="
              t('git.ui.workingTree.confirmDiscardSelected.description', {
                count: selectedCount,
              })
            "
            :confirm-text="t('git.ui.workingTree.actions.discardSelected')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="emit('discardSelected')"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :tooltip="String(t('git.ui.workingTree.actions.discardSelected'))"
              :is-mobile-pointer="isMobilePointer"
              :aria-label="String(t('git.ui.workingTree.actions.discardSelected'))"
              :disabled="selectedCount === 0"
              @click.stop
            >
              <RiArrowGoBackLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>

          <ConfirmPopover
            :title="t('git.ui.workingTree.confirmDeleteSelected.title')"
            :description="
              t('git.ui.workingTree.confirmDeleteSelected.description', {
                count: selectedCount,
              })
            "
            :confirm-text="t('git.ui.workingTree.actions.deleteSelected')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="emit('deleteSelected')"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :tooltip="String(t('git.ui.workingTree.actions.deleteSelected'))"
              :is-mobile-pointer="isMobilePointer"
              :aria-label="String(t('git.ui.workingTree.actions.deleteSelected'))"
              :disabled="selectedCount === 0"
              @click.stop
            >
              <RiDeleteBinLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.exitMultiSelect'))"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="String(t('git.ui.workingTree.actions.exitMultiSelect'))"
            @click.stop="emit('toggleMultiSelect')"
          >
            <RiCloseLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </template>

        <template v-else>
          <ConfirmPopover
            :title="t('git.actionsMenu.cleanup.discardAllTracked.confirmTitle')"
            :description="t('git.actionsMenu.cleanup.discardAllTracked.confirmDescription')"
            :confirm-text="t('common.discard')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="$emit('discardAll')"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :disabled="count === 0"
              :tooltip="t('git.actionsMenu.cleanup.discardAllTracked.label')"
              :is-mobile-pointer="isMobilePointer"
              :aria-label="t('git.actionsMenu.cleanup.discardAllTracked.label')"
              @click.stop
            >
              <RiArrowGoBackLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>
          <SidebarIconButton
            size="sm"
            :tooltip="t('git.ui.workingTree.actions.stageAll')"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="t('git.ui.workingTree.actions.stageAll')"
            @click.stop="$emit('stageAll')"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.enterMultiSelect'))"
            :is-mobile-pointer="isMobilePointer"
            :aria-label="String(t('git.ui.workingTree.actions.enterMultiSelect'))"
            :disabled="selectableCount === 0"
            @click.stop="emit('toggleMultiSelect')"
          >
            <RiListCheck3 class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </template>
      </template>
    </SectionToggleButton>

    <div v-if="expanded" class="space-y-0.5 px-1 pb-1">
      <div v-if="loading && !files.length" class="oc-vscode-empty">{{ t('common.loading') }}</div>
      <div v-else-if="!files.length" class="oc-vscode-empty">{{ t('git.ui.workingTree.empty.changes') }}</div>

      <template v-else>
        <GitStatusListItem
          v-for="f in files"
          :key="f.path"
          :path="f.path"
          :active="!multiSelectMode && selectedFile === f.path && diffSource === 'working'"
          :status-label="(f.workingDir || '').trim() || 'M'"
          :status-class="statusClass(f.workingDir || '')"
          :insertions="f.insertions ?? 0"
          :deletions="f.deletions ?? 0"
          :show-selection="multiSelectMode"
          :selected="isPathSelected(f.path)"
          :is-mobile-pointer="isMobilePointer"
          :mobile-action-items="mobileActionsForFile(f.path)"
          :mobile-action-title="t('git.ui.workingTree.fileActionsTitle')"
          @select="(event) => onFileSelect(f.path, event)"
          @mobileAction="(id) => runMobileAction(f.path, id)"
        >
          <template #actions>
            <SidebarIconButton
              size="sm"
              :tooltip="t('git.ui.workingTree.actions.stage')"
              :is-mobile-pointer="isMobilePointer"
              :aria-label="t('git.ui.workingTree.actions.stage')"
              @click.stop="$emit('stage', f.path)"
            >
              <RiAddLine class="h-3.5 w-3.5" />
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
              :title="t('git.ui.workingTree.confirmDiscard.title')"
              :description="t('git.ui.workingTree.confirmDiscard.description')"
              :confirm-text="t('common.discard')"
              :cancel-text="t('common.cancel')"
              variant="destructive"
              @confirm="$emit('discard', f.path)"
            >
              <SidebarIconButton
                size="sm"
                destructive
                :tooltip="t('git.ui.workingTree.actions.discardChanges')"
                :is-mobile-pointer="isMobilePointer"
                :aria-label="t('git.ui.workingTree.actions.discardChanges')"
                @click.stop
              >
                <RiArrowGoBackLine class="h-3.5 w-3.5" />
              </SidebarIconButton>
            </ConfirmPopover>
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
      </template>
    </div>
  </div>
</template>
