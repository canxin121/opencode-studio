<script setup lang="ts">
import { RiAddLine, RiDeleteBinLine, RiEyeOffLine, RiPencilLine } from '@remixicon/vue'

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
      label: 'Stage',
      icon: RiAddLine,
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
      id: 'ignore',
      label: 'Ignore',
      icon: RiEyeOffLine,
      description: path,
      monospace: true,
    },
    {
      id: 'discard',
      label: 'Delete file',
      icon: RiDeleteBinLine,
      variant: 'destructive',
      description: path,
      monospace: true,
      confirmTitle: 'Discard changes?',
      confirmDescription: 'This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
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
    <SectionToggleButton :open="expanded" label="Untracked" :count="count" @toggle="toggle">
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
        status-label="??"
        status-class="oc-vscode-status-untracked"
        :insertions="f.insertions ?? 0"
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
          <SidebarIconButton size="sm" title="Rename" aria-label="Rename" @click.stop="$emit('rename', f.path)">
            <RiPencilLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton size="sm" title="Ignore" aria-label="Ignore" @click.stop="$emit('ignore', f.path)">
            <RiEyeOffLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <ConfirmPopover
            title="Discard changes?"
            description="This cannot be undone."
            confirm-text="Discard"
            cancel-text="Cancel"
            variant="destructive"
            @confirm="$emit('discard', f.path)"
          >
            <SidebarIconButton size="sm" destructive title="Delete file" aria-label="Delete file" @click.stop>
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
