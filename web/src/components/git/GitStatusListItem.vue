<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiFileTextLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'
import ListItemFrame from '@/components/ui/ListItemFrame.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import ListItemSelectionIndicator from '@/components/ui/ListItemSelectionIndicator.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { writeWorkspaceWindowTemplateToDataTransfer } from '@/layout/workspaceWindowDrag'

const props = withDefaults(
  defineProps<{
    path: string
    active?: boolean
    statusLabel?: string
    statusClass?: string
    insertions?: number
    deletions?: number
    isMobileFormFactor?: boolean
    isMobilePointer?: boolean
    mobileActionItems?: OptionMenuItem[]
    mobileActionTitle?: string
    showSelection?: boolean
    selected?: boolean
  }>(),
  {
    active: false,
    statusLabel: '',
    statusClass: 'text-muted-foreground',
    insertions: 0,
    deletions: 0,
    isMobileFormFactor: false,
    isMobilePointer: false,
    mobileActionItems: () => [],
    mobileActionTitle: '',
    showSelection: false,
    selected: false,
  },
)

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'select', event: MouseEvent): void
  (e: 'mobileAction', id: string): void
}>()

const hasStat = computed(() => (props.insertions ?? 0) > 0 || (props.deletions ?? 0) > 0)
const mobileActionMenuOpen = ref(false)
const mobileActionMenuQuery = ref('')
const isMobileFormFactor = computed(() => Boolean(props.isMobileFormFactor ?? props.isMobilePointer))

const hasMobileActions = computed(
  () => isMobileFormFactor.value && Array.isArray(props.mobileActionItems) && props.mobileActionItems.length > 0,
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

function handleRowDragStart(event: DragEvent) {
  const path = String(props.path || '').trim()
  if (!path) {
    event.preventDefault()
    return
  }

  const transfer = event.dataTransfer
  if (!transfer) {
    event.preventDefault()
    return
  }

  transfer.effectAllowed = 'copyMove'
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() || path
  const ok = writeWorkspaceWindowTemplateToDataTransfer(transfer, {
    tab: 'files',
    query: { filePath: path },
    title: fileName,
    matchKeys: ['filePath'],
  })
  if (!ok) {
    event.preventDefault()
  }
}
</script>

<template>
  <ListItemFrame
    draggable="true"
    :active="active"
    :action-visibility="hasMobileActions ? 'always' : 'hover'"
    class="select-none"
    @click="emit('select', $event)"
    @dragstart="handleRowDragStart"
  >
    <template #leading>
      <div class="flex items-center gap-1.5">
        <ListItemSelectionIndicator v-if="showSelection" :selected="selected" />
        <RiFileTextLine class="h-3.5 w-3.5" />
      </div>
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
          :is-mobile-pointer="isMobileFormFactor"
          @update:open="setMobileActionMenuOpen"
          @update:query="(v) => (mobileActionMenuQuery = v)"
          @select="onMobileActionSelect"
        />
      </template>

      <slot v-else name="actions" />
    </template>
  </ListItemFrame>
</template>
