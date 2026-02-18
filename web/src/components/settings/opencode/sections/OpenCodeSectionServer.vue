<script lang="ts">
import { defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InlineSearchAdd, { type PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import OptionPicker, { type PickerOption as OptionPickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    InlineSearchAdd,
    OptionPicker,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const triStatePickerOptions: OptionPickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'true', label: 'true' },
      { value: 'false', label: 'false' },
    ]

    const corsSuggestionOptions: PickerOption[] = [
      { value: 'http://localhost:5173' },
      { value: 'http://localhost:3000' },
      { value: 'https://example.com' },
    ]
    const watcherIgnoreSuggestionOptions: PickerOption[] = [
      { value: '**/.git' },
      { value: '**/dist' },
      { value: '**/build' },
      { value: '**/node_modules' },
      { value: '**/.venv' },
      { value: '**/target' },
    ]
    return Object.assign(ctx, { triStatePickerOptions, corsSuggestionOptions, watcherIgnoreSuggestionOptions })
  },
})
</script>

<template>
  <section id="server" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Server options and file watcher ignores.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('server')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('server') ? 'Collapse' : 'Expand'"
            @click="toggleSection('server')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('server')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('server') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('server')" class="space-y-4">
      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Port</span>
          <input
            v-model="serverPort"
            type="number"
            min="1"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Hostname</span>
          <Input v-model="serverHostname" placeholder="127.0.0.1" />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">mDNS</span>
          <OptionPicker
            v-model="serverMdns"
            :options="triStatePickerOptions"
            title="mDNS"
            search-placeholder="Search"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1 lg:col-span-3">
          <span class="text-xs text-muted-foreground">mDNS domain</span>
          <Input v-model="serverMdnsDomain" placeholder="opencode.local" />
        </label>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-xs text-muted-foreground">Lists</div>
        <button
          type="button"
          class="text-[11px] text-muted-foreground hover:text-foreground"
          @click="showAdvancedServerLists = !showAdvancedServerLists"
        >
          {{ showAdvancedServerLists ? 'Hide advanced text' : 'Show advanced text' }}
        </button>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">CORS origins</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Clear"
                aria-label="Clear CORS origins"
                @click="serverCorsArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>Clear</template>
            </Tooltip>
          </div>
          <div class="text-[11px] text-muted-foreground">One origin per entry (exact match).</div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="it in serverCorsArr"
              :key="`cors:${it}`"
              class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
            >
              <span class="font-mono break-all">{{ it }}</span>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                @click="serverCorsArr = removeFromList(serverCorsArr, it)"
              >
                ×
              </button>
            </span>
            <span v-if="serverCorsArr.length === 0" class="text-xs text-muted-foreground">None</span>
          </div>
          <div class="flex items-center gap-2">
            <InlineSearchAdd
              :options="corsSuggestionOptions"
              panel-title="CORS"
              placeholder="https://example.com"
              monospace
              :selected-values="serverCorsArr"
              @add="addServerCorsTags"
              @remove="(v: string) => (serverCorsArr = removeFromList(serverCorsArr, v))"
              @backspace-empty="
                () => {
                  if (serverCorsArr.length) serverCorsArr = serverCorsArr.slice(0, -1)
                }
              "
            />
          </div>
          <div v-if="showAdvancedServerLists" class="grid gap-1">
            <span class="text-xs text-muted-foreground">CORS origins (advanced text)</span>
            <textarea
              v-model="serverCors"
              rows="4"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              placeholder="https://example.com"
            />
          </div>
        </div>

        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Watcher ignore globs</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Clear"
                aria-label="Clear watcher ignore"
                @click="watcherIgnoreArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>Clear</template>
            </Tooltip>
          </div>
          <div class="text-[11px] text-muted-foreground">Glob patterns to ignore for file watching.</div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="it in watcherIgnoreArr"
              :key="`ign:${it}`"
              class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
            >
              <span class="font-mono break-all">{{ it }}</span>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                @click="watcherIgnoreArr = removeFromList(watcherIgnoreArr, it)"
              >
                ×
              </button>
            </span>
            <span v-if="watcherIgnoreArr.length === 0" class="text-xs text-muted-foreground">None</span>
          </div>
          <div class="flex items-center gap-2">
            <InlineSearchAdd
              :options="watcherIgnoreSuggestionOptions"
              panel-title="Ignore globs"
              placeholder="**/dist"
              monospace
              :selected-values="watcherIgnoreArr"
              @add="addWatcherIgnoreTags"
              @remove="(v: string) => (watcherIgnoreArr = removeFromList(watcherIgnoreArr, v))"
              @backspace-empty="
                () => {
                  if (watcherIgnoreArr.length) watcherIgnoreArr = watcherIgnoreArr.slice(0, -1)
                }
              "
            />
          </div>
          <div v-if="showAdvancedServerLists" class="grid gap-1">
            <span class="text-xs text-muted-foreground">Watcher ignore globs (advanced text)</span>
            <textarea
              v-model="watcherIgnore"
              rows="4"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              placeholder="**/dist\n**/.git"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
