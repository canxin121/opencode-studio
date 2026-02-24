<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiCheckLine, RiListCheck3 } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import type { PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import OptionPicker, { type PickerOption as OptionPickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import StringListEditor from '../StringListEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    OptionPicker,
    StringListEditor,
    Tooltip,
    RiCheckLine,
    RiListCheck3,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    const permissionBulkActionPickerOptions = computed<OptionPickerOption[]>(() => [
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.bulk.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.bulk.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.bulk.options.deny') },
    ])

    const permissionBulkTargetPickerOptions = computed<OptionPickerOption[]>(() => [
      { value: 'selection', label: t('settings.opencodeConfig.sections.permissions.bulk.options.targetSelection') },
      { value: 'tag', label: t('settings.opencodeConfig.sections.permissions.bulk.options.targetByTag') },
      { value: 'all_known', label: t('settings.opencodeConfig.sections.permissions.bulk.options.targetAllKnown') },
      { value: 'all_via_star', label: t('settings.opencodeConfig.sections.permissions.bulk.options.targetStarOnly') },
    ])

    const permissionBulkTagPickerOptions = computed<OptionPickerOption[]>(() => [
      { value: 'filesystem', label: t('settings.opencodeConfig.sections.permissions.bulk.options.tagFilesystem') },
      { value: 'exec', label: t('settings.opencodeConfig.sections.permissions.bulk.options.tagExec') },
      { value: 'network', label: t('settings.opencodeConfig.sections.permissions.bulk.options.tagNetwork') },
      { value: 'other', label: t('settings.opencodeConfig.sections.permissions.bulk.options.tagOther') },
    ])

    const toolPickerOptions = computed<PickerOption[]>(() => {
      const raw = ctx.toolIdOptions
      const list: string[] = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : []
      return list.map((id) => ({ value: String(id), label: String(id) }))
    })

    // Vue template type-checking doesn't propagate the index signature through a spread.
    return Object.assign(ctx, {
      toolPickerOptions,
      permissionBulkActionPickerOptions,
      permissionBulkTargetPickerOptions,
      permissionBulkTagPickerOptions,
    })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.permissions.bulk.title') }}</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.fields.action') }}</span>
        <OptionPicker
          v-model="permissionBulkAction"
          :options="permissionBulkActionPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.bulk.fields.action')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.bulk.search.searchActions')"
          :include-empty="false"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.fields.target') }}</span>
        <OptionPicker
          v-model="permissionBulkTarget"
          :options="permissionBulkTargetPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.bulk.fields.target')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.bulk.search.searchTargets')"
          :include-empty="false"
        />
      </label>
      <label v-if="permissionBulkTarget === 'tag'" class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.fields.tag') }}</span>
        <OptionPicker
          v-model="permissionBulkTag"
          :options="permissionBulkTagPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.bulk.fields.tag')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.bulk.search.searchTags')"
          :include-empty="false"
        />
      </label>
      <label v-else class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.fields.clearOthers') }}</span>
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="permissionBulkClearOthers" />
          {{ t('settings.opencodeConfig.sections.permissions.bulk.fields.clearNonTargetKeys') }}
        </label>
      </label>
    </div>

    <div v-if="permissionBulkTarget === 'selection'" class="grid gap-2">
      <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.fields.selection') }}</div>
      <StringListEditor
        :model-value="permissionBulkSelection"
        :suggestions="toolPickerOptions"
        :panel-title="t('settings.opencodeConfig.sections.permissions.bulk.picker.panelTitle')"
        :placeholder="t('settings.opencodeConfig.sections.permissions.bulk.picker.placeholder')"
        :empty-text="t('settings.opencodeConfig.sections.permissions.bulk.picker.emptyText')"
        :show-advanced-toggle="false"
        split-mode="tags"
        @update:model-value="(v) => (permissionBulkSelection = v)"
      />
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-9 w-9"
            :title="t('common.selectAll')"
            :aria-label="t('common.selectAll')"
            @click="permissionBulkSelection = toolIdOptions"
          >
            <RiListCheck3 class="h-4 w-4" />
          </Button>
          <template #content>{{ t('common.all') }}</template>
        </Tooltip>
        <span class="text-[11px] text-muted-foreground">{{
          t('settings.opencodeConfig.sections.permissions.bulk.selectionCount', { count: permissionBulkSelection.length })
        }}</span>
      </div>
    </div>

    <div v-if="permissionBulkTarget === 'tag'" class="flex items-center gap-2 text-xs">
      <Button size="sm" variant="outline" @click="selectPermissionBulkByTag(permissionBulkTag)"
        >{{ t('settings.opencodeConfig.sections.permissions.bulk.actions.selectByTag') }}</Button
      >
      <span class="text-muted-foreground">{{
        t('settings.opencodeConfig.sections.permissions.bulk.toolsCount', { count: toolIdsByTag[permissionBulkTag].length })
      }}</span>
    </div>

    <div class="flex items-center gap-2">
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-8 w-8"
          :title="t('settings.opencodeConfig.sections.permissions.bulk.actions.applyBulk')"
          :aria-label="t('settings.opencodeConfig.sections.permissions.bulk.actions.applyBulk')"
          @click="applyPermissionBulk"
        >
          <RiCheckLine class="h-4 w-4" />
        </Button>
        <template #content>{{ t('settings.opencodeConfig.sections.permissions.bulk.actions.applyBulk') }}</template>
      </Tooltip>
      <span class="text-[11px] text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.bulk.help') }}</span>
    </div>
  </div>
</template>
