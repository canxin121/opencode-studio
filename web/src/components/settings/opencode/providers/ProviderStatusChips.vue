<script setup lang="ts">
import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

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
      {{ isProviderSelectable(providerId).ok ? 'Selectable' : 'Excluded' }}
    </span>
    <span v-if="!isProviderSelectable(providerId).ok" class="text-muted-foreground">{{
      isProviderSelectable(providerId).reason
    }}</span>
    <span v-if="providerRemoteInfo(providerId)?.source" class="text-muted-foreground">
      source: {{ providerRemoteInfo(providerId)?.source }}
    </span>
    <span v-if="providerRequiredEnv(providerId).length" class="text-muted-foreground">
      env: {{ providerRequiredEnv(providerId).length - providerEnvMissing(providerId).length }}/{{
        providerRequiredEnv(providerId).length
      }}
      set
    </span>
    <span v-if="providerEnvMissing(providerId).length" class="text-amber-600">
      missing: {{ providerEnvMissing(providerId).slice(0, 3).join(', ')
      }}{{ providerEnvMissing(providerId).length > 3 ? ', …' : '' }}
    </span>
    <span v-if="providerSources[providerId]" class="text-muted-foreground">
      cfg:{{ providerSources[providerId]?.user?.exists ? ' user' : ''
      }}{{ providerSources[providerId]?.project?.exists ? ' project' : ''
      }}{{ providerSources[providerId]?.custom?.exists ? ' custom' : ''
      }}{{ providerSources[providerId]?.auth?.exists ? ' auth' : '' }}
    </span>
    <span v-else-if="providerSourcesError[providerId]" class="text-amber-600"
      >sources: {{ providerSourcesError[providerId] }}</span
    >
  </div>
</template>
