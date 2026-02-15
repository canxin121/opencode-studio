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
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
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
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">Custom tool rules</span>
    <div class="flex flex-wrap items-center gap-2">
      <select
        v-model="newPermissionTool"
        class="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">Select tool id…</option>
        <option v-for="id in toolIdOptions" :key="`perm-add:${id}`" :value="id">{{ id }}</option>
      </select>
      <select v-model="newPermissionAction" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="default">default</option>
        <option value="allow">allow</option>
        <option value="ask">ask</option>
        <option value="deny">deny</option>
      </select>
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
          <select
            :value="permissionRuleValue(key)"
            @change="(e) => onPermissionSelectChange(key, (e.target as HTMLSelectElement).value)"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="default">default</option>
            <option value="allow">allow</option>
            <option value="ask">ask</option>
            <option value="deny">deny</option>
            <option value="pattern">pattern map</option>
          </select>
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
              <select v-model="row.action" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="allow">allow</option>
                <option value="ask">ask</option>
                <option value="deny">deny</option>
              </select>
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
