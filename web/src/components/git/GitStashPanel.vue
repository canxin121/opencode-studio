<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import MiniActionButton from '@/components/ui/MiniActionButton.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'

import type { GitStashEntry } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  expanded: boolean
  stashes: GitStashEntry[]
  loading: boolean
  canOperate: boolean
}>()

const emit = defineEmits<{
  (e: 'update:expanded', value: boolean): void
  (e: 'openCreate'): void
  (e: 'dropAll'): void
  (e: 'view', ref: string): void
  (e: 'apply', ref: string): void
  (e: 'pop', ref: string): void
  (e: 'branch', ref: string): void
  (e: 'drop', ref: string): void
}>()

function toggle() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div class="oc-vscode-section select-none">
    <SectionToggleButton
      :open="expanded"
      :label="t('git.actions.stash')"
      :count="stashes.length"
      :show-actions="false"
      @toggle="toggle"
    />

    <div v-if="expanded" class="space-y-1 px-1 pb-1">
      <div class="flex justify-end gap-1">
        <ConfirmPopover
          :title="t('git.ui.stashPanel.confirmDropAll.title')"
          :description="t('git.ui.stashPanel.confirmDropAll.description')"
          :confirm-text="t('git.ui.stashPanel.actions.dropAll')"
          :cancel-text="t('common.cancel')"
          variant="destructive"
          @confirm="$emit('dropAll')"
        >
          <MiniActionButton :disabled="loading || !stashes.length" @click="() => {}">{{ t('git.ui.stashPanel.actions.dropAll') }}</MiniActionButton>
        </ConfirmPopover>
        <MiniActionButton variant="default" :disabled="!canOperate" @click="$emit('openCreate')"
          >{{ t('git.ui.stashPanel.actions.stashEllipsis') }}</MiniActionButton
        >
      </div>

      <div v-if="!stashes.length" class="oc-vscode-empty">{{ t('git.ui.stashPanel.empty') }}</div>
      <div v-else class="space-y-1">
        <div
          v-for="s in stashes"
          :key="s.ref"
          class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-1.5"
        >
          <div class="text-[11px] font-mono truncate" :title="s.ref">{{ s.ref }}</div>
          <div class="text-[11px] text-muted-foreground truncate" :title="s.title">{{ s.title }}</div>
          <div class="mt-1 flex flex-wrap justify-end gap-1">
            <MiniActionButton @click="$emit('view', s.ref)">{{ t('common.view') }}</MiniActionButton>
            <MiniActionButton @click="$emit('apply', s.ref)">{{ t('common.apply') }}</MiniActionButton>
            <MiniActionButton @click="$emit('pop', s.ref)">{{ t('git.ui.stashPanel.actions.pop') }}</MiniActionButton>
            <MiniActionButton @click="$emit('branch', s.ref)">{{ t('git.fields.branch') }}</MiniActionButton>
            <MiniActionButton variant="destructive" @click="$emit('drop', s.ref)">{{ t('git.ui.stashPanel.actions.drop') }}</MiniActionButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
