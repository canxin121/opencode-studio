<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsSidebarNavRow from './SettingsSidebarNavRow.vue'
import type { SettingsSidebarRenderGroup, SettingsTab } from './settingsSidebarNavigation'

const props = withDefaults(
  defineProps<{
    groups?: SettingsSidebarRenderGroup[]
    queryActive?: boolean
    showPluginEmptyState?: boolean
  }>(),
  {
    groups: () => [],
    queryActive: false,
    showPluginEmptyState: false,
  },
)

const emit = defineEmits<{
  (e: 'navigate-tab', id: SettingsTab): void
  (e: 'navigate-opencode-section', id: string): void
  (e: 'navigate-plugins-section', id: string): void
}>()

const { t } = useI18n()

const visibleGroups = computed(() => props.groups.filter((group) => group.items.length > 0))
const hasRows = computed(() => visibleGroups.value.length > 0)
</script>

<template>
  <div class="min-h-0 overflow-x-hidden">
    <div v-if="!hasRows" class="px-4 py-8 text-center text-muted-foreground">
      <div class="typography-ui-label font-semibold">{{ t('common.noOptionsFound') }}</div>
    </div>

    <div v-else class="space-y-2 pb-2 pl-2 pr-1">
      <div v-for="(group, groupIndex) in visibleGroups" :key="group.id">
        <div v-if="groupIndex > 0" class="mx-1 my-2 border-t border-sidebar-border/60" />

        <div class="space-y-0.5">
          <div v-for="row in group.items" :key="row.id">
            <SettingsSidebarNavRow
              :label="row.label"
              :active="row.active"
              :icon="row.icon"
              :expandable="row.expandable"
              :expanded="row.expanded"
              :meta="row.expandable ? (queryActive ? row.childMatchCount : row.childCount) : null"
              @click="emit('navigate-tab', row.id)"
            />

            <div
              v-if="showPluginEmptyState && row.id === 'plugins' && row.active"
              class="ml-10 mr-2 mt-1 rounded-md border border-sidebar-border/60 bg-muted/10 px-2.5 py-2 text-xs text-muted-foreground"
            >
              {{ t('settings.emptyPlugins') }}
            </div>

            <div v-for="child in row.children" :key="`${row.id}:${child.id}`" class="mt-0.5">
              <SettingsSidebarNavRow
                :label="child.label"
                :active="child.active"
                icon="section"
                :depth="1"
                density="compact"
                @click="
                  child.kind === 'opencode-section'
                    ? emit('navigate-opencode-section', child.id)
                    : emit('navigate-plugins-section', child.id)
                "
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
