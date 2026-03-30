<script setup lang="ts">
import { computed } from 'vue'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiGlobalLine,
  RiPaletteLine,
  RiPlugLine,
  RiSettings3Line,
  RiTerminalBoxLine,
} from '@remixicon/vue'

import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import type { SettingsSidebarIconKey } from './settingsSidebarNavigation'

const props = withDefaults(
  defineProps<{
    label: string
    active?: boolean
    icon?: SettingsSidebarIconKey | 'section'
    depth?: number
    expandable?: boolean
    expanded?: boolean
    meta?: string | number | null
    density?: 'default' | 'compact'
  }>(),
  {
    active: false,
    icon: 'section',
    depth: 0,
    expandable: false,
    expanded: false,
    meta: null,
    density: 'default',
  },
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const topLevelIcon = computed(() => {
  if (props.icon === 'plugins') return RiPlugLine
  if (props.icon === 'backends') return RiGlobalLine
  if (props.icon === 'appearance') return RiPaletteLine
  if (props.icon === 'debug') return RiTerminalBoxLine
  return RiSettings3Line
})

const childIndent = computed(() => (props.depth > 0 ? 28 : undefined))
const hasMeta = computed(() => props.meta !== null && String(props.meta).trim().length > 0)
</script>

<template>
  <SidebarListItem
    :active="active"
    :indent="childIndent"
    :density="density"
    class="gap-1.5"
    @click="emit('click', $event)"
  >
    <template #icon>
      <div v-if="depth === 0" class="flex items-center gap-1.5">
        <span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground/70">
          <RiArrowDownSLine v-if="expandable && expanded" class="h-3.5 w-3.5" />
          <RiArrowRightSLine v-else-if="expandable" class="h-3.5 w-3.5" />
          <span v-else class="block h-3.5 w-3.5" />
        </span>

        <component :is="topLevelIcon" class="h-4 w-4" :class="active ? 'text-primary' : 'text-muted-foreground/80'" />
      </div>

      <div v-else class="flex items-center justify-center pl-1">
        <span class="inline-flex h-1.5 w-1.5 rounded-full" :class="active ? 'bg-primary' : 'bg-muted-foreground/30'" />
      </div>
    </template>

    <div class="flex min-w-0 flex-col justify-center gap-0.5 py-px">
      <div
        class="typography-ui-label min-w-0 truncate leading-[1.4]"
        :class="active ? 'text-foreground' : 'text-foreground/90'"
      >
        {{ label }}
      </div>
    </div>

    <template v-if="hasMeta" #meta>
      <span
        class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-foreground/75"
      >
        {{ meta }}
      </span>
    </template>
  </SidebarListItem>
</template>
