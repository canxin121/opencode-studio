<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import type { GitRepoEntry } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  projectRoot: string
  repos: GitRepoEntry[]
  closedRepos: GitRepoEntry[]
  parentRepos: string[]
  reposLoading: boolean
  reposError: string | null
  selectedRepoRelative: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'refresh'): void
  (e: 'openInit'): void
  (e: 'openClone'): void
  (e: 'select', relative: string): void
  (e: 'openParent', root: string): void
  (e: 'closeRepo', relative: string): void
  (e: 'reopenRepo', relative: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}
</script>

<template>
  <Dialog
    :open="open"
    :title="t('git.ui.dialogs.repoPicker.title')"
    :description="t('git.ui.dialogs.repoPicker.description')"
    maxWidth="max-w-xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" @click="$emit('refresh')" :disabled="reposLoading">{{
          t('common.refresh')
        }}</Button>
        <Button size="sm" @click="$emit('openInit')">{{
          t('git.ui.dialogs.repoPicker.actions.initializeRepo')
        }}</Button>
        <Button size="sm" variant="secondary" @click="$emit('openClone')">{{
          t('git.ui.dialogs.repoPicker.actions.cloneRepo')
        }}</Button>
        <div
          class="order-last basis-full min-w-0 text-xs text-muted-foreground font-mono truncate sm:order-none sm:basis-auto sm:ml-auto"
          :title="projectRoot || ''"
        >
          {{ projectRoot || '' }}
        </div>
      </div>

      <div v-if="reposError" class="text-xs text-destructive/90">
        {{ reposError }}
      </div>

      <div v-if="reposLoading" class="space-y-2">
        <div v-for="i in 8" :key="i" class="flex items-center justify-between gap-3 px-3 py-2 border rounded-md">
          <Skeleton class="h-4 w-56" />
          <Skeleton class="h-4 w-16" />
        </div>
      </div>

      <div v-else-if="repos.length === 0" class="rounded-md border border-border/60 bg-muted/20 p-4">
        <div class="text-sm font-medium">{{ t('git.ui.dialogs.repoPicker.empty.title') }}</div>
        <div class="text-xs text-muted-foreground mt-1">{{ t('git.ui.dialogs.repoPicker.empty.description') }}</div>
      </div>

      <ScrollArea v-else class="h-72 border rounded-md">
        <div class="p-1 space-y-0.5 max-w-full overflow-x-hidden">
          <button
            v-for="r in repos"
            :key="r.root"
            type="button"
            class="w-full flex items-start justify-between gap-3 px-3 py-2 rounded-md hover:bg-muted/40 transition text-left min-w-0 overflow-hidden"
            :class="{ 'bg-primary/10': (r.relative || '.').trim() === (selectedRepoRelative || '').trim() }"
            @click="$emit('select', r.relative || '.')"
          >
            <div class="flex-1 min-w-0 overflow-hidden">
              <div class="text-xs font-mono truncate" :title="r.relative">{{ r.relative }}</div>
              <div class="text-[10px] text-muted-foreground break-words whitespace-normal leading-snug" :title="r.root">
                {{ r.root }}
              </div>
            </div>
            <div class="shrink-0 flex flex-wrap items-center justify-end gap-1">
              <div class="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                {{ r.kind }}
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px]"
                :title="t('git.ui.dialogs.repoPicker.actions.closeRepo')"
                @click.stop="$emit('closeRepo', r.relative || '.')"
              >
                {{ t('common.close') }}
              </Button>
            </div>
          </button>
        </div>
      </ScrollArea>

      <div v-if="closedRepos.length" class="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.repoPicker.sections.closedRepos') }}
        </div>
        <div class="space-y-1">
          <div
            v-for="r in closedRepos"
            :key="`closed-${r.root}`"
            class="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 sm:items-center"
          >
            <div class="min-w-0 overflow-hidden">
              <div class="text-xs font-mono truncate" :title="r.relative">{{ r.relative }}</div>
              <div class="text-[10px] text-muted-foreground break-words whitespace-normal leading-snug" :title="r.root">
                {{ r.root }}
              </div>
            </div>
            <Button variant="secondary" size="sm" class="h-7 shrink-0" @click="$emit('reopenRepo', r.relative || '.')">
              {{ t('git.ui.dialogs.repoPicker.actions.reopenRepo') }}
            </Button>
          </div>
        </div>
      </div>

      <div v-if="parentRepos.length" class="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.repoPicker.sections.parentRepos') }}
        </div>
        <div class="space-y-1">
          <button
            v-for="root in parentRepos"
            :key="root"
            type="button"
            class="w-full text-left rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs font-mono break-all whitespace-normal hover:bg-muted/40 transition"
            :title="root"
            @click="$emit('openParent', root)"
          >
            {{ root }}
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>
