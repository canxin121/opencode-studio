<script setup lang="ts">
import { computed } from 'vue'
import { RiAddLine, RiArrowDownLine, RiArrowUpLine, RiDeleteBinLine, RiGitBranchLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import SectionToggleButton from '@/components/ui/SectionToggleButton.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'

import type { GitStashEntry } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  expanded: boolean
  stashes: GitStashEntry[]
  loading: boolean
  canOperate: boolean
  isTouchPointer?: boolean
  isMobileFormFactor?: boolean
  isMobilePointer?: boolean
}>()

const isMobileFormFactor = computed(() => props.isMobileFormFactor ?? props.isMobilePointer)
const isTouchPointer = computed(() => props.isTouchPointer ?? isMobileFormFactor.value)

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

function stashTitle(entry: GitStashEntry): string {
  const raw = String(entry.title || '').trim()
  return raw || entry.ref
}
</script>

<template>
  <div class="oc-vscode-section select-none">
    <SectionToggleButton
      :open="expanded"
      :label="t('git.ui.workingTree.sections.stashChanges')"
      :count="stashes.length"
      @toggle="toggle"
    >
      <template #actions>
        <ConfirmPopover
          :title="t('git.ui.stashPanel.confirmDropAll.title')"
          :description="t('git.ui.stashPanel.confirmDropAll.description')"
          :confirm-text="t('git.ui.stashPanel.actions.dropAll')"
          :cancel-text="t('common.cancel')"
          variant="destructive"
          @confirm="$emit('dropAll')"
        >
          <SidebarIconButton
            size="sm"
            destructive
            :disabled="loading || !stashes.length"
            :tooltip="t('git.ui.stashPanel.actions.dropAll')"
            :is-touch-pointer="isTouchPointer"
            :aria-label="t('git.ui.stashPanel.actions.dropAll')"
            @click.stop
          >
            <RiDeleteBinLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
        </ConfirmPopover>

        <SidebarIconButton
          size="sm"
          :disabled="!canOperate"
          :tooltip="t('git.ui.stashPanel.actions.stashEllipsis')"
          :is-touch-pointer="isTouchPointer"
          :aria-label="t('git.ui.stashPanel.actions.stashEllipsis')"
          @click.stop="$emit('openCreate')"
        >
          <RiAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
      </template>
    </SectionToggleButton>

    <div v-if="expanded" class="space-y-0.5 px-1 pb-1">
      <div v-if="loading && !stashes.length" class="oc-vscode-empty">{{ t('common.loading') }}</div>
      <div v-else-if="!stashes.length" class="oc-vscode-empty">{{ t('git.ui.stashPanel.empty') }}</div>

      <template v-else>
        <SidebarListItem
          v-for="s in stashes"
          :key="s.ref"
          :actions-always-visible="isMobileFormFactor"
          class="py-1.5"
          @click="$emit('view', s.ref)"
        >
          <div class="min-w-0">
            <div class="truncate text-[11px] font-mono text-foreground" :title="s.ref">{{ s.ref }}</div>
            <div class="mt-0.5 truncate text-[10px] text-muted-foreground" :title="stashTitle(s)">
              {{ stashTitle(s) }}
            </div>
          </div>

          <template #actions>
            <SidebarIconButton
              size="sm"
              :tooltip="t('common.apply')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('common.apply')"
              @click.stop="$emit('apply', s.ref)"
            >
              <RiArrowDownLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton
              size="sm"
              :tooltip="t('git.ui.stashPanel.actions.pop')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('git.ui.stashPanel.actions.pop')"
              @click.stop="$emit('pop', s.ref)"
            >
              <RiArrowUpLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton
              size="sm"
              :tooltip="t('git.fields.branch')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('git.fields.branch')"
              @click.stop="$emit('branch', s.ref)"
            >
              <RiGitBranchLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton
              size="sm"
              destructive
              :tooltip="t('git.ui.stashPanel.actions.drop')"
              :is-touch-pointer="isTouchPointer"
              :aria-label="t('git.ui.stashPanel.actions.drop')"
              @click.stop="$emit('drop', s.ref)"
            >
              <RiDeleteBinLine class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </template>
        </SidebarListItem>
      </template>
    </div>
  </div>
</template>
