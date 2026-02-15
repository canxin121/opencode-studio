<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiFileTextLine, RiMore2Line } from '@remixicon/vue'
import IconButton from '@/components/ui/IconButton.vue'
import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'

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
    mobileActionTitle: 'File actions',
  },
)

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
</script>

<template>
  <SidebarListItem
    :active="active"
    :actions-always-visible="hasMobileActions"
    class="select-none"
    @click="emit('select')"
  >
    <template #icon>
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
        <IconButton
          size="sm"
          class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
          :title="mobileActionTitle"
          :aria-label="mobileActionTitle"
          @click.stop="openMobileActionMenu"
        >
          <RiMore2Line class="h-4 w-4" />
        </IconButton>

        <OptionMenu
          :open="mobileActionMenuOpen"
          :query="mobileActionMenuQuery"
          :groups="mobileActionGroups"
          :title="mobileActionTitle"
          :mobile-title="mobileActionTitle"
          :searchable="true"
          :is-mobile-pointer="isMobilePointer"
          @update:open="setMobileActionMenuOpen"
          @update:query="(v) => (mobileActionMenuQuery = v)"
          @select="onMobileActionSelect"
        />
      </template>

      <slot v-else name="actions" />
    </template>
  </SidebarListItem>
</template>
