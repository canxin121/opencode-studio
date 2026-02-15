<script setup lang="ts">
import { computed } from 'vue'
import { RiCheckLine, RiPencilLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import type { GitBranchesResponse } from '@/types/git'

const props = defineProps<{
  open: boolean
  branchesLoading: boolean
  branches: GitBranchesResponse | null
  newBranchName: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newBranchName', value: string): void
  (e: 'create'): void
  (e: 'checkout', name: string): void
  (e: 'delete', name: string): void
  (e: 'deleteRemote', name: string): void
  (e: 'rename', name: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateName(v: string | number) {
  emit('update:newBranchName', String(v))
}

const branchList = computed(() => {
  const list = Object.values(props.branches?.branches ?? {}).map((b) => {
    const isRemote = (b.name || '').startsWith('remotes/')
    return {
      ...b,
      isRemote,
      isRemoteHead: isRemote && (b.name || '').endsWith('/HEAD'),
    }
  })
  return list.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return a.name.localeCompare(b.name)
  })
})
</script>

<template>
  <FormDialog :open="open" title="Branches" description="Manage repository branches" @update:open="onUpdateOpen">
    <div class="space-y-4">
      <div class="flex gap-2">
        <Input
          :model-value="newBranchName"
          placeholder="New branch name..."
          class="h-8 text-sm font-mono"
          @update:model-value="onUpdateName"
        />
        <Button size="sm" @click="$emit('create')" :disabled="!newBranchName.trim()">Create</Button>
      </div>

      <div v-if="branchesLoading" class="py-3">
        <div class="px-2 pb-2 text-xs text-muted-foreground uppercase tracking-wide">Branches</div>
        <div class="space-y-2 px-2">
          <div v-for="i in 7" :key="i" class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <Skeleton class="h-4 w-4 rounded" />
              <Skeleton class="h-4 w-40 max-w-[60%]" />
            </div>
            <Skeleton class="h-6 w-16 rounded-md" />
          </div>
        </div>
      </div>

      <ScrollArea v-else class="h-64 border rounded-md">
        <div v-if="branches" class="p-1 space-y-0.5">
          <div
            v-for="b in branchList"
            :key="b.name"
            class="flex items-center justify-between px-3 py-2 hover:bg-muted/50 rounded-sm text-sm group"
          >
            <div class="flex items-center gap-2 min-w-0">
              <RiCheckLine v-if="b.current" class="h-4 w-4 text-primary flex-shrink-0" />
              <div class="min-w-0">
                <div class="font-mono truncate" :class="{ 'font-semibold': b.current }">{{ b.name }}</div>
                <div v-if="b.label" class="text-[10px] text-muted-foreground truncate">{{ b.label }}</div>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <Button
                v-if="!b.current"
                size="sm"
                variant="ghost"
                class="h-6 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                @click="$emit('checkout', b.name)"
              >
                Checkout
              </Button>
              <Button
                v-if="!b.isRemote"
                size="sm"
                variant="ghost"
                class="h-6 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                title="Rename"
                aria-label="Rename"
                @click="$emit('rename', b.name)"
              >
                <RiPencilLine class="h-3.5 w-3.5" />
              </Button>
              <ConfirmPopover
                v-if="!b.current && !b.isRemote"
                title="Delete branch?"
                description="This cannot be undone."
                confirm-text="Delete"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('delete', b.name)"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto text-destructive"
                  @click.stop
                >
                  Delete
                </Button>
              </ConfirmPopover>
              <ConfirmPopover
                v-if="!b.current && b.isRemote && !b.isRemoteHead"
                title="Delete remote branch?"
                description="This will delete the branch from the remote."
                confirm-text="Delete"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('deleteRemote', b.name)"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto text-destructive"
                  @click.stop
                >
                  Delete Remote
                </Button>
              </ConfirmPopover>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  </FormDialog>
</template>
