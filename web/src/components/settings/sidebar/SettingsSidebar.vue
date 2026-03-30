<script setup lang="ts">
import { computed, ref } from 'vue'

import SettingsSidebarHeader from './SettingsSidebarHeader.vue'
import SettingsSidebarNavList from './SettingsSidebarNavList.vue'
import {
  buildSettingsSidebarGroups,
  normalizeSettingsSidebarQuery,
  type SettingsSidebarLeafItem,
  type SettingsSidebarTab,
  type SettingsTab,
} from './settingsSidebarNavigation'

const props = withDefaults(
  defineProps<{
    tabs?: SettingsSidebarTab[]
    activeTab: SettingsTab
    activeOpencodeSection?: string | null
    activePluginsSection?: string | null
    opencodeSections?: SettingsSidebarLeafItem[]
    plugins?: SettingsSidebarLeafItem[]
    loading?: boolean
    isTouchPointer?: boolean
  }>(),
  {
    tabs: () => [],
    activeOpencodeSection: null,
    activePluginsSection: null,
    opencodeSections: () => [],
    plugins: () => [],
    loading: false,
    isTouchPointer: false,
  },
)

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'navigate-tab', id: SettingsTab): void
  (e: 'navigate-opencode-section', id: string): void
  (e: 'navigate-plugins-section', id: string): void
}>()

const query = ref('')
const queryNorm = computed(() => normalizeSettingsSidebarQuery(query.value))

const groups = computed(() =>
  buildSettingsSidebarGroups({
    query: queryNorm.value,
    tabs: props.tabs,
    activeTab: props.activeTab,
    activeOpencodeSection: props.activeOpencodeSection,
    activePluginsSection: props.activePluginsSection,
    opencodeSections: props.opencodeSections,
    plugins: props.plugins,
  }),
)

const showPluginEmptyState = computed(
  () => !queryNorm.value && props.activeTab === 'plugins' && props.plugins.length === 0,
)

function setQuery(value: string) {
  query.value = String(value || '')
}

function submitQuery() {
  query.value = String(query.value || '')
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-sidebar">
    <SettingsSidebarHeader
      :query="query"
      :loading="loading"
      :is-touch-pointer="isTouchPointer"
      @update:query="setQuery"
      @submit-query="submitQuery"
      @refresh="emit('refresh')"
    />

    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
      <div class="flex min-h-full flex-col">
        <SettingsSidebarNavList
          :groups="groups"
          :query-active="queryNorm.length > 0"
          :show-plugin-empty-state="showPluginEmptyState"
          @navigate-tab="(id) => emit('navigate-tab', id)"
          @navigate-opencode-section="(id) => emit('navigate-opencode-section', id)"
          @navigate-plugins-section="(id) => emit('navigate-plugins-section', id)"
        />
      </div>
    </div>
  </div>
</template>
