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
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

import ProviderBulkActions from '../providers/ProviderBulkActions.vue'
import ProviderAllowDenyLists from '../providers/ProviderAllowDenyLists.vue'
import ProviderCard from '../providers/ProviderCard.vue'

export default defineComponent({
  components: {
    Button,
    IconButton,
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
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.providers.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <IconButton
          variant="ghost"
          class="h-8 w-8"
          :title="t('settings.opencodeConfig.sections.providers.actions.refreshHealth')"
          :aria-label="t('settings.opencodeConfig.sections.providers.actions.refreshHealthAria')"
          @click="refreshProviderHealth"
          :disabled="providerHealthLoading"
          :tooltip="t('settings.opencodeConfig.sections.providers.actions.refreshHealth')"
        >
          <RiRefreshLine class="h-4 w-4" :class="providerHealthLoading ? 'animate-spin' : ''" />
        </IconButton>
        <IconButton
          variant="ghost"
          class="h-8 w-8"
          :title="t('settings.opencodeConfig.sections.common.resetSection')"
          @click="resetSection('providers')"
          :tooltip="t('settings.opencodeConfig.sections.common.resetSection')"
        >
          <RiRestartLine class="h-4 w-4" />
        </IconButton>
        <IconButton
          variant="outline"
          class="h-8 w-8"
          :title="
            isSectionOpen('providers')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          "
          @click="toggleSection('providers')"
          :tooltip="
            isSectionOpen('providers')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          "
        >
          <RiArrowUpSLine v-if="isSectionOpen('providers')" class="h-4 w-4" />
          <RiArrowDownSLine v-else class="h-4 w-4" />
        </IconButton>
      </div>
    </div>

    <div v-if="isSectionOpen('providers')" class="space-y-4">
      <ProviderBulkActions />
    </div>

    <ProviderAllowDenyLists />

    <div class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="newProviderId"
          :placeholder="t('settings.opencodeConfig.sections.providers.placeholders.newProviderId')"
          class="max-w-xs"
          type="text"
        />
        <IconButton
          variant="outline"
          class="h-9 w-9"
          :title="t('settings.opencodeConfig.sections.providers.actions.addProvider')"
          :aria-label="t('settings.opencodeConfig.sections.providers.actions.addProviderAria')"
          @click="addProvider"
          :tooltip="t('settings.opencodeConfig.sections.providers.actions.addProvider')"
        >
          <RiAddLine class="h-4 w-4" />
        </IconButton>
      </div>
      <div v-if="providersList.length === 0" class="text-xs text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.providers.empty') }}
      </div>
      <ProviderCard
        v-for="[providerId, provider] in providersList"
        :key="providerId"
        :provider-id="providerId"
        :provider="provider"
      />
    </div>
  </section>
</template>
