<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

import AgentEditorPanel from '../agents/AgentEditorPanel.vue'

export default defineComponent({
  components: {
    AgentEditorPanel,
    Button,
    IconButton,
    Input,
    Tooltip,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const expandedAgentId = ref<string | null>(null)

    function safeDomId(raw: string): string {
      return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .slice(0, 64)
    }

    function agentPanelDomId(agentId: string): string {
      return `oc-agent-panel-${safeDomId(agentId) || 'unknown'}`
    }

    function agentLabelDomId(agentId: string): string {
      return `oc-agent-label-${safeDomId(agentId) || 'unknown'}`
    }

    const expandedAgentPanelSelector = computed(() => {
      const id = expandedAgentId.value
      if (!id) return ''
      return `#${agentPanelDomId(id)}`
    })

    function setExpandedAgent(agentId: string | null) {
      const next = agentId ? String(agentId).trim() : ''
      expandedAgentId.value = next || null
      try {
        ctx.selectAgent?.(expandedAgentId.value)
      } catch {
        // ignore
      }
    }

    function toggleAgentExpanded(agentId: string) {
      const id = String(agentId || '').trim()
      if (!id) return
      setExpandedAgent(expandedAgentId.value === id ? null : id)
    }

    function isAgentExpanded(agentId: string) {
      return expandedAgentId.value === String(agentId || '').trim()
    }

    function clearExpandedAgent() {
      setExpandedAgent(null)
    }

    watch(
      () => String(ctx.effectiveSelectedAgentId || '').trim(),
      (next) => {
        const id = next || ''
        if (!id) {
          if (expandedAgentId.value) expandedAgentId.value = null
          return
        }
        if (expandedAgentId.value !== id) expandedAgentId.value = id
      },
    )

    watch(
      () => (Array.isArray(ctx.filteredAgentsList) ? ctx.filteredAgentsList.map((r: any) => String(r?.[0] || '')) : []),
      (ids) => {
        const openId = expandedAgentId.value
        if (!openId) return
        if (!ids.includes(openId)) {
          clearExpandedAgent()
        }
      },
      { deep: true },
    )

    return Object.assign(ctx, {
      expandedAgentId,
      expandedAgentPanelSelector,
      agentPanelDomId,
      agentLabelDomId,
      toggleAgentExpanded,
      isAgentExpanded,
      clearExpandedAgent,
    })
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

      <div class="rounded-md border border-border bg-muted/10 p-3 lg:p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.agents.picker.count', { count: filteredAgentsList.length }) }}
          </div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :title="t('common.clear')"
              :aria-label="t('common.clear')"
              @click="clearExpandedAgent"
              :disabled="!expandedAgentId"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('common.clear') }}</template>
          </Tooltip>
        </div>

        <div v-if="optionsLoading" class="text-[11px] text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="optionsError" class="text-[11px] text-amber-700 break-words">
          {{ String(optionsError) }}
        </div>

        <div v-if="filteredAgentsList.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.agents.picker.empty') }}
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="row in filteredAgentsList"
            :key="`agent-row:${row[0]}`"
            class="rounded-md border border-border bg-background/40 p-3 space-y-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2 min-w-0">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8 flex-shrink-0"
                    :title="
                      isAgentExpanded(row[0])
                        ? t('settings.opencodeConfig.sections.common.collapse')
                        : t('settings.opencodeConfig.sections.common.expand')
                    "
                    :aria-label="
                      isAgentExpanded(row[0])
                        ? t('settings.opencodeConfig.sections.common.collapse')
                        : t('settings.opencodeConfig.sections.common.expand')
                    "
                    :aria-expanded="isAgentExpanded(row[0])"
                    :aria-controls="agentPanelDomId(row[0])"
                    @click="toggleAgentExpanded(row[0])"
                  >
                    <RiArrowUpSLine v-if="isAgentExpanded(row[0])" class="h-4 w-4" />
                    <RiArrowDownSLine v-else class="h-4 w-4" />
                  </Button>
                  <template #content>{{
                    isAgentExpanded(row[0])
                      ? t('settings.opencodeConfig.sections.common.collapse')
                      : t('settings.opencodeConfig.sections.common.expand')
                  }}</template>
                </Tooltip>

                <button
                  :id="agentLabelDomId(row[0])"
                  type="button"
                  class="min-w-0 text-left rounded-md -m-1 p-1 hover:bg-muted/40"
                  :aria-expanded="isAgentExpanded(row[0])"
                  :aria-controls="agentPanelDomId(row[0])"
                  @click="toggleAgentExpanded(row[0])"
                >
                  <div class="font-mono text-xs truncate">@{{ row[0] }}</div>
                  <div class="text-[11px] text-muted-foreground line-clamp-2 break-words">
                    {{ row[1]?.description || row[1]?.mode || '' }}
                  </div>
                </button>
              </div>

              <div class="flex items-center gap-1 flex-shrink-0">
                <span
                  v-if="row[1]?.disable === true"
                  class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
                  >{{ t('settings.opencodeConfig.sections.agents.picker.badges.disabled') }}</span
                >
                <span
                  v-if="row[1]?.hidden === true"
                  class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
                  >{{ t('settings.opencodeConfig.sections.agents.picker.badges.hidden') }}</span
                >
              </div>
            </div>

            <div
              v-show="isAgentExpanded(row[0])"
              :id="agentPanelDomId(row[0])"
              role="region"
              :aria-labelledby="agentLabelDomId(row[0])"
              class="pt-3 border-t border-border/60"
            />
          </div>
        </div>

        <Teleport v-if="expandedAgentId && expandedAgentPanelSelector" :to="expandedAgentPanelSelector">
          <AgentEditorPanel embedded />
        </Teleport>
      </div>
    </div>
  </section>
</template>
