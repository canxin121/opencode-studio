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

    const permissionBulkActionPickerOptions: OptionPickerOption[] = [
      { value: 'allow', label: 'allow' },
      { value: 'ask', label: 'ask' },
      { value: 'deny', label: 'deny' },
    ]

    const permissionBulkTargetPickerOptions: OptionPickerOption[] = [
      { value: 'selection', label: 'selection' },
      { value: 'tag', label: 'by tag' },
      { value: 'all_known', label: 'all known tools' },
      { value: 'all_via_star', label: 'set * only' },
    ]

    const permissionBulkTagPickerOptions: OptionPickerOption[] = [
      { value: 'filesystem', label: 'filesystem' },
      { value: 'exec', label: 'exec' },
      { value: 'network', label: 'network' },
      { value: 'other', label: 'other' },
    ]

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
    <div class="text-sm font-semibold">Bulk operations</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Action</span>
        <OptionPicker
          v-model="permissionBulkAction"
          :options="permissionBulkActionPickerOptions"
          title="Action"
          search-placeholder="Search actions"
          :include-empty="false"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Target</span>
        <OptionPicker
          v-model="permissionBulkTarget"
          :options="permissionBulkTargetPickerOptions"
          title="Target"
          search-placeholder="Search targets"
          :include-empty="false"
        />
      </label>
      <label v-if="permissionBulkTarget === 'tag'" class="grid gap-1">
        <span class="text-xs text-muted-foreground">Tag</span>
        <OptionPicker
          v-model="permissionBulkTag"
          :options="permissionBulkTagPickerOptions"
          title="Tag"
          search-placeholder="Search tags"
          :include-empty="false"
        />
      </label>
      <label v-else class="grid gap-1">
        <span class="text-xs text-muted-foreground">Clear others</span>
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="permissionBulkClearOthers" />
          Clear non-target keys
        </label>
      </label>
    </div>

    <div v-if="permissionBulkTarget === 'selection'" class="grid gap-2">
      <div class="text-xs text-muted-foreground">Selection</div>
      <StringListEditor
        :model-value="permissionBulkSelection"
        :suggestions="toolPickerOptions"
        panel-title="Tools"
        placeholder="Add tool ids (paste supported)"
        empty-text="None selected"
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
            title="Select all"
            aria-label="Select all"
            @click="permissionBulkSelection = toolIdOptions"
          >
            <RiListCheck3 class="h-4 w-4" />
          </Button>
          <template #content>All</template>
        </Tooltip>
        <span class="text-[11px] text-muted-foreground">{{ permissionBulkSelection.length }} selected</span>
      </div>
    </div>

    <div v-if="permissionBulkTarget === 'tag'" class="flex items-center gap-2 text-xs">
      <Button size="sm" variant="outline" @click="selectPermissionBulkByTag(permissionBulkTag)"
        >Select tools by tag</Button
      >
      <span class="text-muted-foreground">{{ toolIdsByTag[permissionBulkTag].length }} tools</span>
    </div>

    <div class="flex items-center gap-2">
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-8 w-8"
          title="Apply bulk"
          aria-label="Apply bulk"
          @click="applyPermissionBulk"
        >
          <RiCheckLine class="h-4 w-4" />
        </Button>
        <template #content>Apply bulk</template>
      </Tooltip>
      <span class="text-[11px] text-muted-foreground"
        >Bulk uses string rules; pattern maps are left intact unless overwritten.</span
      >
    </div>
  </div>
</template>
