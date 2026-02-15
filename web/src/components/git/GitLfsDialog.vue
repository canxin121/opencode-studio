<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitLfsLockInfo } from '@/types/git'

const props = defineProps<{
  open: boolean
  loading: boolean
  error: string | null
  installed: boolean
  version: string | null
  tracked: string[]
  trackPattern: string
  lockPath: string
  locks: GitLfsLockInfo[]
  locksLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:trackPattern', value: string): void
  (e: 'update:lockPath', value: string): void
  (e: 'refresh'): void
  (e: 'install'): void
  (e: 'track'): void
  (e: 'lock'): void
  (e: 'unlock', payload: { path: string; force: boolean }): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'trackPattern' | 'lockPath', v: string | number) {
  const s = String(v)
  if (key === 'trackPattern') emit('update:trackPattern', s)
  if (key === 'lockPath') emit('update:lockPath', s)
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Git LFS"
    description="Large File Storage"
    maxWidth="max-w-3xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">Status</div>
        <Button variant="secondary" size="sm" :disabled="loading" @click="$emit('refresh')">Refresh</Button>
      </div>

      <div class="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2">
        <div class="text-sm">
          <span class="font-semibold">Installed:</span>
          <span :class="installed ? 'text-emerald-500' : 'text-rose-500'" class="ml-1">
            {{ installed ? 'Yes' : 'No' }}
          </span>
        </div>
        <div class="text-[11px] text-muted-foreground font-mono" v-if="version">{{ version }}</div>
        <div v-if="error" class="text-xs text-red-500">{{ error }}</div>
        <div class="flex gap-2">
          <Button size="sm" :disabled="loading" @click="$emit('install')">Install for repo</Button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted-foreground">Track patterns</div>
        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="trackPattern"
            class="h-9 font-mono text-xs"
            placeholder="*.psd"
            @update:model-value="(v) => onUpdateText('trackPattern', v)"
          />
          <Button size="sm" :disabled="!trackPattern.trim()" @click="$emit('track')">Track</Button>
        </div>
        <ScrollArea class="h-32 border rounded-md">
          <div v-if="!tracked.length" class="p-3 text-xs text-muted-foreground">No tracked patterns</div>
          <div v-else class="p-2 space-y-1">
            <div v-for="p in tracked" :key="p" class="text-xs font-mono">{{ p }}</div>
          </div>
        </ScrollArea>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted-foreground">Locks</div>
        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="lockPath"
            class="h-9 font-mono text-xs"
            placeholder="path/to/file.bin"
            @update:model-value="(v) => onUpdateText('lockPath', v)"
          />
          <Button size="sm" :disabled="!lockPath.trim()" @click="$emit('lock')">Lock</Button>
        </div>
        <ScrollArea class="h-40 border rounded-md">
          <div v-if="locksLoading" class="p-3 text-xs text-muted-foreground">Loading...</div>
          <div v-else-if="!locks.length" class="p-3 text-xs text-muted-foreground">No locks</div>
          <div v-else class="divide-y divide-border/40">
            <div v-for="l in locks" :key="l.id || l.path" class="p-3 space-y-1">
              <div class="text-xs font-mono">{{ l.path }}</div>
              <div class="text-[11px] text-muted-foreground">
                <span v-if="l.owner">{{ l.owner }}</span>
                <span v-if="l.lockedAt" class="ml-2">{{ l.lockedAt }}</span>
              </div>
              <div class="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  class="h-7"
                  @click="$emit('unlock', { path: l.path, force: false })"
                >
                  Unlock
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  class="h-7"
                  @click="$emit('unlock', { path: l.path, force: true })"
                >
                  Force unlock
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>
