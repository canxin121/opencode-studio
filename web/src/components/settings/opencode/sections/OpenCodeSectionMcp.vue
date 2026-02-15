<script lang="ts">
import { defineComponent } from 'vue'
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
    const mcpCommandSuggestions = ['npx', 'uvx', 'docker', 'node', 'python', 'deno', 'bunx']

    function openMcpConnections() {
      ui.setMcpDialogOpen(true)
    }

    // Keep the injected context as the component instance surface area (it has a loose index signature).
    ctx.openMcpConnections = openMcpConnections
    ctx.mcpCommandSuggestions = mcpCommandSuggestions
    return ctx
  },
})
</script>

<template>
  <section id="mcp" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Model Context Protocol servers.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="sm"
            variant="outline"
            class="gap-2"
            aria-label="Manage MCP connections"
            @click="openMcpConnections"
          >
            <RiShieldKeyholeLine class="h-4 w-4" />
            <span>Connections</span>
          </Button>
          <template #content>Connect, disconnect, and authenticate MCP servers</template>
        </Tooltip>
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('mcp')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('mcp') ? 'Collapse' : 'Expand'"
            @click="toggleSection('mcp')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('mcp')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('mcp') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('mcp')" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="newMcpName" placeholder="Server name" class="max-w-xs" />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            title="Add MCP server"
            aria-label="Add MCP server"
            @click="addMcp"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>Add MCP server</template>
        </Tooltip>
      </div>
      <div v-if="mcpList.length === 0" class="text-xs text-muted-foreground">No MCP servers configured.</div>
      <div v-for="[mcpName, mcp] in mcpList" :key="mcpName" class="rounded-md border border-border p-3 space-y-4">
        <div class="flex items-center justify-between">
          <div class="font-mono text-sm break-all">{{ mcpName }}</div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove MCP server"
              @click="removeEntry('mcp', mcpName)"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Type</span>
          <select
            :value="mcpType(mcp)"
            @change="(e) => setMcpType(mcpName, (e.target as HTMLSelectElement).value)"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="toggle">toggle</option>
            <option value="local">local</option>
            <option value="remote">remote</option>
          </select>
        </label>

        <template v-if="mcpType(mcp) === 'local'">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Command</span>
            <StringListEditor
              :model-value="mcp.command || []"
              :suggestions="mcpCommandSuggestions"
              panel-title="MCP launch command"
              placeholder="npx"
              split-mode="lines"
              :advanced-rows="3"
              advanced-placeholder="npx\n@modelcontextprotocol/server-filesystem"
              @update:model-value="(v) => setEntryField('mcp', mcpName, 'command', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Timeout (ms)</span>
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
            <span class="text-xs text-muted-foreground">Environment (JSON)</span>
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
                  title="Apply"
                  aria-label="Apply JSON"
                  @click="applyJsonBuffer(`mcp:${mcpName}:env`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply</template>
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
            <span class="text-xs text-muted-foreground">URL</span>
            <Input :model-value="mcp.url || ''" @update:model-value="(v) => setEntryField('mcp', mcpName, 'url', v)" />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Timeout (ms)</span>
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
            <span class="text-xs text-muted-foreground">Headers (JSON)</span>
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
                  title="Apply"
                  aria-label="Apply JSON"
                  @click="applyJsonBuffer(`mcp:${mcpName}:headers`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply</template>
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
            <span class="text-xs text-muted-foreground">OAuth</span>
            <select
              :value="mcp.oauth === false ? 'disabled' : mcp.oauth ? 'config' : 'default'"
              @change="
                (e) =>
                  setEntryField(
                    'mcp',
                    mcpName,
                    'oauth',
                    (e.target as HTMLSelectElement).value === 'disabled'
                      ? false
                      : (e.target as HTMLSelectElement).value === 'config'
                        ? { clientId: '', clientSecret: '', scope: '' }
                        : null,
                  )
              "
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="default">default</option>
              <option value="config">config</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <div v-if="mcp.oauth && mcp.oauth !== false" class="grid gap-3 lg:grid-cols-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Client ID</span>
              <Input
                :model-value="mcp.oauth.clientId || ''"
                @update:model-value="(v) => setEntryField('mcp', mcpName, 'oauth', { ...mcp.oauth, clientId: v })"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Client secret</span>
              <Input
                :model-value="mcp.oauth.clientSecret || ''"
                @update:model-value="(v) => setEntryField('mcp', mcpName, 'oauth', { ...mcp.oauth, clientSecret: v })"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">Scope</span>
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
          Enabled
        </label>
      </div>
    </div>
  </section>
</template>
