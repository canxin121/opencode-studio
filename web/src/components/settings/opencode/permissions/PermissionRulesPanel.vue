<script lang="ts">
import { defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiRestartLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    RiAddLine,
    RiArrowDownLine,
    RiArrowUpLine,
    RiCheckLine,
    RiCloseLine,
    RiDeleteBinLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const permissionRulePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'allow', label: 'allow' },
      { value: 'ask', label: 'ask' },
      { value: 'deny', label: 'deny' },
      { value: 'pattern', label: 'pattern map' },
    ]

    const permissionActionPickerOptions: PickerOption[] = [
      { value: 'allow', label: 'allow' },
      { value: 'ask', label: 'ask' },
      { value: 'deny', label: 'deny' },
    ]

    return Object.assign(ctx, { permissionRulePickerOptions, permissionActionPickerOptions })
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">Global permission rules</span>
    <div v-for="(group, gi) in permissionQuickGroups" :key="`perm-group:${gi}`" class="grid gap-3">
      <div class="grid gap-3 lg:grid-cols-3">
        <label v-for="item in group" :key="`perm:${item.key}`" class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ item.label }}</span>
          <OptionPicker
            :model-value="permissionRuleValue(item.key)"
            @update:model-value="(v) => onPermissionSelectChange(item.key, String(v || ''))"
            :options="permissionRulePickerOptions"
            title="Permission"
            search-placeholder="Search rules"
            :include-empty="false"
          />
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="text-[11px] text-muted-foreground hover:text-foreground"
              @click="togglePermissionPatternEditor(item.key)"
              :disabled="permissionRuleValue(item.key) !== 'pattern'"
            >
              Edit patterns
            </button>
            <span v-if="permissionRuleValue(item.key) === 'pattern'" class="text-[11px] text-muted-foreground"
              >{{ permissionPatternCount(item.key) }} rules</span
            >
          </div>

          <div
            v-if="permissionPatternEditors[item.key]?.open"
            class="mt-2 rounded-md border border-border p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <div class="font-mono text-xs break-all">{{ item.key }} pattern map</div>
              <div class="flex items-center gap-2">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-8 w-8"
                    title="Add pattern"
                    aria-label="Add pattern"
                    @click="addPatternRow(item.key)"
                  >
                    <RiAddLine class="h-4 w-4" />
                  </Button>
                  <template #content>Add pattern</template>
                </Tooltip>
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    title="Reset"
                    aria-label="Reset"
                    @click="resetPermissionPatternEditor(item.key)"
                  >
                    <RiRestartLine class="h-4 w-4" />
                  </Button>
                  <template #content>Reset</template>
                </Tooltip>
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    title="Close"
                    aria-label="Close"
                    @click="togglePermissionPatternEditor(item.key)"
                  >
                    <RiCloseLine class="h-4 w-4" />
                  </Button>
                  <template #content>Close</template>
                </Tooltip>
              </div>
            </div>

            <div class="grid gap-2">
              <div
                v-for="(row, idx) in permissionPatternEditors[item.key]?.entries || []"
                :key="`row:${item.key}:${idx}`"
                class="grid gap-2 lg:grid-cols-[1fr_160px_auto] items-center"
              >
                <Input
                  v-model="row.pattern"
                  placeholder="**/*.ts"
                  class="font-mono"
                  @keydown="onPermissionPatternKeydown(item.key, idx, row, $event as KeyboardEvent)"
                />
                <OptionPicker
                  v-model="row.action"
                  :options="permissionActionPickerOptions"
                  title="Action"
                  search-placeholder="Search actions"
                  :include-empty="false"
                />
                <div class="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    title="Move up"
                    aria-label="Move up"
                    @click="movePatternRow(item.key, idx, -1)"
                  >
                    <RiArrowUpLine class="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    title="Move down"
                    aria-label="Move down"
                    @click="movePatternRow(item.key, idx, 1)"
                  >
                    <RiArrowDownLine class="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost-destructive"
                    class="h-8 w-8"
                    title="Remove"
                    aria-label="Remove"
                    @click="removePatternRow(item.key, idx)"
                  >
                    <RiDeleteBinLine class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-8 w-8"
                  title="Apply patterns"
                  aria-label="Apply patterns"
                  @click="applyPermissionPatternEditor(item.key)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply patterns</template>
              </Tooltip>
              <span v-if="permissionPatternEditors[item.key]?.error" class="text-xs text-destructive">{{
                permissionPatternEditors[item.key]?.error
              }}</span>
              <span v-else class="text-[11px] text-muted-foreground">Order matters (last match wins).</span>
            </div>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>
