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

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    const toolIdPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.toolIdOptions) ? ctx.toolIdOptions : []
      return list.map((id: string) => ({ value: id, label: id }))
    })

    const agentModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.agents.editor.modeOptions.default') },
      { value: 'primary', label: t('settings.opencodeConfig.sections.agents.editor.modeOptions.primary') },
      { value: 'subagent', label: t('settings.opencodeConfig.sections.agents.editor.modeOptions.subagent') },
      { value: 'all', label: t('settings.opencodeConfig.sections.agents.editor.modeOptions.all') },
    ])

    const permissionRulePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.permissions.rules.options.default') },
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.rules.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.rules.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.rules.options.deny') },
      { value: 'pattern', label: t('settings.opencodeConfig.sections.permissions.rules.options.patternMap') },
    ])

    const permissionActionPickerOptions = computed<PickerOption[]>(() => [
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.rules.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.rules.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.rules.options.deny') },
    ])

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
    <div v-if="!selectedAgentId" class="text-sm text-muted-foreground">
      {{ t('settings.opencodeConfig.sections.agents.editor.empty') }}
    </div>

    <div v-for="[agentId, agent] in selectedAgentRows" :key="`agent-edit:${agentId}`" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-mono text-sm break-all">@{{ agentId }}</div>
            <div class="text-[11px] text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.help.singleEdit') }}</div>
          </div>
        <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.agents.editor.actions.copyJson')"
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.actions.copyJson')"
                @click="copyEntryJson('agent', agentId)"
              >
                <RiClipboardLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.agents.editor.actions.copyJson') }}</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.agents.editor.actions.importJson')"
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.actions.importJson')"
                @click="importEntryJson('agent', agentId)"
              >
                <RiFileUploadLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.agents.editor.actions.importJson') }}</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="
                  showAgentAdvanced[agentId]
                    ? t('settings.opencodeConfig.sections.agents.editor.actions.hideAdvanced')
                    : t('settings.opencodeConfig.sections.agents.editor.actions.showAdvanced')
                "
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.actions.toggleAdvancedAria')"
                @click="toggleAgentAdvanced(agentId)"
              >
                <RiSettings3Line class="h-4 w-4" />
              </Button>
              <template #content>{{
                showAgentAdvanced[agentId]
                  ? t('settings.opencodeConfig.sections.agents.editor.actions.hideAdvanced')
                  : t('settings.opencodeConfig.sections.agents.editor.actions.showAdvanced')
              }}</template>
            </Tooltip>
          <Tooltip>
            <Button
              size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.actions.removeAgentAria')"
                @click="
                  () => {
                    removeEntry('agent', agentId)
                    selectedAgentId = null
                  }
              "
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('common.remove') }}</template>
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
          {{ t('settings.opencodeConfig.sections.agents.editor.tabs.basics') }}
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
          {{ t('settings.opencodeConfig.sections.agents.editor.tabs.prompt') }}
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
          {{ t('settings.opencodeConfig.sections.agents.editor.tabs.permissions') }}
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
          {{ t('settings.opencodeConfig.sections.agents.editor.tabs.json') }}
        </button>
      </div>

      <div v-if="agentEditorTab === 'basics'" class="space-y-4">
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.model') }}</span>
            <OptionPicker
              :model-value="agent.model || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'model', String(v || '').trim())"
              :options="modelPickerOptions"
              :title="t('settings.opencodeConfig.sections.agents.editor.fields.model')"
              :search-placeholder="t('settings.opencodeConfig.sections.agents.editor.search.searchModels')"
              :empty-label="t('settings.opencodeConfig.sections.agents.editor.defaults.modelInherit')"
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
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.variant') }}</span>
            <Input
              :model-value="agent.variant || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'variant', String(v || '').trim())"
              :placeholder="t('settings.opencodeConfig.sections.agents.editor.placeholders.variant')"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.temperature') }}</span>
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
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.topP') }}</span>
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
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.description') }}</span>
            <Input
              :model-value="agent.description || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'description', v)"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.mode') }}</span>
            <OptionPicker
              :model-value="agent.mode || 'default'"
              @update:model-value="
                (v) => setEntryField('agent', agentId, 'mode', String(v || '') === 'default' ? null : String(v || ''))
              "
              :options="agentModePickerOptions"
              :title="t('settings.opencodeConfig.sections.agents.editor.fields.mode')"
              :search-placeholder="t('settings.opencodeConfig.sections.agents.editor.search.searchModes')"
              :include-empty="false"
            />
            <span v-if="issuesForPathPrefix(`agent.${agentId}.hidden`).length" class="text-[11px] text-amber-600">
              {{ issuesForPathPrefix(`agent.${agentId}.hidden`)[0]?.message }}
            </span>
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.color') }}</span>
            <Input
              :model-value="agent.color || ''"
              @update:model-value="(v) => setEntryField('agent', agentId, 'color', v)"
              :placeholder="t('settings.opencodeConfig.sections.agents.editor.placeholders.color')"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.fields.steps') }}</span>
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
            {{ t('settings.opencodeConfig.sections.agents.editor.toggles.disabled') }}
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="agent.hidden === true"
              @change="(e) => setEntryField('agent', agentId, 'hidden', (e.target as HTMLInputElement).checked)"
            />
            {{ t('settings.opencodeConfig.sections.agents.editor.toggles.hidden') }}
          </label>
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'prompt'" class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.tabs.prompt') }}</span>
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertSkeleton')"
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertSkeleton')"
                @click="insertAgentPromptSnippet(agentId, PROMPT_SKELETON)"
              >
                <RiFileTextLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertSkeleton') }}</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertFrontmatter')"
                :aria-label="t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertFrontmatter')"
                @click="insertAgentPromptSnippet(agentId, FRONTMATTER_SKELETON)"
              >
                <RiFileTextLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.agents.editor.prompt.actions.insertFrontmatter') }}</template>
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
            <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.agents.editor.permissions.title') }}</div>
            <div class="text-[11px] text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.permissions.help.inherit') }}</div>
          </div>

          <div class="grid gap-3">
            <div class="flex items-center gap-2">
              <div class="min-w-[220px] flex-1 max-w-[520px]">
                <OptionPicker
                  v-model="agentPermissionNewTool[agentId]"
                  :options="toolIdPickerOptions"
                  :title="t('settings.opencodeConfig.sections.permissions.customRules.fields.toolId')"
                  :search-placeholder="t('settings.opencodeConfig.sections.permissions.customRules.search.searchTools')"
                  :empty-label="t('settings.opencodeConfig.sections.permissions.customRules.placeholders.selectTool')"
                  monospace
                />
              </div>

              <div class="w-[160px]">
                <OptionPicker
                  v-model="agentPermissionNewAction[agentId]"
                  :options="permissionActionPickerOptions"
                  :title="t('settings.opencodeConfig.sections.permissions.customRules.fields.action')"
                  :search-placeholder="t('settings.opencodeConfig.sections.permissions.customRules.search.searchActions')"
                  :include-empty="false"
                />
              </div>
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-9 w-9"
                  :title="t('common.add')"
                  :aria-label="t('settings.opencodeConfig.sections.permissions.customRules.actions.addRule')"
                  @click="addAgentPermissionRule(agentId)"
                  :disabled="!String(agentPermissionNewTool[agentId] || '').trim()"
                >
                  <RiAddLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.add') }}</template>
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
                      :title="t('settings.opencodeConfig.sections.permissions.rules.fields.permission')"
                      :search-placeholder="t('settings.opencodeConfig.sections.permissions.rules.search.searchRules')"
                      :include-empty="false"
                    />
                    <div class="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        class="text-[11px] text-muted-foreground hover:text-foreground"
                        @click="toggleAgentPermissionPatternEditor(agentId, item.key)"
                        :disabled="agentPermissionRuleValue(agentId, item.key, false) !== 'pattern'"
                      >
                        {{ t('settings.opencodeConfig.sections.permissions.rules.actions.editPatterns') }}
                      </button>
                      <span
                        v-if="agentPermissionRuleValue(agentId, item.key, false) === 'pattern'"
                        class="text-[11px] text-muted-foreground"
                      >
                        {{
                          t('settings.opencodeConfig.sections.permissions.rules.rulesCount', {
                            count: agentPermissionPatternCount(agentId, item.key, false),
                          })
                        }}
                      </span>
                    </div>

                    <div
                      v-if="agentPermissionPatternEditors[`${agentId}::${item.key}`]?.open"
                      class="mt-2 rounded-md border border-border p-3 space-y-2"
                    >
                      <div class="flex items-center justify-between">
                        <div class="font-mono text-xs break-all">
                          {{ t('settings.opencodeConfig.sections.permissions.rules.patternMapTitle', { key: item.key }) }}
                        </div>
                        <div class="flex items-center gap-2">
                          <Tooltip>
                            <Button
                              size="icon"
                              variant="outline"
                              class="h-8 w-8"
                              :title="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                              :aria-label="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                              @click="addAgentPermissionPatternRow(agentId, item.key)"
                            >
                              <RiAddLine class="h-4 w-4" />
                            </Button>
                            <template #content>{{ t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern') }}</template>
                          </Tooltip>
                          <Tooltip>
                            <Button
                              size="icon"
                              variant="ghost"
                              class="h-8 w-8"
                              :title="t('common.reset')"
                              :aria-label="t('common.reset')"
                              @click="resetAgentPermissionPatternEditor(agentId, item.key)"
                            >
                              <RiRestartLine class="h-4 w-4" />
                            </Button>
                            <template #content>{{ t('common.reset') }}</template>
                          </Tooltip>
                          <Tooltip>
                            <Button
                              size="icon"
                              variant="ghost"
                              class="h-8 w-8"
                              :title="t('common.close')"
                              :aria-label="t('common.close')"
                              @click="toggleAgentPermissionPatternEditor(agentId, item.key)"
                            >
                              <RiCloseLine class="h-4 w-4" />
                            </Button>
                            <template #content>{{ t('common.close') }}</template>
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
                            :placeholder="t('settings.opencodeConfig.sections.permissions.rules.placeholders.pattern')"
                            class="font-mono"
                            @keydown="
                              onAgentPermissionPatternKeydown(agentId, item.key, idx, row, $event as KeyboardEvent)
                            "
                          />
                          <OptionPicker
                            v-model="row.action"
                            :options="permissionActionPickerOptions"
                            :title="t('settings.opencodeConfig.sections.permissions.rules.fields.action')"
                            :search-placeholder="t('settings.opencodeConfig.sections.permissions.rules.search.searchActions')"
                            :include-empty="false"
                          />
                          <div class="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              class="h-8 w-8"
                              :title="t('common.moveUp')"
                              :aria-label="t('common.moveUp')"
                              @click="moveAgentPermissionPatternRow(agentId, item.key, idx, -1)"
                            >
                              <RiArrowUpLine class="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              class="h-8 w-8"
                              :title="t('common.moveDown')"
                              :aria-label="t('common.moveDown')"
                              @click="moveAgentPermissionPatternRow(agentId, item.key, idx, 1)"
                            >
                              <RiArrowDownLine class="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost-destructive"
                              class="h-8 w-8"
                              :title="t('common.remove')"
                              :aria-label="t('common.remove')"
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
                            :title="t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns')"
                            :aria-label="t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns')"
                            @click="applyAgentPermissionPatternEditor(agentId, item.key)"
                          >
                            <RiCheckLine class="h-4 w-4" />
                          </Button>
                          <template #content>{{ t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns') }}</template>
                        </Tooltip>
                        <span
                          v-if="agentPermissionPatternEditors[`${agentId}::${item.key}`]?.error"
                          class="text-xs text-destructive"
                        >
                          {{ agentPermissionPatternEditors[`${agentId}::${item.key}`]?.error }}
                        </span>
                        <span v-else class="text-[11px] text-muted-foreground">{{
                          t('settings.opencodeConfig.sections.permissions.rules.help.orderMatters')
                        }}</span>
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
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.agents.editor.json.optionsTitle') }}</span>
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
                :title="t('common.apply')"
                :aria-label="t('settings.opencodeConfig.sections.common.applyJson')"
                @click="applyJsonBuffer(`agent:${agentId}:options`)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.apply') }}</template>
            </Tooltip>
            <span v-if="jsonBuffers[`agent:${agentId}:options`]?.error" class="text-xs text-destructive">{{
              jsonBuffers[`agent:${agentId}:options`]?.error
            }}</span>
          </div>
        </div>

        <div v-if="showAgentAdvanced[agentId]" class="grid gap-2">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.agents.editor.json.permissionAdvancedTitle')
          }}</span>
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
                :title="t('common.apply')"
                :aria-label="t('settings.opencodeConfig.sections.common.applyJson')"
                @click="applyJsonBuffer(`agent:${agentId}:permission`)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.apply') }}</template>
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
