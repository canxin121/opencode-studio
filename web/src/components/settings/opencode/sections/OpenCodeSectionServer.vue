<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InlineSearchAdd from '@/components/ui/InlineSearchAdd.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

type OptionPickerOption = PickerOption

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

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    const triStatePickerOptions = computed<OptionPickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.common.options.triState.default') },
      { value: 'true', label: t('settings.opencodeConfig.sections.common.options.triState.true') },
      { value: 'false', label: t('settings.opencodeConfig.sections.common.options.triState.false') },
    ])

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
        <div class="text-base font-semibold leading-snug">{{ t('settings.opencodeConfig.sections.server.title') }}</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('server')"
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
              isSectionOpen('server')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('server')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('server')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('server')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('server')" class="space-y-4">
      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.server.fields.port')
          }}</span>
          <input
            v-model="serverPort"
            type="number"
            min="1"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.server.fields.hostname')
          }}</span>
          <Input
            v-model="serverHostname"
            :placeholder="t('settings.opencodeConfig.sections.server.placeholders.hostname')"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.server.fields.mdns')
          }}</span>
          <OptionPicker
            v-model="serverMdns"
            :options="triStatePickerOptions"
            :title="t('settings.opencodeConfig.sections.server.fields.mdns')"
            :search-placeholder="t('common.search')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1 lg:col-span-3">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.server.fields.mdnsDomain')
          }}</span>
          <Input
            v-model="serverMdnsDomain"
            :placeholder="t('settings.opencodeConfig.sections.server.placeholders.mdnsDomain')"
          />
        </label>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.server.listsTitle') }}</div>
        <button
          type="button"
          class="text-[11px] text-muted-foreground hover:text-foreground"
          @click="showAdvancedServerLists = !showAdvancedServerLists"
        >
          {{
            showAdvancedServerLists
              ? t('settings.opencodeConfig.sections.common.hideAdvancedText')
              : t('settings.opencodeConfig.sections.common.showAdvancedText')
          }}
        </button>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.server.cors.title') }}</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('common.clear')"
                :aria-label="t('settings.opencodeConfig.sections.server.cors.clearAria')"
                @click="serverCorsArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.clear') }}</template>
            </Tooltip>
          </div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.server.cors.help') }}
          </div>
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
            <span v-if="serverCorsArr.length === 0" class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.common.none')
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <InlineSearchAdd
              :options="corsSuggestionOptions"
              :panel-title="t('settings.opencodeConfig.sections.server.cors.panelTitle')"
              :placeholder="t('settings.opencodeConfig.sections.server.placeholders.corsOrigin')"
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
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.server.cors.advancedLabel')
            }}</span>
            <textarea
              v-model="serverCors"
              rows="4"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              :placeholder="t('settings.opencodeConfig.sections.server.placeholders.corsOrigin')"
            />
          </div>
        </div>

        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">
              {{ t('settings.opencodeConfig.sections.server.watcherIgnore.title') }}
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('common.clear')"
                :aria-label="t('settings.opencodeConfig.sections.server.watcherIgnore.clearAria')"
                @click="watcherIgnoreArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.clear') }}</template>
            </Tooltip>
          </div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.server.watcherIgnore.help') }}
          </div>
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
            <span v-if="watcherIgnoreArr.length === 0" class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.common.none')
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <InlineSearchAdd
              :options="watcherIgnoreSuggestionOptions"
              :panel-title="t('settings.opencodeConfig.sections.server.watcherIgnore.panelTitle')"
              :placeholder="t('settings.opencodeConfig.sections.server.placeholders.watcherIgnoreGlob')"
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
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.server.watcherIgnore.advancedLabel')
            }}</span>
            <textarea
              v-model="watcherIgnore"
              rows="4"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              :placeholder="t('settings.opencodeConfig.sections.server.placeholders.watcherIgnoreAdvanced')"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
