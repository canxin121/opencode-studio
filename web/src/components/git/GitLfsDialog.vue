<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitLfsLockInfo } from '@/types/git'

const { t } = useI18n()

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
    :title="t('git.ui.dialogs.lfs.title')"
    :description="t('git.ui.dialogs.lfs.description')"
    maxWidth="max-w-3xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.lfs.sections.status') }}</div>
        <Button variant="secondary" size="sm" :disabled="loading" @click="$emit('refresh')">{{ t('common.refresh') }}</Button>
      </div>

        <div class="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2">
          <div class="text-sm">
            <span class="font-semibold">{{ t('git.ui.dialogs.lfs.installedLabel') }}</span>
            <span :class="installed ? 'text-emerald-500' : 'text-rose-500'" class="ml-1">
              {{ installed ? t('common.yes') : t('common.no') }}
            </span>
          </div>
          <div class="text-[11px] text-muted-foreground font-mono" v-if="version">{{ version }}</div>
          <div v-if="error" class="text-xs text-red-500">{{ error }}</div>
          <div class="flex gap-2">
            <Button size="sm" :disabled="loading" @click="$emit('install')">{{ t('git.ui.dialogs.lfs.actions.installForRepo') }}</Button>
          </div>
        </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.lfs.sections.trackPatterns') }}</div>
        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="trackPattern"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.lfs.placeholders.trackPattern')"
            @update:model-value="(v) => onUpdateText('trackPattern', v)"
          />
          <Button size="sm" :disabled="!trackPattern.trim()" @click="$emit('track')">{{ t('git.ui.dialogs.lfs.actions.track') }}</Button>
        </div>
        <ScrollArea class="h-32 border rounded-md">
          <div v-if="!tracked.length" class="p-3 text-xs text-muted-foreground">{{ t('git.ui.dialogs.lfs.emptyTrackedPatterns') }}</div>
          <div v-else class="p-2 space-y-1">
            <div v-for="p in tracked" :key="p" class="text-xs font-mono">{{ p }}</div>
          </div>
        </ScrollArea>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.lfs.sections.locks') }}</div>
        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="lockPath"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.lfs.placeholders.lockPath')"
            @update:model-value="(v) => onUpdateText('lockPath', v)"
          />
          <Button size="sm" :disabled="!lockPath.trim()" @click="$emit('lock')">{{ t('git.ui.dialogs.lfs.actions.lock') }}</Button>
        </div>
        <ScrollArea class="h-40 border rounded-md">
          <div v-if="locksLoading" class="p-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
          <div v-else-if="!locks.length" class="p-3 text-xs text-muted-foreground">{{ t('git.ui.dialogs.lfs.emptyLocks') }}</div>
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
                  {{ t('git.ui.dialogs.lfs.actions.unlock') }}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  class="h-7"
                  @click="$emit('unlock', { path: l.path, force: true })"
                >
                  {{ t('git.ui.dialogs.lfs.actions.forceUnlock') }}
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>
