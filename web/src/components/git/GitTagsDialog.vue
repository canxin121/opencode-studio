<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

import type { GitTagInfo } from '@/types/git'

const props = defineProps<{
  open: boolean
  tagsLoading: boolean
  tagsList: GitTagInfo[]
  remoteNames: string[]
  newTagName: string
  newTagRef: string
  newTagMessage: string
  tagRemote: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newTagName', value: string): void
  (e: 'update:newTagRef', value: string): void
  (e: 'update:newTagMessage', value: string): void
  (e: 'update:tagRemote', value: string): void
  (e: 'createTag'): void
  (e: 'refresh'): void
  (e: 'deleteLocal', name: string): void
  (e: 'deleteRemote', name: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newTagName' | 'newTagRef' | 'newTagMessage', v: string | number) {
  const s = String(v)
  if (key === 'newTagName') emit('update:newTagName', s)
  if (key === 'newTagRef') emit('update:newTagRef', s)
  if (key === 'newTagMessage') emit('update:newTagMessage', s)
}

function onUpdateRemote(ev: Event) {
  const el = ev.target as HTMLSelectElement | null
  emit('update:tagRemote', el?.value ?? '')
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Tags"
    description="Create and manage tags"
    maxWidth="max-w-2xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Create tag</div>
          <div class="grid gap-2 lg:grid-cols-[160px_1fr]">
            <Input
              :model-value="newTagName"
              class="h-9 font-mono text-xs"
              placeholder="v1.2.3"
              @update:model-value="(v) => onUpdateText('newTagName', v)"
            />
            <Input
              :model-value="newTagRef"
              class="h-9 font-mono text-xs"
              placeholder="HEAD"
              @update:model-value="(v) => onUpdateText('newTagRef', v)"
            />
          </div>
          <Input
            :model-value="newTagMessage"
            class="h-9 font-mono text-xs"
            placeholder="(optional) annotated message"
            @update:model-value="(v) => onUpdateText('newTagMessage', v)"
          />
          <div class="flex justify-end">
            <Button size="sm" :disabled="!newTagName.trim()" @click="$emit('createTag')">Create</Button>
          </div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Remote for deleting tags</div>
          <select
            :value="tagRemote"
            class="h-9 rounded border border-input bg-background text-xs px-2"
            @change="onUpdateRemote"
          >
            <option v-for="r in remoteNames" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs font-medium text-muted-foreground">Existing tags</div>
        <Button variant="secondary" size="sm" :disabled="tagsLoading" @click="$emit('refresh')">Refresh</Button>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="tagsLoading" class="p-3 text-xs text-muted-foreground">Loading...</div>
        <div v-else-if="!tagsList.length" class="p-3 text-xs text-muted-foreground">No tags</div>
        <div v-else class="divide-y divide-border/40">
          <div v-for="t in tagsList" :key="t.name" class="p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div class="min-w-0 flex-1">
              <div class="font-mono text-xs">{{ t.name }}</div>
              <div class="text-[11px] text-muted-foreground font-mono">
                {{ t.object.slice(0, 8) }}{{ t.creatorDate ? ` · ${t.creatorDate}` : '' }}
              </div>
              <div v-if="t.subject" class="text-[11px] text-muted-foreground mt-1">{{ t.subject }}</div>
            </div>
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              <ConfirmPopover
                title="Delete local tag?"
                description="This only removes the tag locally."
                confirm-text="Delete"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('deleteLocal', t.name)"
              >
                <Button variant="secondary" size="sm" class="h-8" @click="() => {}">Delete</Button>
              </ConfirmPopover>
              <ConfirmPopover
                title="Delete remote tag?"
                description="This pushes a delete to the remote."
                confirm-text="Delete"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('deleteRemote', t.name)"
              >
                <Button variant="secondary" size="sm" class="h-8" @click="() => {}">Delete Remote</Button>
              </ConfirmPopover>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">Close</Button>
      </div>
    </div>
  </FormDialog>
</template>
