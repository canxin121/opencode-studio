<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitRemoteInfo } from '@/types/git'

const props = defineProps<{
  open: boolean
  remotesLoading: boolean
  remotesError: string | null
  remotes: GitRemoteInfo[]
  newRemoteName: string
  newRemoteUrl: string
  selectedRemote: string
  renameRemoteTo: string
  setRemoteUrl: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newRemoteName', value: string): void
  (e: 'update:newRemoteUrl', value: string): void
  (e: 'update:selectedRemote', value: string): void
  (e: 'update:renameRemoteTo', value: string): void
  (e: 'update:setRemoteUrl', value: string): void
  (e: 'refresh'): void
  (e: 'add'): void
  (e: 'rename'): void
  (e: 'setUrl'): void
  (e: 'remove', name: string): void
  (e: 'copyUrl', url: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newRemoteName' | 'newRemoteUrl' | 'renameRemoteTo' | 'setRemoteUrl', v: string | number) {
  const s = String(v)
  if (key === 'newRemoteName') emit('update:newRemoteName', s)
  if (key === 'newRemoteUrl') emit('update:newRemoteUrl', s)
  if (key === 'renameRemoteTo') emit('update:renameRemoteTo', s)
  if (key === 'setRemoteUrl') emit('update:setRemoteUrl', s)
}

function onSelectRemote(ev: Event) {
  const el = ev.target as HTMLSelectElement | null
  emit('update:selectedRemote', el?.value ?? '')
}

const selectedInfo = computed(() => props.remotes.find((r) => r.name === props.selectedRemote) || null)
</script>

<template>
  <FormDialog
    :open="open"
    title="Remotes"
    description="Manage repository remotes"
    maxWidth="max-w-2xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">Add remote</div>
        <Button variant="secondary" size="sm" :disabled="remotesLoading" @click="$emit('refresh')">Refresh</Button>
      </div>

      <div class="grid gap-2 lg:grid-cols-[140px_1fr_auto]">
        <Input
          :model-value="newRemoteName"
          class="h-9 font-mono text-xs"
          placeholder="origin"
          @update:model-value="(v) => onUpdateText('newRemoteName', v)"
        />
        <Input
          :model-value="newRemoteUrl"
          class="h-9 font-mono text-xs"
          placeholder="https://github.com/org/repo.git"
          @update:model-value="(v) => onUpdateText('newRemoteUrl', v)"
        />
        <Button size="sm" :disabled="!newRemoteName.trim() || !newRemoteUrl.trim()" @click="$emit('add')">Add</Button>
      </div>

      <div class="grid gap-2">
        <div class="text-xs font-medium text-muted-foreground">Manage remote</div>
        <select
          :value="selectedRemote"
          class="h-9 rounded border border-input bg-background text-xs px-2"
          @change="onSelectRemote"
        >
          <option value="" disabled>Select a remote</option>
          <option v-for="r in remotes" :key="r.name" :value="r.name">{{ r.name }}</option>
        </select>
        <div v-if="selectedInfo" class="text-[11px] text-muted-foreground font-mono break-all">
          {{ selectedInfo.url }}
        </div>

        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="renameRemoteTo"
            class="h-9 font-mono text-xs"
            placeholder="New remote name"
            @update:model-value="(v) => onUpdateText('renameRemoteTo', v)"
          />
          <Button size="sm" :disabled="!selectedRemote.trim() || !renameRemoteTo.trim()" @click="$emit('rename')"
            >Rename</Button
          >
        </div>

        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="setRemoteUrl"
            class="h-9 font-mono text-xs"
            placeholder="New remote URL"
            @update:model-value="(v) => onUpdateText('setRemoteUrl', v)"
          />
          <Button size="sm" :disabled="!selectedRemote.trim() || !setRemoteUrl.trim()" @click="$emit('setUrl')"
            >Set URL</Button
          >
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="!selectedInfo?.url"
            @click="selectedInfo?.url && $emit('copyUrl', selectedInfo.url)"
          >
            Copy URL
          </Button>
          <ConfirmPopover
            title="Remove remote?"
            description="This will remove the remote configuration."
            confirm-text="Remove"
            cancel-text="Cancel"
            variant="destructive"
            @confirm="selectedRemote && $emit('remove', selectedRemote)"
          >
            <Button variant="secondary" size="sm" :disabled="!selectedRemote.trim()" @click="() => {}"> Remove </Button>
          </ConfirmPopover>
        </div>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="remotesError" class="p-3 text-xs text-red-500">{{ remotesError }}</div>
        <div v-else-if="remotesLoading" class="p-3 text-xs text-muted-foreground">Loading...</div>
        <ScrollArea v-else class="h-40">
          <div v-if="!remotes.length" class="p-3 text-xs text-muted-foreground">No remotes</div>
          <div v-else class="divide-y divide-border/40">
            <button
              v-for="r in remotes"
              :key="`${r.name}:${r.url}`"
              type="button"
              class="w-full text-left p-3 hover:bg-muted/40"
              :class="selectedRemote === r.name ? 'bg-muted/50' : ''"
              @click="$emit('update:selectedRemote', r.name)"
            >
              <div class="text-xs font-medium font-mono">{{ r.name }}</div>
              <div class="text-[11px] text-muted-foreground font-mono break-all">{{ r.url }}</div>
            </button>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>
