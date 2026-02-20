<script setup lang="ts">
import { RiAddLine, RiArrowGoBackLine, RiDeleteBinLine, RiHistoryLine, RiPencilLine } from '@remixicon/vue'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import type { OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import GitStatusListItem from '@/components/git/GitStatusListItem.vue'

import type { GitStatusFile } from '@/types/git'

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
  (e: 'history', path: string): void
  (e: 'rename', path: string): void
  (e: 'discard', path: string): void
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
      id: 'stage',
      label: 'Stage',
      icon: RiAddLine,
      description: path,
      monospace: true,
    },
    {
      id: 'history',
      label: 'History',
      icon: RiHistoryLine,
      description: path,
      monospace: true,
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: RiPencilLine,
      description: path,
      monospace: true,
    },
    {
      id: 'discard',
      label: 'Discard changes',
      icon: RiArrowGoBackLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: 'Discard changes?',
      confirmDescription: 'This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: RiDeleteBinLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: 'Delete file?',
      confirmDescription: 'Tracked files will be removed and staged (git rm).',
      confirmText: 'Delete',
      cancelText: 'Cancel',
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
    <SectionToggleButton :open="expanded" label="Changes" :count="count" @toggle="toggle">
      <template #actions>
        <SidebarIconButton size="sm" title="Stage all" aria-label="Stage all" @click.stop="$emit('stageAll')">
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
        :status-label="(f.workingDir || '').trim() || 'M'"
        :status-class="statusClass(f.workingDir || '')"
        :insertions="f.insertions ?? 0"
        :deletions="f.deletions ?? 0"
        :is-mobile-pointer="isMobilePointer"
        :mobile-action-items="mobileActionsForFile(f.path)"
        mobile-action-title="File actions"
        @select="$emit('select', f.path)"
        @mobileAction="(id) => runMobileAction(f.path, id)"
      >
        <template #actions>
          <SidebarIconButton size="sm" title="Stage" aria-label="Stage" @click.stop="$emit('stage', f.path)">
            <RiAddLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton size="sm" title="History" aria-label="History" @click.stop="$emit('history', f.path)">
            <RiHistoryLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton size="sm" title="Rename" aria-label="Rename" @click.stop="$emit('rename', f.path)">
            <RiPencilLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <ConfirmPopover
            title="Discard changes?"
            description="This cannot be undone."
            confirm-text="Discard"
            cancel-text="Cancel"
            variant="destructive"
            @confirm="$emit('discard', f.path)"
          >
            <SidebarIconButton size="sm" destructive title="Discard changes" aria-label="Discard changes" @click.stop>
              <RiArrowGoBackLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </ConfirmPopover>
          <ConfirmPopover
            title="Delete file?"
            description="Tracked files will be removed and staged (git rm)."
            confirm-text="Delete"
            cancel-text="Cancel"
            variant="destructive"
            @confirm="$emit('delete', f.path)"
          >
            <SidebarIconButton size="sm" destructive title="Delete" aria-label="Delete" @click.stop>
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
        Show more ({{ files.length }}/{{ count }})
      </button>
    </div>
  </div>
</template>
