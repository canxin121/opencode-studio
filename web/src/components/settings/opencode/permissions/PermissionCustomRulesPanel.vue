<script lang="ts">
import { computed, defineComponent } from 'vue'
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

    const toolIdPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.toolIdOptions) ? ctx.toolIdOptions : []
      return (list as string[]).map((id) => ({ value: id, label: id }))
    })

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

    const newPermissionActionPickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'allow', label: 'allow' },
      { value: 'ask', label: 'ask' },
      { value: 'deny', label: 'deny' },
    ]

    return Object.assign(ctx, {
      toolIdPickerOptions,
      permissionRulePickerOptions,
      permissionActionPickerOptions,
      newPermissionActionPickerOptions,
    })
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">Custom tool rules</span>
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-[220px] flex-1 max-w-[520px]">
        <OptionPicker
          v-model="newPermissionTool"
          :options="toolIdPickerOptions"
          title="Tool id"
          search-placeholder="Search tools"
          empty-label="Select tool id…"
          monospace
        />
      </div>
      <div class="w-[180px]">
        <OptionPicker
          v-model="newPermissionAction"
          :options="newPermissionActionPickerOptions"
          title="Action"
          search-placeholder="Search actions"
          :include-empty="false"
        />
      </div>
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-9 w-9"
          title="Add rule"
          aria-label="Add rule"
          @click="addCustomPermissionRule"
          :disabled="!newPermissionTool"
        >
          <RiAddLine class="h-4 w-4" />
        </Button>
        <template #content>Add rule</template>
      </Tooltip>
    </div>

    <div v-if="toolIdsError" class="text-[11px] text-muted-foreground break-all">
      Tool IDs unavailable: {{ toolIdsError }}
    </div>

    <div v-if="customPermissionKeys.length === 0" class="text-xs text-muted-foreground">
      No custom rules configured.
    </div>
    <div v-else class="grid gap-2">
      <div
        v-for="key in customPermissionKeys"
        :key="`perm:${key}`"
        class="rounded-md border border-border p-3 space-y-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs break-all">{{ key }}</span>
          <div class="w-[200px]">
            <OptionPicker
              :model-value="permissionRuleValue(key)"
              @update:model-value="(v) => onPermissionSelectChange(key, String(v || ''))"
              :options="permissionRulePickerOptions"
              title="Permission"
              search-placeholder="Search rules"
              :include-empty="false"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            @click="togglePermissionPatternEditor(key)"
            :disabled="permissionRuleValue(key) !== 'pattern'"
          >
            Edit patterns
          </Button>
          <span v-if="permissionRuleValue(key) === 'pattern'" class="text-[11px] text-muted-foreground"
            >{{ permissionPatternCount(key) }} rules</span
          >
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove rule"
              @click="setPermissionRule(key, 'default')"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>

        <div v-if="permissionPatternEditors[key]?.open" class="grid gap-2">
          <div class="flex items-center justify-between">
            <div class="text-xs text-muted-foreground">Pattern map</div>
            <div class="flex items-center gap-2">
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-8 w-8"
                  title="Add pattern"
                  aria-label="Add pattern"
                  @click="addPatternRow(key)"
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
                  @click="resetPermissionPatternEditor(key)"
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
                  @click="togglePermissionPatternEditor(key)"
                >
                  <RiCloseLine class="h-4 w-4" />
                </Button>
                <template #content>Close</template>
              </Tooltip>
            </div>
          </div>

          <div class="grid gap-2">
            <div
              v-for="(row, idx) in permissionPatternEditors[key]?.entries || []"
              :key="`row:${key}:${idx}`"
              class="grid gap-2 lg:grid-cols-[1fr_160px_auto] items-center"
            >
              <Input
                v-model="row.pattern"
                placeholder="**/*.ts"
                class="font-mono"
                @keydown="onPermissionPatternKeydown(key, idx, row, $event as KeyboardEvent)"
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
                  @click="movePatternRow(key, idx, -1)"
                >
                  <RiArrowUpLine class="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  title="Move down"
                  aria-label="Move down"
                  @click="movePatternRow(key, idx, 1)"
                >
                  <RiArrowDownLine class="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost-destructive"
                  class="h-8 w-8"
                  title="Remove"
                  aria-label="Remove"
                  @click="removePatternRow(key, idx)"
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
                @click="applyPermissionPatternEditor(key)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>Apply patterns</template>
            </Tooltip>
            <span v-if="permissionPatternEditors[key]?.error" class="text-xs text-destructive">{{
              permissionPatternEditors[key]?.error
            }}</span>
            <span v-else class="text-[11px] text-muted-foreground">Order matters (last match wins).</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
