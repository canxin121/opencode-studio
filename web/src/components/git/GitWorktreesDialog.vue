<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitWorktreeInfo } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  worktreesLoading: boolean
  worktreesError: string | null
  worktrees: GitWorktreeInfo[]
  repoRoot: string | null
  projectRoot: string | null
  newWorktreePath: string
  newWorktreeBranch: string
  newWorktreeStartPoint: string
  newWorktreeCreateBranch: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newWorktreePath', value: string): void
  (e: 'update:newWorktreeBranch', value: string): void
  (e: 'update:newWorktreeStartPoint', value: string): void
  (e: 'update:newWorktreeCreateBranch', value: boolean): void
  (e: 'refresh'): void
  (e: 'add'): void
  (e: 'remove', path: string): void
  (e: 'prune'): void
  (e: 'migrate', path: string): void
  (e: 'openWorktree', path: string): void
  (e: 'copyPath', path: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newWorktreePath' | 'newWorktreeBranch' | 'newWorktreeStartPoint', v: string | number) {
  const s = String(v)
  if (key === 'newWorktreePath') emit('update:newWorktreePath', s)
  if (key === 'newWorktreeBranch') emit('update:newWorktreeBranch', s)
  if (key === 'newWorktreeStartPoint') emit('update:newWorktreeStartPoint', s)
}

function onUpdateCreateBranch(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:newWorktreeCreateBranch', Boolean(el?.checked))
}

const projectRootTrimmed = computed(() => (props.projectRoot || '').trim().replace(/\/+$/g, ''))
const repoRootTrimmed = computed(() => (props.repoRoot || '').trim().replace(/\/+$/g, ''))

function isCurrentWorktree(path: string): boolean {
  const current = repoRootTrimmed.value
  return Boolean(current) && path.trim().replace(/\/+$/g, '') === current
}

function worktreeRelativePath(path: string): string | null {
  const base = projectRootTrimmed.value
  if (!base) return null
  if (!path.startsWith(base)) return null
  const rel = path.slice(base.length).replace(/^\/+/, '')
  return rel || '.'
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.worktrees.title')"
    :description="t('git.ui.dialogs.worktrees.description')"
    maxWidth="max-w-3xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.worktrees.sections.addWorktree') }}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" :disabled="worktreesLoading" @click="$emit('refresh')">{{
            t('common.refresh')
          }}</Button>
          <Button variant="secondary" size="sm" :disabled="worktreesLoading" @click="$emit('prune')">{{
            t('git.ui.dialogs.worktrees.actions.prune')
          }}</Button>
        </div>
      </div>

      <div class="grid gap-2">
        <div class="text-[11px] text-muted-foreground">
          {{ t('git.ui.dialogs.worktrees.hints.pathRelativeToRepoRoot') }}
        </div>
        <Input
          :model-value="newWorktreePath"
          class="h-9 font-mono text-xs"
          placeholder="worktrees/feature-branch"
          @update:model-value="(v) => onUpdateText('newWorktreePath', v)"
        />
        <div class="grid gap-2 lg:grid-cols-[1fr_1fr]">
          <Input
            :model-value="newWorktreeBranch"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.worktrees.placeholders.branchName')"
            @update:model-value="(v) => onUpdateText('newWorktreeBranch', v)"
          />
          <Input
            :model-value="newWorktreeStartPoint"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.worktrees.placeholders.startPoint')"
            @update:model-value="(v) => onUpdateText('newWorktreeStartPoint', v)"
          />
        </div>
        <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            class="accent-primary"
            :checked="newWorktreeCreateBranch"
            @change="onUpdateCreateBranch"
          />
          {{ t('git.ui.dialogs.worktrees.createNewBranch') }}
        </label>
        <div class="flex justify-end">
          <Button
            size="sm"
            :disabled="!newWorktreePath.trim() || (newWorktreeCreateBranch && !newWorktreeBranch.trim())"
            @click="$emit('add')"
          >
            {{ t('git.ui.dialogs.worktrees.actions.addWorktree') }}
          </Button>
        </div>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="worktreesError" class="p-3 text-xs text-red-500">{{ worktreesError }}</div>
        <div v-else-if="worktreesLoading" class="p-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
        <ScrollArea v-else class="h-64">
          <div v-if="!worktrees.length" class="p-3 text-xs text-muted-foreground">
            {{ t('git.ui.dialogs.worktrees.empty') }}
          </div>
          <div v-else class="divide-y divide-border/40">
            <div v-for="wt in worktrees" :key="wt.worktree" class="p-3 space-y-1">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="text-xs font-mono truncate">{{ wt.worktree }}</div>
                  <div class="text-[11px] text-muted-foreground">
                    <span v-if="wt.branch" class="font-mono">{{ wt.branch }}</span>
                    <span v-else class="font-mono">{{ t('git.ui.dialogs.worktrees.detached') }}</span>
                    <span v-if="wt.head" class="ml-2 font-mono">{{ wt.head.slice(0, 8) }}</span>
                  </div>
                  <div v-if="worktreeRelativePath(wt.worktree)" class="text-[11px] text-muted-foreground">
                    {{ worktreeRelativePath(wt.worktree) }}
                  </div>
                  <div v-if="wt.locked || wt.prunable" class="text-[10px] text-muted-foreground">
                    <span v-if="wt.locked">{{ t('git.ui.dialogs.worktrees.status.locked') }}</span>
                    <span v-if="wt.prunable" :class="wt.locked ? 'ml-2' : ''">{{
                      t('git.ui.dialogs.worktrees.status.prunable')
                    }}</span>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    class="h-7"
                    :disabled="!worktreeRelativePath(wt.worktree)"
                    @click="$emit('openWorktree', wt.worktree)"
                  >
                    {{ t('common.open') }}
                  </Button>
                  <Button variant="secondary" size="sm" class="h-7" @click="$emit('copyPath', wt.worktree)">{{
                    t('common.copyPath')
                  }}</Button>
                  <ConfirmPopover
                    :title="t('git.ui.dialogs.worktrees.confirmMigrate.title')"
                    :description="t('git.ui.dialogs.worktrees.confirmMigrate.description')"
                    :confirm-text="t('git.ui.dialogs.worktrees.actions.migrate')"
                    :cancel-text="t('common.cancel')"
                    @confirm="$emit('migrate', wt.worktree)"
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      class="h-7"
                      :disabled="isCurrentWorktree(wt.worktree)"
                      @click="() => {}"
                    >
                      {{ t('git.ui.dialogs.worktrees.actions.migrateChanges') }}
                    </Button>
                  </ConfirmPopover>
                  <ConfirmPopover
                    :title="t('git.ui.dialogs.worktrees.confirmRemove.title')"
                    :description="t('git.ui.dialogs.worktrees.confirmRemove.description')"
                    :confirm-text="t('common.remove')"
                    :cancel-text="t('common.cancel')"
                    variant="destructive"
                    @confirm="$emit('remove', wt.worktree)"
                  >
                    <Button variant="secondary" size="sm" class="h-7" @click="() => {}">{{
                      t('common.remove')
                    }}</Button>
                  </ConfirmPopover>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>
