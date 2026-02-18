<script lang="ts">
import { defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiRestartLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import StringListEditor from '../StringListEditor.vue'

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
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()
    const formatterCommandSuggestions = ['prettier', 'eslint', 'biome', 'ruff', 'black', 'shfmt', 'clang-format']
    const lspCommandSuggestions = [
      'typescript-language-server',
      'pyright-langserver',
      'rust-analyzer',
      'gopls',
      'jdtls',
    ]
    const extensionSuggestions = [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.json',
      '.md',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.kt',
      '.sh',
      '.yaml',
      '.yml',
    ]

    const lspModePickerOptions: PickerOption[] = [
      { value: 'config', label: 'config' },
      { value: 'disabled', label: 'disabled' },
    ]

    return Object.assign(ctx, {
      formatterCommandSuggestions,
      lspCommandSuggestions,
      extensionSuggestions,
      lspModePickerOptions,
    })
  },
})
</script>

<template>
  <section id="formatter" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Formatter and language server configs.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('formatter')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('formatter') ? 'Collapse' : 'Expand'"
            @click="toggleSection('formatter')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('formatter')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('formatter') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('formatter')" class="space-y-4">
      <div class="grid gap-3">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="formatterDisabled" />
          Disable all formatters
        </label>
        <div class="flex flex-wrap items-center gap-2" v-if="!formatterDisabled">
          <Input v-model="newFormatterId" placeholder="Formatter id" class="max-w-xs" />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add formatter"
              aria-label="Add formatter"
              @click="addFormatter"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add formatter</template>
          </Tooltip>
        </div>
        <div v-if="!formatterDisabled && formatterList.length === 0" class="text-xs text-muted-foreground">
          No formatters configured.
        </div>
        <div
          v-if="!formatterDisabled"
          v-for="[fmtId, fmt] in formatterList"
          :key="fmtId"
          class="rounded-md border border-border p-3 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="font-mono text-sm break-all">{{ fmtId }}</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                title="Remove formatter"
                aria-label="Remove formatter"
                @click="removeEntry('formatter', fmtId)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </Button>
              <template #content>Remove</template>
            </Tooltip>
          </div>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="fmt.disabled === true"
              @change="(e) => setEntryField('formatter', fmtId, 'disabled', (e.target as HTMLInputElement).checked)"
            />
            Disabled
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Command</span>
            <StringListEditor
              :model-value="fmt.command || []"
              :suggestions="formatterCommandSuggestions"
              panel-title="Formatter command"
              placeholder="prettier"
              split-mode="lines"
              :advanced-rows="3"
              advanced-placeholder="prettier\n--write\n$FILE"
              @update:model-value="(v) => setEntryField('formatter', fmtId, 'command', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Extensions</span>
            <StringListEditor
              :model-value="fmt.extensions || []"
              :suggestions="extensionSuggestions"
              panel-title="File extensions"
              placeholder=".ts"
              split-mode="tags"
              :advanced-rows="3"
              advanced-placeholder=".ts\n.tsx"
              @update:model-value="(v) => setEntryField('formatter', fmtId, 'extensions', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Environment (JSON)</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `formatter:${fmtId}:env`,
                  () => fmt.environment,
                  (val) => setEntryField('formatter', fmtId, 'environment', val),
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
                  title="Apply"
                  aria-label="Apply JSON"
                  @click="applyJsonBuffer(`formatter:${fmtId}:env`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `formatter:${fmtId}:env`,
                    () => fmt.environment,
                    (val) => setEntryField('formatter', fmtId, 'environment', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `formatter:${fmtId}:env`,
                    () => fmt.environment,
                    (val) => setEntryField('formatter', fmtId, 'environment', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </label>
        </div>
      </div>

      <div class="grid gap-3">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="lspDisabled" />
          Disable all LSP servers
        </label>
        <div class="flex flex-wrap items-center gap-2" v-if="!lspDisabled">
          <Input v-model="newLspId" placeholder="LSP id" class="max-w-xs" />
          <Tooltip>
            <Button size="icon" variant="outline" class="h-9 w-9" title="Add LSP" aria-label="Add LSP" @click="addLsp">
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add LSP</template>
          </Tooltip>
        </div>
        <div v-if="!lspDisabled && lspList.length === 0" class="text-xs text-muted-foreground">
          No LSP servers configured.
        </div>
        <div
          v-if="!lspDisabled"
          v-for="[lspId, lsp] in lspList"
          :key="lspId"
          class="rounded-md border border-border p-3 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="font-mono text-sm break-all">{{ lspId }}</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                title="Remove LSP"
                aria-label="Remove LSP"
                @click="removeEntry('lsp', lspId)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </Button>
              <template #content>Remove</template>
            </Tooltip>
          </div>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Mode</span>
            <OptionPicker
              :model-value="lspMode(lsp)"
              @update:model-value="(v) => setLspMode(lspId, String(v || ''))"
              :options="lspModePickerOptions"
              title="Mode"
              search-placeholder="Search modes"
              :include-empty="false"
            />
          </label>
          <div v-if="lspMode(lsp) === 'config'" class="grid gap-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Command</span>
              <StringListEditor
                :model-value="lsp.command || []"
                :suggestions="lspCommandSuggestions"
                panel-title="LSP command"
                placeholder="typescript-language-server"
                split-mode="lines"
                :advanced-rows="3"
                advanced-placeholder="typescript-language-server\n--stdio"
                @update:model-value="(v) => setEntryField('lsp', lspId, 'command', v)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Extensions</span>
              <StringListEditor
                :model-value="lsp.extensions || []"
                :suggestions="extensionSuggestions"
                panel-title="File extensions"
                placeholder=".ts"
                split-mode="tags"
                :advanced-rows="3"
                advanced-placeholder=".ts\n.tsx"
                @update:model-value="(v) => setEntryField('lsp', lspId, 'extensions', v)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Environment (JSON)</span>
              <textarea
                v-model="
                  ensureJsonBuffer(
                    `lsp:${lspId}:env`,
                    () => lsp.env,
                    (val) => setEntryField('lsp', lspId, 'env', val),
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
                    title="Apply"
                    aria-label="Apply JSON"
                    @click="applyJsonBuffer(`lsp:${lspId}:env`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>Apply</template>
                </Tooltip>
                <span
                  v-if="
                    ensureJsonBuffer(
                      `lsp:${lspId}:env`,
                      () => lsp.env,
                      (val) => setEntryField('lsp', lspId, 'env', val),
                      {},
                    ).error
                  "
                  class="text-xs text-destructive"
                >
                  {{
                    ensureJsonBuffer(
                      `lsp:${lspId}:env`,
                      () => lsp.env,
                      (val) => setEntryField('lsp', lspId, 'env', val),
                      {},
                    ).error
                  }}
                </span>
              </div>
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Initialization (JSON)</span>
              <textarea
                v-model="
                  ensureJsonBuffer(
                    `lsp:${lspId}:init`,
                    () => lsp.initialization,
                    (val) => setEntryField('lsp', lspId, 'initialization', val),
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
                    title="Apply"
                    aria-label="Apply JSON"
                    @click="applyJsonBuffer(`lsp:${lspId}:init`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>Apply</template>
                </Tooltip>
                <span
                  v-if="
                    ensureJsonBuffer(
                      `lsp:${lspId}:init`,
                      () => lsp.initialization,
                      (val) => setEntryField('lsp', lspId, 'initialization', val),
                      {},
                    ).error
                  "
                  class="text-xs text-destructive"
                >
                  {{
                    ensureJsonBuffer(
                      `lsp:${lspId}:init`,
                      () => lsp.initialization,
                      (val) => setEntryField('lsp', lspId, 'initialization', val),
                      {},
                    ).error
                  }}
                </span>
              </div>
            </label>
          </div>
          <label class="inline-flex items-center gap-2 text-sm" v-if="lspMode(lsp) === 'config'">
            <input
              type="checkbox"
              :checked="lsp.disabled === true"
              @change="(e) => setEntryField('lsp', lspId, 'disabled', (e.target as HTMLInputElement).checked)"
            />
            Disabled
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
