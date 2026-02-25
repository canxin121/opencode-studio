<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiClipboardLine,
  RiDeleteBinLine,
  RiFileTextLine,
  RiFileUploadLine,
  RiRestartLine,
  RiStackLine,
  RiUserLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import type { JsonValue } from '@/types/json'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiClipboardLine,
    RiDeleteBinLine,
    RiFileTextLine,
    RiFileUploadLine,
    RiRestartLine,
    RiStackLine,
    RiUserLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    function normalizeAgentName(raw: string): string {
      let v = String(raw || '').trim()
      if (v.startsWith('@')) v = v.slice(1).trim()
      return v
    }

    const agentNamePickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.agentOptions) ? ctx.agentOptions : []
      return list
        .map((a) => {
          const agent = a && typeof a === 'object' ? (a as Record<string, JsonValue>) : null
          const name = String(agent?.name || '').trim()
          if (!name) return null
          return {
            value: name,
            label: name,
            description: typeof agent?.description === 'string' ? agent.description : undefined,
          } satisfies PickerOption
        })
        .filter(Boolean) as PickerOption[]
    })

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    return Object.assign(ctx, { normalizeAgentName, agentNamePickerOptions, modelPickerOptions })
  },
})
</script>

<template>
  <section id="commands" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.commands.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('commands')"
          >
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.common.resetSection') }}</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="
              isSectionOpen('commands')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('commands')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('commands')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('commands')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('commands')" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="newCommandName"
          :placeholder="t('settings.opencodeConfig.sections.commands.placeholders.commandName')"
          class="max-w-xs"
        />
        <Input
          v-model="newCommandTemplate"
          :placeholder="t('settings.opencodeConfig.sections.commands.placeholders.template')"
          class="min-w-[260px]"
        />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :title="t('settings.opencodeConfig.sections.commands.actions.addCommand')"
            :aria-label="t('settings.opencodeConfig.sections.commands.actions.addCommandAria')"
            @click="addCommand"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.commands.actions.addCommand') }}</template>
        </Tooltip>
      </div>
      <Input
        v-model="commandFilter"
        :placeholder="t('settings.opencodeConfig.sections.commands.placeholders.filterCommands')"
        class="max-w-sm"
      />
      <div v-if="filteredCommandsList.length === 0" class="text-xs text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.commands.empty.noCommands') }}
      </div>
      <div
        v-for="[commandId, command] in filteredCommandsList"
        :key="commandId"
        class="rounded-md border border-border p-3 space-y-3"
      >
        <div class="flex items-center justify-between">
          <div class="font-mono text-sm break-all">/{{ commandId }}</div>
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.commands.actions.copyJson')"
                :aria-label="t('settings.opencodeConfig.sections.commands.actions.copyJson')"
                @click="copyEntryJson('command', commandId)"
              >
                <RiClipboardLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.commands.actions.copyJson') }}</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.commands.actions.importJson')"
                :aria-label="t('settings.opencodeConfig.sections.commands.actions.importJson')"
                @click="importEntryJson('command', commandId)"
              >
                <RiFileUploadLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('settings.opencodeConfig.sections.commands.actions.importJson') }}</template>
            </Tooltip>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('settings.opencodeConfig.sections.commands.actions.removeCommandAria')"
                @click="removeEntry('command', commandId)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.remove') }}</template>
            </Tooltip>
          </div>
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.commands.fields.template')
              }}</span>
              <div class="flex items-center gap-2">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('settings.opencodeConfig.sections.commands.actions.insertSkeleton')"
                    :aria-label="t('settings.opencodeConfig.sections.commands.actions.insertSkeleton')"
                    @click="insertCommandSnippet(commandId, PROMPT_SKELETON)"
                  >
                    <RiFileTextLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{
                    t('settings.opencodeConfig.sections.commands.actions.insertSkeleton')
                  }}</template>
                </Tooltip>
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('settings.opencodeConfig.sections.commands.actions.insertFrontmatter')"
                    :aria-label="t('settings.opencodeConfig.sections.commands.actions.insertFrontmatter')"
                    @click="insertCommandSnippet(commandId, FRONTMATTER_SKELETON)"
                  >
                    <RiFileTextLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{
                    t('settings.opencodeConfig.sections.commands.actions.insertFrontmatter')
                  }}</template>
                </Tooltip>
              </div>
            </div>
            <div class="h-40 rounded-md border border-input overflow-hidden">
              <CodeMirrorEditor
                :ref="(el) => setCommandEditorRef(commandId, el)"
                :model-value="command.template || ''"
                @update:model-value="(v) => setEntryField('command', commandId, 'template', v)"
                :path="`command/${commandId}.md`"
                :wrap="true"
              />
            </div>
            <span v-if="issueText(`command.${commandId}.template`)" class="text-xs text-destructive">{{
              issueText(`command.${commandId}.template`)
            }}</span>
          </div>
          <div class="grid gap-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.commands.fields.description')
              }}</span>
              <Input
                :model-value="command.description || ''"
                @update:model-value="(v) => setEntryField('command', commandId, 'description', v)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.commands.fields.agent')
              }}</span>
              <OptionPicker
                :model-value="command.agent || ''"
                @update:model-value="(v) => setEntryField('command', commandId, 'agent', normalizeAgentName(v))"
                :options="agentNamePickerOptions"
                :title="t('settings.opencodeConfig.sections.commands.fields.agent')"
                :search-placeholder="t('settings.opencodeConfig.sections.commands.search.searchAgents')"
                :empty-label="t('settings.opencodeConfig.sections.commands.defaults.useConfigDefault')"
                :icon="RiUserLine"
                allow-custom
              />
              <span class="text-[11px] text-muted-foreground">{{
                t('settings.opencodeConfig.sections.commands.help.agentName')
              }}</span>
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.commands.fields.model')
              }}</span>
              <OptionPicker
                :model-value="command.model || ''"
                @update:model-value="(v) => setEntryField('command', commandId, 'model', String(v || '').trim())"
                :options="modelPickerOptions"
                :title="t('settings.opencodeConfig.sections.commands.fields.model')"
                :search-placeholder="t('settings.opencodeConfig.sections.commands.search.searchModels')"
                :empty-label="t('settings.opencodeConfig.sections.commands.defaults.useConfigDefault')"
                :icon="RiStackLine"
                allow-custom
                monospace
              />
              <span v-if="issueText(`command.${commandId}.model`)" class="text-xs text-destructive">{{
                issueText(`command.${commandId}.model`)
              }}</span>
              <span v-else-if="commandModelMeta(command.model)" class="text-[11px] text-muted-foreground"
                >{{ commandModelMeta(command.model)?.name || '' }}{{ commandModelMeta(command.model)?.name ? ' · ' : ''
                }}{{ formatModelMeta(commandModelMeta(command.model)) }}</span
              >
              <span
                v-if="commandModelMeta(command.model) && formatModelCost(commandModelMeta(command.model))"
                class="text-[11px] text-muted-foreground"
                >{{ formatModelCost(commandModelMeta(command.model)) }}</span
              >
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="command.subtask === true"
                @change="(e) => setEntryField('command', commandId, 'subtask', (e.target as HTMLInputElement).checked)"
              />
              {{ t('settings.opencodeConfig.sections.commands.fields.subtask') }}
            </label>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
