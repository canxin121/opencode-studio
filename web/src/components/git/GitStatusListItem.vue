<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiFileTextLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'
import ListItemFrame from '@/components/ui/ListItemFrame.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'

const props = withDefaults(
  defineProps<{
    path: string
    active?: boolean
    statusLabel?: string
    statusClass?: string
    insertions?: number
    deletions?: number
    isMobilePointer?: boolean
    mobileActionItems?: OptionMenuItem[]
    mobileActionTitle?: string
  }>(),
  {
    active: false,
    statusLabel: '',
    statusClass: 'text-muted-foreground',
    insertions: 0,
    deletions: 0,
    isMobilePointer: false,
    mobileActionItems: () => [],
    mobileActionTitle: '',
  },
)

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'select'): void
  (e: 'mobileAction', id: string): void
}>()

const hasStat = computed(() => (props.insertions ?? 0) > 0 || (props.deletions ?? 0) > 0)
const mobileActionMenuOpen = ref(false)
const mobileActionMenuQuery = ref('')

const hasMobileActions = computed(
  () => props.isMobilePointer && Array.isArray(props.mobileActionItems) && props.mobileActionItems.length > 0,
)

const mobileActionTitleText = computed(
  () => (props.mobileActionTitle || '').trim() || t('git.ui.workingTree.fileActionsTitle'),
)

const mobileActionGroups = computed<OptionMenuGroup[]>(() => {
  if (!hasMobileActions.value) return []
  return [
    {
      id: 'git-status-item-actions',
      items: props.mobileActionItems,
    },
  ]
})

function openMobileActionMenu() {
  if (!hasMobileActions.value) return
  mobileActionMenuQuery.value = ''
  mobileActionMenuOpen.value = true
}

function setMobileActionMenuOpen(open: boolean) {
  mobileActionMenuOpen.value = open
  if (!open) {
    mobileActionMenuQuery.value = ''
  }
}

function onMobileActionSelect(item: OptionMenuItem) {
  emit('mobileAction', item.id)
}

function handleMobileActionTrigger() {
  openMobileActionMenu()
}
</script>

<template>
  <ListItemFrame
    :active="active"
    :action-visibility="hasMobileActions ? 'always' : 'hover'"
    class="select-none"
    @click="emit('select')"
  >
    <template #leading>
      <RiFileTextLine class="h-3.5 w-3.5" />
    </template>

    <div class="flex w-full items-center gap-1.5 min-w-0">
      <span class="min-w-0 flex-1 truncate typography-ui-label" :title="path">{{ path }}</span>
      <span v-if="statusLabel" class="oc-vscode-row-status" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <template #meta>
      <span v-if="hasStat" class="inline-flex min-w-[9ch] items-center justify-end gap-1 font-mono tabular-nums">
        <span class="inline-flex min-w-[4ch] justify-end text-emerald-500">
          {{ (insertions ?? 0) > 0 ? `+${insertions}` : '' }}
        </span>
        <span class="inline-flex min-w-[4ch] justify-end text-rose-500">
          {{ (deletions ?? 0) > 0 ? `-${deletions}` : '' }}
        </span>
      </span>
    </template>

    <template #actions>
      <template v-if="hasMobileActions">
        <ListItemOverflowActionButton mobile :label="mobileActionTitleText" @trigger="handleMobileActionTrigger" />

        <OptionMenu
          :open="mobileActionMenuOpen"
          :query="mobileActionMenuQuery"
          :groups="mobileActionGroups"
          :title="mobileActionTitleText"
          :mobile-title="mobileActionTitleText"
          :searchable="true"
          :is-mobile-pointer="isMobilePointer"
          @update:open="setMobileActionMenuOpen"
          @update:query="(v) => (mobileActionMenuQuery = v)"
          @select="onMobileActionSelect"
        />
      </template>

      <slot v-else name="actions" />
    </template>
  </ListItemFrame>
</template>
