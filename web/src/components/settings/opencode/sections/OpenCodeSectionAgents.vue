<script lang="ts">
import { defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

import AgentEditorPanel from '../agents/AgentEditorPanel.vue'
import AgentPickerPanel from '../agents/AgentPickerPanel.vue'

export default defineComponent({
  components: {
    AgentEditorPanel,
    AgentPickerPanel,
    Button,
    Input,
    Tooltip,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiRestartLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <section id="agents" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">{{ t('settings.opencodeConfig.sections.agents.title') }}</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('agents')"
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
              isSectionOpen('agents')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('agents')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('agents')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('agents')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('agents')" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="newAgentName"
          :placeholder="t('settings.opencodeConfig.sections.agents.placeholders.agentName')"
          class="max-w-xs"
        />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :title="t('settings.opencodeConfig.sections.agents.actions.addAgent')"
            :aria-label="t('settings.opencodeConfig.sections.agents.actions.addAgentAria')"
            @click="addAgent"
            :disabled="!newAgentName.trim()"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.agents.actions.addAgent') }}</template>
        </Tooltip>
        <div class="flex-1" />
        <Input
          v-model="agentFilter"
          :placeholder="t('settings.opencodeConfig.sections.agents.placeholders.filterAgents')"
          class="max-w-sm"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
        <AgentPickerPanel />
        <AgentEditorPanel />
      </div>
    </div>
  </section>
</template>
