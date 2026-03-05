<script lang="ts">
import { defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
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
    IconButton,
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
  <section
    id="agents"
    class="scroll-mt-24 rounded-lg border border-border bg-background p-4 lg:p-5 space-y-4 lg:space-y-5"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="text-base font-semibold leading-snug">{{ t('settings.opencodeConfig.sections.agents.title') }}</div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.agents.picker.count', { count: filteredAgentsList.length }) }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <IconButton
          variant="ghost"
          class="h-8 w-8"
          :title="t('settings.opencodeConfig.sections.common.resetSection')"
          @click="resetSection('agents')"
          :tooltip="t('settings.opencodeConfig.sections.common.resetSection')"
        >
          <RiRestartLine class="h-4 w-4" />
        </IconButton>
        <IconButton
          variant="outline"
          class="h-8 w-8"
          :title="
            isSectionOpen('agents')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          "
          @click="toggleSection('agents')"
          :tooltip="
            isSectionOpen('agents')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          "
        >
          <RiArrowUpSLine v-if="isSectionOpen('agents')" class="h-4 w-4" />
          <RiArrowDownSLine v-else class="h-4 w-4" />
        </IconButton>
      </div>
    </div>

    <div v-if="isSectionOpen('agents')" class="space-y-4">
      <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.agents.actions.addAgent')
          }}</span>
          <Input
            v-model="newAgentName"
            :placeholder="t('settings.opencodeConfig.sections.agents.placeholders.agentName')"
          />
        </label>
        <IconButton
          variant="outline"
          class="h-9 w-9 md:mb-[1px]"
          :title="t('settings.opencodeConfig.sections.agents.actions.addAgent')"
          :aria-label="t('settings.opencodeConfig.sections.agents.actions.addAgentAria')"
          @click="addAgent"
          :disabled="!newAgentName.trim()"
          :tooltip="t('settings.opencodeConfig.sections.agents.actions.addAgent')"
        >
          <RiAddLine class="h-4 w-4" />
        </IconButton>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.agents.placeholders.filterAgents')
          }}</span>
          <Input
            v-model="agentFilter"
            :placeholder="t('settings.opencodeConfig.sections.agents.placeholders.filterAgents')"
          />
        </label>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(280px,30%)_1fr]">
        <AgentPickerPanel />
        <AgentEditorPanel />
      </div>
    </div>
  </section>
</template>
