<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import MonacoCodeEditor from '@/components/MonacoCodeEditor.vue'
import CrudStringListEditor from '../CrudStringListEditor.vue'

type OptionPickerOption = PickerOption

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    VirtualList,
    MonacoCodeEditor,
    CrudStringListEditor,
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
      { value: 'http://localhost:3210' },
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

      <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.server.listsTitle') }}</div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.server.cors.title') }}</div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.server.cors.help') }}
          </div>
          <CrudStringListEditor
            v-model="serverCorsArr"
            :suggestions="corsSuggestionOptions"
            :panel-title="t('settings.opencodeConfig.sections.server.cors.panelTitle')"
            :placeholder="t('settings.opencodeConfig.sections.server.placeholders.corsOrigin')"
          />
        </div>

        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="text-sm font-semibold">
            {{ t('settings.opencodeConfig.sections.server.watcherIgnore.title') }}
          </div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.server.watcherIgnore.help') }}
          </div>
          <CrudStringListEditor
            v-model="watcherIgnoreArr"
            :suggestions="watcherIgnoreSuggestionOptions"
            :panel-title="t('settings.opencodeConfig.sections.server.watcherIgnore.panelTitle')"
            :placeholder="t('settings.opencodeConfig.sections.server.placeholders.watcherIgnoreGlob')"
          />
        </div>
      </div>
    </div>
  </section>
</template>
