<script setup lang="ts">
import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ providerId: string }>()
type ProviderStatusContext = {
  isProviderSelectable: (providerId: string) => { ok: boolean; reason: string }
  providerRemoteInfo: (providerId: string) => { source?: string } | null
  providerRequiredEnv: (providerId: string) => string[]
  providerEnvMissing: (providerId: string) => string[]
  providerSources: Record<string, Record<string, { exists?: boolean }>>
  providerSourcesError: Record<string, string>
}
const ctx = useOpencodeConfigPanelContext<ProviderStatusContext>()

const { t } = useI18n()

const {
  isProviderSelectable,
  providerRemoteInfo,
  providerRequiredEnv,
  providerEnvMissing,
  providerSources,
  providerSourcesError,
} = ctx

const providerId = props.providerId
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span
      class="rounded-full border border-border px-2 py-0.5"
      :class="
        isProviderSelectable(providerId).ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'
      "
    >
      {{
        isProviderSelectable(providerId).ok
          ? t('settings.opencodeConfig.sections.providers.statusChips.selectable')
          : t('settings.opencodeConfig.sections.providers.statusChips.excluded')
      }}
    </span>
    <span v-if="!isProviderSelectable(providerId).ok" class="text-muted-foreground">{{
      isProviderSelectable(providerId).reason
    }}</span>
    <span v-if="providerRemoteInfo(providerId)?.source" class="text-muted-foreground">
      {{ t('settings.opencodeConfig.sections.providers.statusChips.source') }}:
      {{ providerRemoteInfo(providerId)?.source }}
    </span>
    <span v-if="providerRequiredEnv(providerId).length" class="text-muted-foreground">
      {{
        t('settings.opencodeConfig.sections.providers.statusChips.envSet', {
          set: providerRequiredEnv(providerId).length - providerEnvMissing(providerId).length,
          total: providerRequiredEnv(providerId).length,
        })
      }}
    </span>
    <span v-if="providerEnvMissing(providerId).length" class="text-amber-600">
      {{ t('settings.opencodeConfig.sections.providers.statusChips.missing') }}:
      {{ providerEnvMissing(providerId).slice(0, 3).join(', ')
      }}{{ providerEnvMissing(providerId).length > 3 ? ', …' : '' }}
    </span>
    <span v-if="providerSources[providerId]" class="text-muted-foreground">
      {{ t('settings.opencodeConfig.sections.providers.statusChips.cfg') }}:{{
        providerSources[providerId]?.user?.exists
          ? ` ${t('settings.opencodeConfig.sections.providers.statusChips.cfgSources.user')}`
          : ''
      }}{{
        providerSources[providerId]?.project?.exists
          ? ` ${t('settings.opencodeConfig.sections.providers.statusChips.cfgSources.project')}`
          : ''
      }}{{
        providerSources[providerId]?.custom?.exists
          ? ` ${t('settings.opencodeConfig.sections.providers.statusChips.cfgSources.custom')}`
          : ''
      }}{{
        providerSources[providerId]?.auth?.exists
          ? ` ${t('settings.opencodeConfig.sections.providers.statusChips.cfgSources.auth')}`
          : ''
      }}
    </span>
    <span v-else-if="providerSourcesError[providerId]" class="text-amber-600">{{
      t('settings.opencodeConfig.sections.providers.statusChips.sourcesError', {
        error: providerSourcesError[providerId],
      })
    }}</span>
  </div>
</template>
