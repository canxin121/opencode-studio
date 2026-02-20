<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckLine,
  RiClipboardLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileTextLine,
  RiFileUploadLine,
  RiRestartLine,
  RiSettings3Line,
  RiStackLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import type { JsonValue } from '@/types/json'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    CodeMirrorEditor,
    RiAddLine,
    RiArrowDownLine,
    RiArrowUpLine,
    RiCheckLine,
    RiClipboardLine,
    RiCloseLine,
    RiDeleteBinLine,
    RiFileTextLine,
    RiFileUploadLine,
    RiRestartLine,
    RiSettings3Line,
    RiStackLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    const toolIdPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.toolIdOptions) ? ctx.toolIdOptions : []
      return list.map((id: string) => ({ value: id, label: id }))
    })

    const agentModePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'primary', label: 'primary' },
      { value: 'subagent', label: 'subagent' },
      { value: 'all', label: 'all' },
    ]

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

    // Vue template type-checking doesn't propagate the index signature through a spread.
    // Keep the injected ctx object shape and attach local computed helpers.
    return Object.assign(ctx, {
      modelPickerOptions,
      toolIdPickerOptions,
      agentModePickerOptions,
      permissionRulePickerOptions,
      permissionActionPickerOptions,
    })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-4">
    <div v-if="!selectedAgentId" class="text-sm text-muted-foreground">Select an agent from the list to edit.</div>

    <div v-for="[agentId, agent] in selectedAgentRows" :key="`agent-edit:${agentId}`" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="font-mono text-sm break-all">@{{ agentId }}</div>
          <div class="text-[11px] text-muted-foreground">Edit one agent at a time to keep UI responsive.</div>
        </div>
        <div class="flex items-center gap-2">
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Copy JSON"
              aria-label="Copy JSON"
              @click="copyEntryJson('agent', agentId)"
            >
              <RiClipboardLine class="h-4 w-4" />
            </Button>
            <template #content>Copy JSON</template>
          </Tooltip>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Import JSON"
              aria-label="Import JSON"
              @click="importEntryJson('agent', agentId)"
            >
              <RiFileUploadLine class="h-4 w-4" />
            </Button>
            <template #content>Import JSON</template>
          </Tooltip>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :title="showAgentAdvanced[agentId] ? 'Hide advanced' : 'Show advanced'"
              aria-label="Toggle advanced"
              @click="toggleAgentAdvanced(agentId)"
            >
              <RiSettings3Line class="h-4 w-4" />
            </Button>
            <template #content>{{ showAgentAdvanced[agentId] ? 'Hide advanced' : 'Show advanced' }}</template>
          </Tooltip>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove agent"
              @click="
                () => {
                  removeEntry('agent', agentId)
                  selectedAgentId = null
                }
              "
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'basics'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'basics'"
        >
          Basics
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'prompt'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'prompt'"
        >
          Prompt
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'permissions'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'permissions'"
        >
          Permissions
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'json'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'json'"
        >
          JSON
        </button>
      </div>

      <div v-if="agentEditorTab === 'basics'" class="space-y-4">
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Model</span>
            <OptionPicker
              :model-value="agent.model || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'model', String(v || '').trim())"
              :options="modelPickerOptions"
              title="Model"
              search-placeholder="Search models"
              empty-label="Default (inherit)"
              :icon="RiStackLine"
              allow-custom
              monospace
            />
            <span v-if="issueText(`agent.${agentId}.model`)" class="text-xs text-destructive">{{
              issueText(`agent.${agentId}.model`)
            }}</span>
            <span v-else-if="commandModelMeta(agent.model)" class="text-[11px] text-muted-foreground">
              {{ commandModelMeta(agent.model)?.name || '' }}{{ commandModelMeta(agent.model)?.name ? ' · ' : ''
              }}{{ formatModelMeta(commandModelMeta(agent.model)) }}
            </span>
            <span
              v-if="commandModelMeta(agent.model) && formatModelCost(commandModelMeta(agent.model))"
              class="text-[11px] text-muted-foreground"
            >
              {{ formatModelCost(commandModelMeta(agent.model)) }}
            </span>
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Variant</span>
            <Input
              :model-value="agent.variant || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'variant', String(v || '').trim())"
              placeholder="Default model variant"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Temperature</span>
            <input
              :value="agent.temperature ?? ''"
              @input="
                (e) =>
                  setEntryField('agent', agentId, 'temperature', parseNumberInput((e.target as HTMLInputElement).value))
              "
              type="number"
              step="0.01"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Top-p</span>
            <input
              :value="agent.top_p ?? ''"
              @input="
                (e) => setEntryField('agent', agentId, 'top_p', parseNumberInput((e.target as HTMLInputElement).value))
              "
              type="number"
              step="0.01"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Description</span>
            <Input
              :model-value="agent.description || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'description', v)"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Mode</span>
            <OptionPicker
              :model-value="agent.mode || 'default'"
              @update:model-value="
                (v) => setEntryField('agent', agentId, 'mode', String(v || '') === 'default' ? null : String(v || ''))
              "
              :options="agentModePickerOptions"
              title="Mode"
              search-placeholder="Search modes"
              :include-empty="false"
            />
            <span v-if="issuesForPathPrefix(`agent.${agentId}.hidden`).length" class="text-[11px] text-amber-600">
              {{ issuesForPathPrefix(`agent.${agentId}.hidden`)[0]?.message }}
            </span>
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Color</span>
            <Input
              :model-value="agent.color || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'color', v)"
              placeholder="#FF5733"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Steps</span>
            <input
              :value="agent.steps ?? ''"
              @input="
                (e) => setEntryField('agent', agentId, 'steps', parseNumberInput((e.target as HTMLInputElement).value))
              "
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <div class="flex flex-wrap gap-4">
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="agent.disable === true"
              @change="(e) => setEntryField('agent', agentId, 'disable', (e.target as HTMLInputElement).checked)"
            />
            Disabled
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="agent.hidden === true"
              @change="(e) => setEntryField('agent', agentId, 'hidden', (e.target as HTMLInputElement).checked)"
            />
            Hidden
          </label>
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'prompt'" class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">Prompt</span>
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Insert skeleton"
                aria-label="Insert skeleton"
                @click="insertAgentPromptSnippet(agentId, PROMPT_SKELETON)"
              >
                <RiFileTextLine class="h-4 w-4" />
              </Button>
              <template #content>Insert skeleton</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Insert frontmatter"
                aria-label="Insert frontmatter"
                @click="insertAgentPromptSnippet(agentId, FRONTMATTER_SKELETON)"
              >
                <RiFileTextLine class="h-4 w-4" />
              </Button>
              <template #content>Insert frontmatter</template>
            </Tooltip>
          </div>
        </div>
        <div class="h-56 rounded-md border border-input overflow-hidden">
          <CodeMirrorEditor
            :ref="(el) => setAgentPromptEditorRef(agentId, el)"
            :model-value="agent.prompt || ''"
            @update:model-value="(v) => setEntryField('agent', agentId, 'prompt', v)"
            :path="`agent/${agentId}.md`"
            :wrap="true"
          />
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'permissions'" class="space-y-4">
        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Permission overrides</div>
            <div class="text-[11px] text-muted-foreground">Unset keys inherit global permission.</div>
          </div>

          <div class="grid gap-3">
            <div class="flex items-center gap-2">
              <div class="min-w-[220px] flex-1 max-w-[520px]">
                <OptionPicker
                  v-model="agentPermissionNewTool[agentId]"
                  :options="toolIdPickerOptions"
                  title="Tool id"
                  search-placeholder="Search tools"
                  empty-label="Select tool id…"
                  monospace
                />
              </div>

              <div class="w-[160px]">
                <OptionPicker
                  v-model="agentPermissionNewAction[agentId]"
                  :options="permissionActionPickerOptions"
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
                  title="Add"
                  aria-label="Add permission rule"
                  @click="addAgentPermissionRule(agentId)"
                  :disabled="!String(agentPermissionNewTool[agentId] || '').trim()"
                >
                  <RiAddLine class="h-4 w-4" />
                </Button>
                <template #content>Add</template>
              </Tooltip>
            </div>

            <div class="grid gap-3">
              <div v-for="(group, gi) in permissionQuickGroups" :key="`apg:${agentId}:${gi}`" class="grid gap-3">
                <div class="grid gap-3 lg:grid-cols-3">
                  <label v-for="item in group" :key="`ap:${agentId}:${item.key}`" class="grid gap-1">
                    <span class="text-xs text-muted-foreground">{{ item.label }}</span>
                    <OptionPicker
                      :model-value="agentPermissionRuleValue(agentId, item.key, false)"
                      @update:model-value="(v) => onAgentPermissionSelectChange(agentId, item.key, String(v || ''))"
                      :options="permissionRulePickerOptions"
                      title="Permission"
                      search-placeholder="Search rules"
                      :include-empty="false"
                    />
                    <div class="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        class="text-[11px] text-muted-foreground hover:text-foreground"
                        @click="toggleAgentPermissionPatternEditor(agentId, item.key)"
                        :disabled="agentPermissionRuleValue(agentId, item.key, false) !== 'pattern'"
                      >
                        Edit patterns
                      </button>
                      <span
                        v-if="agentPermissionRuleValue(agentId, item.key, false) === 'pattern'"
                        class="text-[11px] text-muted-foreground"
                      >
                        {{ agentPermissionPatternCount(agentId, item.key, false) }} rules
                      </span>
                    </div>

                    <div
                      v-if="agentPermissionPatternEditors[`${agentId}::${item.key}`]?.open"
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
                              @click="addAgentPermissionPatternRow(agentId, item.key)"
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
                              @click="resetAgentPermissionPatternEditor(agentId, item.key)"
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
                              @click="toggleAgentPermissionPatternEditor(agentId, item.key)"
                            >
                              <RiCloseLine class="h-4 w-4" />
                            </Button>
                            <template #content>Close</template>
                          </Tooltip>
                        </div>
                      </div>

                      <div class="grid gap-2">
                        <div
                          v-for="(row, idx) in agentPermissionPatternEditors[`${agentId}::${item.key}`]?.entries || []"
                          :key="`apr:${agentId}:${item.key}:${idx}`"
                          class="grid gap-2 lg:grid-cols-[1fr_160px_auto] items-center"
                        >
                          <Input
                            v-model="row.pattern"
                            placeholder="**/*.ts"
                            class="font-mono"
                            @keydown="
                              onAgentPermissionPatternKeydown(agentId, item.key, idx, row, $event as KeyboardEvent)
                            "
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
                              @click="moveAgentPermissionPatternRow(agentId, item.key, idx, -1)"
                            >
                              <RiArrowUpLine class="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              class="h-8 w-8"
                              title="Move down"
                              aria-label="Move down"
                              @click="moveAgentPermissionPatternRow(agentId, item.key, idx, 1)"
                            >
                              <RiArrowDownLine class="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost-destructive"
                              class="h-8 w-8"
                              title="Remove"
                              aria-label="Remove"
                              @click="removeAgentPermissionPatternRow(agentId, item.key, idx)"
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
                            @click="applyAgentPermissionPatternEditor(agentId, item.key)"
                          >
                            <RiCheckLine class="h-4 w-4" />
                          </Button>
                          <template #content>Apply patterns</template>
                        </Tooltip>
                        <span
                          v-if="agentPermissionPatternEditors[`${agentId}::${item.key}`]?.error"
                          class="text-xs text-destructive"
                        >
                          {{ agentPermissionPatternEditors[`${agentId}::${item.key}`]?.error }}
                        </span>
                        <span v-else class="text-[11px] text-muted-foreground">Order matters (last match wins).</span>
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'json'" class="space-y-4">
        <div class="grid gap-2">
          <span class="text-xs text-muted-foreground">Options (JSON)</span>
          <textarea
            v-model="
              ensureJsonBuffer(
                `agent:${agentId}:options`,
                () => agent.options,
                (val: JsonValue) => setEntryField('agent', agentId, 'options', val),
                {},
              ).text
            "
            rows="6"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          />
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-8 w-8"
                title="Apply"
                aria-label="Apply JSON"
                @click="applyJsonBuffer(`agent:${agentId}:options`)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>Apply</template>
            </Tooltip>
            <span v-if="jsonBuffers[`agent:${agentId}:options`]?.error" class="text-xs text-destructive">{{
              jsonBuffers[`agent:${agentId}:options`]?.error
            }}</span>
          </div>
        </div>

        <div v-if="showAgentAdvanced[agentId]" class="grid gap-2">
          <span class="text-xs text-muted-foreground">Permission (advanced JSON)</span>
          <textarea
            v-model="
              ensureJsonBuffer(
                `agent:${agentId}:permission`,
                () => agent.permission,
                (val: JsonValue) => setEntryField('agent', agentId, 'permission', val),
                {},
              ).text
            "
            rows="6"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          />
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-8 w-8"
                title="Apply"
                aria-label="Apply JSON"
                @click="applyJsonBuffer(`agent:${agentId}:permission`)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>Apply</template>
            </Tooltip>
            <span v-if="jsonBuffers[`agent:${agentId}:permission`]?.error" class="text-xs text-destructive">{{
              jsonBuffers[`agent:${agentId}:permission`]?.error
            }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
