<script setup lang="ts">
import { computed } from 'vue'
import { RiAddLine, RiDeleteBinLine, RiEyeOffLine, RiPencilLine } from '@remixicon/vue'
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
    isTouchPointer?: boolean
    isMobileFormFactor?: boolean
    isMobilePointer?: boolean
    multiSelectMode?: boolean
    selectedPaths?: string[]
  }>(),
  {
    isMobileFormFactor: false,
    isMobilePointer: false,
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
  (e: 'ignoreSelected'): void
  (e: 'deleteSelected'): void
  (e: 'stageAll'): void
  (e: 'discardAll'): void
  (e: 'stage', path: string): void
  (e: 'rename', path: string): void
  (e: 'discard', path: string): void
  (e: 'ignore', path: string): void
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
const isMobileFormFactor = computed(() => props.isMobileFormFactor ?? props.isMobilePointer)
const isTouchPointer = computed(() => props.isTouchPointer ?? isMobileFormFactor.value)

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
    <SectionToggleButton
      :open="expanded"
      :label="t('git.ui.workingTree.sections.untracked')"
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
            :is-touch-pointer="isTouchPointer"
            :aria-label="String(t('common.selectAll'))"
            :disabled="selectableCount === 0 || selectedCount === selectableCount"
            @click.stop="emit('selectAllSelected')"
          >
            <RiListCheck3 class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('common.invertSelection'))"
            :is-touch-pointer="isTouchPointer"
            :aria-label="String(t('common.invertSelection'))"
            :disabled="selectableCount === 0"
            @click.stop="emit('invertSelected')"
          >
            <RiRefreshLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.stageSelected'))"
            :is-touch-pointer="isTouchPointer"
            :aria-label="String(t('git.ui.workingTree.actions.stageSelected'))"
            :disabled="selectedCount === 0"
            @click.stop="emit('stageSelected')"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.ignore'))"
            :is-touch-pointer="isTouchPointer"
            :aria-label="String(t('git.ui.workingTree.actions.ignore'))"
            :disabled="selectedCount === 0"
            @click.stop="emit('ignoreSelected')"
          >
            <RiEyeOffLine class="h-3.5 w-3.5" />
          </SidebarIconButton>

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
              :is-touch-pointer="isTouchPointer"
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
            :is-touch-pointer="isTouchPointer"
            :aria-label="String(t('git.ui.workingTree.actions.exitMultiSelect'))"
            @click.stop="emit('toggleMultiSelect')"
          >
            <RiCloseLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </template>

        <template v-else>
          <ConfirmPopover
            :title="t('git.actionsMenu.cleanup.cleanUntracked.confirmTitle')"
            :description="t('git.actionsMenu.cleanup.cleanUntracked.confirmDescription')"
            :confirm-text="t('common.clean')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="$emit('discardAll')"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :disabled="count === 0"
              :tooltip="t('git.actionsMenu.cleanup.cleanUntracked.label')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('git.actionsMenu.cleanup.cleanUntracked.label')"
              @click.stop
            >
              <RiDeleteBinLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>
          <SidebarIconButton
            size="sm"
            :tooltip="t('git.ui.workingTree.actions.stageAll')"
            :is-touch-pointer="isTouchPointer"
            :aria-label="t('git.ui.workingTree.actions.stageAll')"
            @click.stop="$emit('stageAll')"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :tooltip="String(t('git.ui.workingTree.actions.enterMultiSelect'))"
            :is-touch-pointer="isTouchPointer"
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
      <div v-else-if="!files.length" class="oc-vscode-empty">{{ t('git.ui.workingTree.empty.untracked') }}</div>

      <template v-else>
        <GitStatusListItem
          v-for="f in files"
          :key="f.path"
          :path="f.path"
          :active="!multiSelectMode && selectedFile === f.path && diffSource === 'working'"
          status-label="??"
          status-class="oc-vscode-status-untracked"
          :insertions="f.insertions ?? 0"
          :show-selection="multiSelectMode"
          :selected="isPathSelected(f.path)"
          :is-mobile-form-factor="isMobileFormFactor"
          :mobile-action-items="mobileActionsForFile(f.path)"
          :mobile-action-title="t('git.ui.workingTree.fileActionsTitle')"
          @select="(event) => onFileSelect(f.path, event)"
          @mobileAction="(id) => runMobileAction(f.path, id)"
        >
          <template #actions>
            <SidebarIconButton
              size="sm"
              :tooltip="t('git.ui.workingTree.actions.stage')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('git.ui.workingTree.actions.stage')"
              @click.stop="$emit('stage', f.path)"
            >
              <RiAddLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton
              size="sm"
              :tooltip="t('common.rename')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('common.rename')"
              @click.stop="$emit('rename', f.path)"
            >
              <RiPencilLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton
              size="sm"
              :tooltip="t('git.ui.workingTree.actions.ignore')"
              :is-touch-pointer="isTouchPointer"
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
                :tooltip="t('git.ui.workingTree.actions.deleteFile')"
                :is-touch-pointer="isTouchPointer"
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
      </template>
    </div>
  </div>
</template>
