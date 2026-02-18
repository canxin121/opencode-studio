<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiRefreshLine,
  RiRestartLine,
  RiSparkling2Line,
  RiStackLine,
  RiUserLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
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
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRefreshLine,
    RiRestartLine,
    RiSparkling2Line,
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

    const defaultAgentPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.agentOptions) ? ctx.agentOptions : []
      return list
        .map((a) => {
          const agent = a && typeof a === 'object' ? (a as Record<string, JsonValue>) : null
          const name = String(agent?.name || '').trim()
          if (!name) return null
          if (ctx.isValidDefaultAgent && !ctx.isValidDefaultAgent(agent)) return null
          const mode = typeof agent?.mode === 'string' ? agent.mode : ''
          const hidden = agent?.hidden === true
          const label = `${name}${mode === 'subagent' ? ' (subagent)' : ''}${hidden ? ' (hidden)' : ''}`
          return {
            value: name,
            label,
            description: typeof agent?.description === 'string' ? agent.description : undefined,
          } satisfies PickerOption
        })
        .filter(Boolean) as PickerOption[]
    })

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    const modelProviderFilterPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelProviderOptions) ? ctx.modelProviderOptions : []
      return list.map((pid: string) => ({ value: pid, label: pid }))
    })

    const modelFamilyFilterPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelFamilyOptions) ? ctx.modelFamilyOptions : []
      return list.map((f: string) => ({ value: f, label: f }))
    })

    const modelStatusFilterPickerOptions: PickerOption[] = [
      { value: 'active', label: 'active' },
      { value: 'beta', label: 'beta' },
      { value: 'alpha', label: 'alpha' },
      { value: 'deprecated', label: 'deprecated' },
    ]

    const modelSortPickerOptions: PickerOption[] = [
      { value: 'alpha', label: 'alpha' },
      { value: 'context_desc', label: 'context ↓' },
      { value: 'output_desc', label: 'output ↓' },
      { value: 'cost_total_asc', label: 'cost (in+out) ↑' },
      { value: 'cost_input_asc', label: 'cost in ↑' },
      { value: 'cost_output_asc', label: 'cost out ↑' },
      { value: 'release_desc', label: 'release ↓' },
    ]

    const logLevelPickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'DEBUG', label: 'DEBUG' },
      { value: 'INFO', label: 'INFO' },
      { value: 'WARN', label: 'WARN' },
      { value: 'ERROR', label: 'ERROR' },
    ]

    const shareModePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'manual', label: 'manual' },
      { value: 'auto', label: 'auto' },
      { value: 'disabled', label: 'disabled' },
    ]

    const autoUpdateModePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'notify', label: 'notify' },
      { value: 'true', label: 'true' },
      { value: 'false', label: 'false' },
    ]

    const snapshotModePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'true', label: 'true' },
      { value: 'false', label: 'false' },
    ]

    return Object.assign(ctx, {
      normalizeAgentName,
      defaultAgentPickerOptions,
      modelPickerOptions,
      modelProviderFilterPickerOptions,
      modelFamilyFilterPickerOptions,
      modelStatusFilterPickerOptions,
      modelSortPickerOptions,
      logLevelPickerOptions,
      shareModePickerOptions,
      autoUpdateModePickerOptions,
      snapshotModePickerOptions,
    })
  },
})
</script>

<template>
  <section id="general" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Top-level identity, defaults, and schema.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('general')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('general') ? 'Collapse' : 'Expand'"
            @click="toggleSection('general')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('general')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('general') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('general')" class="space-y-4">
      <div v-if="optionsError" class="text-xs text-destructive break-all">{{ optionsError }}</div>
      <div v-else class="text-xs text-muted-foreground">
        Models/agents are discovered from the running OpenCode server.
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Schema URL</span>
          <Input v-model="schemaUrl" placeholder="https://opencode.ai/config.json" />
          <span class="text-[11px] text-muted-foreground"
            >Usually keep the default; it enables validation and editor hints.</span
          >
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Theme</span>
          <Input v-model="theme" placeholder="opencode" />
          <span class="text-[11px] text-muted-foreground">Theme name in OpenCode (TUI/Web).</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Username</span>
          <Input v-model="username" placeholder="Your name" />
          <span class="text-[11px] text-muted-foreground"
            >Displayed in conversations; defaults to system username.</span
          >
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Default agent</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="defaultAgent"
                @update:model-value="(v) => (defaultAgent = normalizeAgentName(v))"
                :options="defaultAgentPickerOptions"
                title="Default agent"
                search-placeholder="Search agents"
                :icon="RiUserLine"
                allow-custom
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Refresh agent/model lists"
                aria-label="Refresh agent/model lists"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>Refresh agent/model lists</template>
            </Tooltip>
          </div>
          <span class="text-[11px] text-muted-foreground">Must be a primary agent (subagents/hidden are invalid).</span>
          <span v-if="defaultAgentWarning" class="text-xs text-destructive">{{ defaultAgentWarning }}</span>
          <span v-else-if="issueText('default_agent')" class="text-xs text-destructive">{{
            issueText('default_agent')
          }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Default model</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="model"
                @update:model-value="(v) => (model = String(v || '').trim())"
                :options="modelPickerOptions"
                title="Default model"
                search-placeholder="Search models"
                :icon="RiStackLine"
                allow-custom
                monospace
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Refresh agent/model lists"
                aria-label="Refresh agent/model lists"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>Refresh agent/model lists</template>
            </Tooltip>
          </div>
          <button
            type="button"
            class="text-[11px] text-muted-foreground hover:text-foreground text-left"
            @click="showModelBrowse = !showModelBrowse"
          >
            {{ showModelBrowse ? 'Hide model browser' : 'Browse models' }}
          </button>
          <span v-if="modelWarning" class="text-xs text-amber-600">{{ modelWarning }}</span>
          <span v-else-if="modelUnknownWarning" class="text-xs text-amber-600">{{ modelUnknownWarning }}</span>
          <span v-else-if="issueText('model')" class="text-xs text-destructive">{{ issueText('model') }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Small model</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="smallModel"
                @update:model-value="(v) => (smallModel = String(v || '').trim())"
                :options="modelPickerOptions"
                title="Small model"
                search-placeholder="Search models"
                :icon="RiSparkling2Line"
                allow-custom
                monospace
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                title="Refresh agent/model lists"
                aria-label="Refresh agent/model lists"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>Refresh agent/model lists</template>
            </Tooltip>
          </div>
          <span class="text-[11px] text-muted-foreground">Used for lightweight tasks (e.g., title generation).</span>
          <span v-if="smallModelWarning" class="text-xs text-amber-600">{{ smallModelWarning }}</span>
          <span v-else-if="smallModelUnknownWarning" class="text-xs text-amber-600">{{
            smallModelUnknownWarning
          }}</span>
          <span v-else-if="issueText('small_model')" class="text-xs text-destructive">{{
            issueText('small_model')
          }}</span>
        </label>

        <div v-if="showModelBrowse" class="lg:col-span-2 rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Model browser</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Close model browser"
                aria-label="Close model browser"
                @click="showModelBrowse = false"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>Close</template>
            </Tooltip>
          </div>
          <div class="grid gap-3 lg:grid-cols-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Search</span>
              <Input v-model="modelSlugFilter" placeholder="openai/gpt or name" />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Provider</span>
              <OptionPicker
                v-model="modelProviderFilter"
                :options="modelProviderFilterPickerOptions"
                title="Provider"
                search-placeholder="Search providers"
                empty-label="All"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Status</span>
              <OptionPicker
                v-model="modelStatusFilter"
                :options="modelStatusFilterPickerOptions"
                title="Status"
                search-placeholder="Search statuses"
                empty-label="All"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Family</span>
              <OptionPicker
                v-model="modelFamilyFilter"
                :options="modelFamilyFilterPickerOptions"
                title="Family"
                search-placeholder="Search families"
                empty-label="All"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Min context</span>
              <input
                v-model="modelMinContext"
                type="number"
                min="0"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="0"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Min output</span>
              <input
                v-model="modelMinOutput"
                type="number"
                min="0"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="0"
              />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <label class="inline-flex items-center gap-2 text-sm"
              ><input type="checkbox" v-model="modelRequireTools" /> Tools</label
            >
            <label class="inline-flex items-center gap-2 text-sm"
              ><input type="checkbox" v-model="modelRequireReasoning" /> Reasoning</label
            >
            <label class="inline-flex items-center gap-2 text-sm"
              ><input type="checkbox" v-model="modelRequireImage" /> Image input</label
            >
            <label class="inline-flex items-center gap-2 text-sm"
              ><input type="checkbox" v-model="modelRequirePdf" /> PDF input</label
            >
            <div class="flex-1" />
            <label class="inline-flex items-center gap-2 text-sm">
              <span class="text-xs text-muted-foreground">Sort</span>
              <div class="w-[190px]">
                <OptionPicker
                  v-model="modelSort"
                  :options="modelSortPickerOptions"
                  title="Sort"
                  search-placeholder="Search sorts"
                  :include-empty="false"
                />
              </div>
            </label>
          </div>

          <div class="text-[11px] text-muted-foreground">
            {{ sortedModelEntries.length }} models shown. Click a row to set Default or Small.
          </div>
          <VirtualList
            v-if="modelBrowserRows.length"
            :items="modelBrowserRows"
            :get-key="(row) => modelBrowserRowKey(row)"
            :get-height="(row) => modelBrowserRowHeight(row)"
            class="max-h-64 pr-1 rounded-md border border-border bg-muted/10"
          >
            <template #default="{ item: row }">
              <div
                v-if="row.kind === 'provider'"
                class="h-7 px-2 flex items-center justify-between border-b border-border/60 bg-background/70"
              >
                <div class="font-mono text-xs font-semibold break-all">{{ row.providerId }}</div>
                <div class="text-[11px] text-muted-foreground">
                  {{ providerRemoteInfo(row.providerId)?.name || ''
                  }}{{ providerRemoteInfo(row.providerId)?.name ? ' · ' : ''
                  }}{{ providerRemoteInfo(row.providerId)?.source || '' }} · {{ row.count }}
                </div>
              </div>
              <div
                v-else
                class="h-[72px] px-2 py-2 flex items-start justify-between gap-2 border-b border-border/40 overflow-hidden"
              >
                <div class="min-w-0">
                  <div class="font-mono text-xs break-all truncate">{{ row.entry.slug }}</div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <Tooltip>
                    <Button
                      size="icon"
                      variant="outline"
                      class="h-8 w-8"
                      title="Set default model"
                      aria-label="Set default model"
                      @click="model = row.entry.slug"
                    >
                      <RiStackLine class="h-4 w-4" />
                    </Button>
                    <template #content>Default</template>
                  </Tooltip>
                  <Tooltip>
                    <Button
                      size="icon"
                      variant="outline"
                      class="h-8 w-8"
                      title="Set small model"
                      aria-label="Set small model"
                      @click="smallModel = row.entry.slug"
                    >
                      <RiSparkling2Line class="h-4 w-4" />
                    </Button>
                    <template #content>Small</template>
                  </Tooltip>
                </div>
              </div>
            </template>
          </VirtualList>
          <div v-else class="text-xs text-muted-foreground">No matching models.</div>
        </div>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Log level</span>
          <OptionPicker
            v-model="logLevel"
            :options="logLevelPickerOptions"
            title="Log level"
            search-placeholder="Search log levels"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Share mode</span>
          <OptionPicker
            v-model="shareMode"
            :options="shareModePickerOptions"
            title="Share mode"
            search-placeholder="Search share modes"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Auto-update</span>
          <OptionPicker
            v-model="autoUpdateMode"
            :options="autoUpdateModePickerOptions"
            title="Auto-update"
            search-placeholder="Search update modes"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Snapshot tracking</span>
          <OptionPicker
            v-model="snapshotMode"
            :options="snapshotModePickerOptions"
            title="Snapshot tracking"
            search-placeholder="Search snapshot modes"
            :include-empty="false"
          />
        </label>
      </div>
    </div>
  </section>
</template>
