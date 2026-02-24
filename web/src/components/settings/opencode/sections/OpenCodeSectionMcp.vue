<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiRestartLine,
  RiShieldKeyholeLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import StringListEditor from '../StringListEditor.vue'
import { useUiStore } from '@/stores/ui'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    StringListEditor,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCheckLine,
    RiDeleteBinLine,
    RiRestartLine,
    RiShieldKeyholeLine,
  },
  setup() {
    const ui = useUiStore()
    const ctx = useOpencodeConfigPanelContext()
    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string
    const mcpCommandSuggestions = ['npx', 'uvx', 'docker', 'node', 'python', 'deno', 'bunx']

    const mcpTypePickerOptions = computed<PickerOption[]>(() => [
      { value: 'toggle', label: t('settings.opencodeConfig.sections.mcp.options.types.toggle') },
      { value: 'local', label: t('settings.opencodeConfig.sections.mcp.options.types.local') },
      { value: 'remote', label: t('settings.opencodeConfig.sections.mcp.options.types.remote') },
    ])

    const mcpOauthPickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.mcp.options.oauth.default') },
      { value: 'config', label: t('settings.opencodeConfig.sections.mcp.options.oauth.config') },
      { value: 'disabled', label: t('settings.opencodeConfig.sections.mcp.options.oauth.disabled') },
    ])

    function openMcpConnections() {
      ui.setMcpDialogOpen(true)
    }

    // Keep the injected context as the component instance surface area (it has a loose index signature).
    ctx.openMcpConnections = openMcpConnections
    ctx.mcpCommandSuggestions = mcpCommandSuggestions
    ctx.mcpTypePickerOptions = mcpTypePickerOptions
    ctx.mcpOauthPickerOptions = mcpOauthPickerOptions
    return ctx
  },
})
</script>

<template>
  <section id="mcp" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">{{ t('settings.opencodeConfig.sections.mcp.title') }}</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="sm"
            variant="outline"
            class="gap-2"
            :aria-label="t('settings.opencodeConfig.sections.mcp.actions.manageConnectionsAria')"
            @click="openMcpConnections"
          >
            <RiShieldKeyholeLine class="h-4 w-4" />
            <span>{{ t('settings.opencodeConfig.sections.mcp.actions.connections') }}</span>
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.mcp.actions.connectionsHelp') }}</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('mcp')"
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
              isSectionOpen('mcp')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('mcp')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('mcp')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('mcp')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('mcp')" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="newMcpName" :placeholder="t('settings.opencodeConfig.sections.mcp.placeholders.serverName')" class="max-w-xs" />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :title="t('settings.opencodeConfig.sections.mcp.actions.addServer')"
            :aria-label="t('settings.opencodeConfig.sections.mcp.actions.addServerAria')"
            @click="addMcp"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.mcp.actions.addServer') }}</template>
        </Tooltip>
      </div>
      <div v-if="mcpList.length === 0" class="text-xs text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.mcp.empty') }}
      </div>
      <div v-for="[mcpName, mcp] in mcpList" :key="mcpName" class="rounded-md border border-border p-3 space-y-4">
        <div class="flex items-center justify-between">
          <div class="font-mono text-sm break-all">{{ mcpName }}</div>
          <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('settings.opencodeConfig.sections.mcp.actions.removeServerAria')"
                @click="removeEntry('mcp', mcpName)"
              >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('common.remove') }}</template>
          </Tooltip>
        </div>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.type') }}</span>
          <OptionPicker
            :model-value="mcpType(mcp)"
            @update:model-value="(v) => setMcpType(mcpName, String(v || ''))"
            :options="mcpTypePickerOptions"
            :title="t('settings.opencodeConfig.sections.mcp.fields.type')"
            :search-placeholder="t('settings.opencodeConfig.sections.mcp.search.searchTypes')"
            :include-empty="false"
          />
        </label>

        <template v-if="mcpType(mcp) === 'local'">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.command') }}</span>
            <StringListEditor
              :model-value="mcp.command || []"
              :suggestions="mcpCommandSuggestions"
              :panel-title="t('settings.opencodeConfig.sections.mcp.command.panelTitle')"
              :placeholder="t('settings.opencodeConfig.sections.mcp.command.placeholder')"
              split-mode="lines"
              :advanced-rows="3"
              :advanced-placeholder="t('settings.opencodeConfig.sections.mcp.command.advancedPlaceholder')"
              @update:model-value="(v) => setEntryField('mcp', mcpName, 'command', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.timeoutMs') }}</span>
            <input
              :value="mcp.timeout ?? ''"
              @input="
                (e) => setEntryField('mcp', mcpName, 'timeout', parseNumberInput((e.target as HTMLInputElement).value))
              "
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.environmentJson') }}</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `mcp:${mcpName}:env`,
                  () => mcp.environment,
                  (val) => setEntryField('mcp', mcpName, 'environment', val),
                  {},
                ).text
              "
              rows="4"
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
                  @click="applyJsonBuffer(`mcp:${mcpName}:env`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.apply') }}</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `mcp:${mcpName}:env`,
                    () => mcp.environment,
                    (val) => setEntryField('mcp', mcpName, 'environment', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `mcp:${mcpName}:env`,
                    () => mcp.environment,
                    (val) => setEntryField('mcp', mcpName, 'environment', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </label>
        </template>

        <template v-else-if="mcpType(mcp) === 'remote'">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.url') }}</span>
            <Input :model-value="mcp.url || ''" @update:model-value="(v) => setEntryField('mcp', mcpName, 'url', v)" />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.timeoutMs') }}</span>
            <input
              :value="mcp.timeout ?? ''"
              @input="
                (e) => setEntryField('mcp', mcpName, 'timeout', parseNumberInput((e.target as HTMLInputElement).value))
              "
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.headersJson') }}</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `mcp:${mcpName}:headers`,
                  () => mcp.headers,
                  (val) => setEntryField('mcp', mcpName, 'headers', val),
                  {},
                ).text
              "
              rows="4"
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
                  @click="applyJsonBuffer(`mcp:${mcpName}:headers`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.apply') }}</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `mcp:${mcpName}:headers`,
                    () => mcp.headers,
                    (val) => setEntryField('mcp', mcpName, 'headers', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `mcp:${mcpName}:headers`,
                    () => mcp.headers,
                    (val) => setEntryField('mcp', mcpName, 'headers', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </label>
          <div class="grid gap-2">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.fields.oauth') }}</span>
            <OptionPicker
              :model-value="mcp.oauth === false ? 'disabled' : mcp.oauth ? 'config' : 'default'"
              @update:model-value="
                (v) => {
                  const mode = String(v || 'default')
                  setEntryField(
                    'mcp',
                    mcpName,
                    'oauth',
                    mode === 'disabled'
                      ? false
                      : mode === 'config'
                        ? { clientId: '', clientSecret: '', scope: '' }
                        : null,
                  )
                }
              "
              :options="mcpOauthPickerOptions"
              :title="t('settings.opencodeConfig.sections.mcp.fields.oauth')"
              :search-placeholder="t('settings.opencodeConfig.sections.mcp.search.searchOauth')"
              :include-empty="false"
            />
          </div>
          <div v-if="mcp.oauth && mcp.oauth !== false" class="grid gap-3 lg:grid-cols-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.oauth.clientId') }}</span>
              <Input
                :model-value="mcp.oauth.clientId || ''"
                @update:model-value="(v) => setEntryField('mcp', mcpName, 'oauth', { ...mcp.oauth, clientId: v })"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.oauth.clientSecret') }}</span>
              <Input
                :model-value="mcp.oauth.clientSecret || ''"
                @update:model-value="(v) => setEntryField('mcp', mcpName, 'oauth', { ...mcp.oauth, clientSecret: v })"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.mcp.oauth.scope') }}</span>
              <Input
                :model-value="mcp.oauth.scope || ''"
                @update:model-value="(v) => setEntryField('mcp', mcpName, 'oauth', { ...mcp.oauth, scope: v })"
              />
            </label>
          </div>
        </template>

        <label class="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            :checked="mcp.enabled !== false"
            @change="(e) => setEntryField('mcp', mcpName, 'enabled', (e.target as HTMLInputElement).checked)"
          />
          {{ t('settings.opencodeConfig.sections.common.enabled') }}
        </label>
      </div>
    </div>
  </section>
</template>
