<script lang="ts">
import { defineComponent, ref } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiRestartLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

import ProviderBulkActions from '../providers/ProviderBulkActions.vue'
import ProviderAllowDenyLists from '../providers/ProviderAllowDenyLists.vue'
import ProviderCard from '../providers/ProviderCard.vue'

export default defineComponent({
  components: {
    Button,
    Input,
    Tooltip,
    ProviderBulkActions,
    ProviderAllowDenyLists,
    ProviderCard,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiDeleteBinLine,
    RiRefreshLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    // Default collapsed: only open when user explicitly expands.
    const openProviders = ref<Record<string, boolean>>({})
    const openModels = ref<Record<string, boolean>>({})

    function isProviderExpanded(providerId: string): boolean {
      return openProviders.value[String(providerId)] === true
    }

    function toggleProviderExpanded(providerId: string) {
      const key = String(providerId)
      openProviders.value[key] = !isProviderExpanded(key)
    }

    function modelKey(providerId: string, modelId: string): string {
      return `${String(providerId)}::${String(modelId)}`
    }

    function isModelExpanded(providerId: string, modelId: string): boolean {
      return openModels.value[modelKey(providerId, modelId)] === true
    }

    function toggleModelExpanded(providerId: string, modelId: string) {
      const key = modelKey(providerId, modelId)
      openModels.value[key] = !openModels.value[key]
    }

    return Object.assign(ctx, {
      isProviderExpanded,
      toggleProviderExpanded,
      isModelExpanded,
      toggleModelExpanded,
    })
  },
})
</script>

<template>
  <section id="providers" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Allow/deny lists plus provider overrides and models.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            title="Refresh health"
            aria-label="Refresh provider health"
            @click="refreshProviderHealth"
            :disabled="providerHealthLoading"
          >
            <RiRefreshLine class="h-4 w-4" :class="providerHealthLoading ? 'animate-spin' : ''" />
          </Button>
          <template #content>Refresh health</template>
        </Tooltip>
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('providers')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('providers') ? 'Collapse' : 'Expand'"
            @click="toggleSection('providers')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('providers')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('providers') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('providers')" class="space-y-4">
      <ProviderBulkActions />
    </div>

    <ProviderAllowDenyLists />

    <div class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="newProviderId" placeholder="New provider id" class="max-w-xs" type="text" />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            title="Add provider"
            aria-label="Add provider"
            @click="addProvider"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>Add provider</template>
        </Tooltip>
      </div>
      <div v-if="providersList.length === 0" class="text-xs text-muted-foreground">No providers configured.</div>
      <ProviderCard
        v-for="[providerId, provider] in providersList"
        :key="providerId"
        :provider-id="providerId"
        :provider="provider"
      />
    </div>
  </section>
</template>
