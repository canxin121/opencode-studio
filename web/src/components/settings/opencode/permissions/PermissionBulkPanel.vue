<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiCheckLine, RiListCheck3 } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import type { PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import StringListEditor from '../StringListEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    StringListEditor,
    Tooltip,
    RiCheckLine,
    RiListCheck3,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const toolPickerOptions = computed<PickerOption[]>(() => {
      const raw = ctx.toolIdOptions
      const list: string[] = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : []
      return list.map((id) => ({ value: String(id), label: String(id) }))
    })

    // Vue template type-checking doesn't propagate the index signature through a spread.
    return Object.assign(ctx, { toolPickerOptions })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">Bulk operations</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Action</span>
        <select v-model="permissionBulkAction" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="allow">allow</option>
          <option value="ask">ask</option>
          <option value="deny">deny</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Target</span>
        <select v-model="permissionBulkTarget" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="selection">selection</option>
          <option value="tag">by tag</option>
          <option value="all_known">all known tools</option>
          <option value="all_via_star">set * only</option>
        </select>
      </label>
      <label v-if="permissionBulkTarget === 'tag'" class="grid gap-1">
        <span class="text-xs text-muted-foreground">Tag</span>
        <select v-model="permissionBulkTag" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="filesystem">filesystem</option>
          <option value="exec">exec</option>
          <option value="network">network</option>
          <option value="other">other</option>
        </select>
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
