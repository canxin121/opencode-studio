<script setup lang="ts">
import { computed } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiDeleteBinLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import type { JsonValue as JsonLike } from '@/types/json'

import ProviderStatusChips from './ProviderStatusChips.vue'
import ProviderMapsEditor from './ProviderMapsEditor.vue'
import ProviderModelsEditor from './ProviderModelsEditor.vue'
import StringListEditor from '../StringListEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

type ProviderViewModel = {
  name?: string
  api?: string
  id?: string
  npm?: string
  env?: string[]
  whitelist?: string[]
  blacklist?: string[]
}

type ProviderCardContext = {
  isProviderExpanded: (providerId: string) => boolean
  toggleProviderExpanded: (providerId: string) => void
  removeEntry: (kind: 'provider', id: string) => void
  setEntryField: (kind: 'provider', id: string, field: string, value: JsonLike) => void
  providerApiKeyReveal: Record<string, boolean>
  getProviderOption: (providerId: string, key: string) => string | number | boolean | null | undefined
  setProviderOption: (providerId: string, key: string, value: JsonLike) => void
  toggleProviderApiKey: (providerId: string) => void
  copyProviderApiKey: (providerId: string) => void
  getProviderTimeoutMode: (providerId: string) => string
  setProviderTimeoutMode: (providerId: string, mode: string) => void
  getProviderTimeoutValue: (providerId: string) => string
  setProviderTimeoutValue: (providerId: string, value: string) => void
  providerRequiredEnv?: (providerId: string) => string[]
  modelSlugOptions?: string[]
}

const props = defineProps<{ providerId: string; provider: ProviderViewModel }>()
const ctx = useOpencodeConfigPanelContext<ProviderCardContext>()

const {
  isProviderExpanded,
  toggleProviderExpanded,
  removeEntry,
  setEntryField,
  providerApiKeyReveal,
  getProviderOption,
  setProviderOption,
  toggleProviderApiKey,
  copyProviderApiKey,
  getProviderTimeoutMode,
  setProviderTimeoutMode,
  getProviderTimeoutValue,
  setProviderTimeoutValue,
} = ctx

const providerId = props.providerId
const provider = props.provider

const providerEnvSuggestions = computed(() => {
  const out = new Set<string>()
  const required = typeof ctx.providerRequiredEnv === 'function' ? ctx.providerRequiredEnv(providerId) : []
  if (Array.isArray(required)) {
    for (const item of required) {
      const value = String(item || '').trim()
      if (value) out.add(value)
    }
  }
  const local = Array.isArray(provider?.env) ? provider.env : []
  for (const item of local) {
    const value = String(item || '').trim()
    if (value) out.add(value)
  }
  return Array.from(out)
})

const providerModelSuggestions = computed(() => {
  const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
  return list.map((item) => String(item || '').trim()).filter(Boolean)
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1 min-w-0">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="isProviderExpanded(providerId) ? 'Collapse' : 'Expand'"
            :aria-label="isProviderExpanded(providerId) ? 'Collapse provider' : 'Expand provider'"
            @click="toggleProviderExpanded(providerId)"
          >
            <RiArrowUpSLine v-if="isProviderExpanded(providerId)" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isProviderExpanded(providerId) ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
        <div class="font-mono text-sm font-semibold break-all">{{ providerId }}</div>
      </div>
      <Tooltip>
        <Button
          size="icon"
          variant="ghost-destructive"
          class="h-8 w-8"
          title="Remove"
          aria-label="Remove provider"
          @click="removeEntry('provider', providerId)"
        >
          <RiDeleteBinLine class="h-4 w-4" />
        </Button>
        <template #content>Remove</template>
      </Tooltip>
    </div>

    <div v-if="isProviderExpanded(providerId)" class="space-y-4">
      <ProviderStatusChips :provider-id="providerId" />

      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Display name</span>
          <Input
            :model-value="provider.name || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'name', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">API base URL</span>
          <Input
            :model-value="provider.api || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'api', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">ID override</span>
          <Input
            :model-value="provider.id || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'id', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">NPM package</span>
          <Input
            :model-value="provider.npm || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'npm', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Environment variables</span>
          <StringListEditor
            :model-value="provider.env || []"
            :suggestions="providerEnvSuggestions"
            panel-title="Environment variables"
            placeholder="OPENAI_API_KEY"
            split-mode="lines"
            :advanced-rows="3"
            advanced-placeholder="OPENAI_API_KEY"
            @update:model-value="(v) => setEntryField('provider', providerId, 'env', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Whitelist models</span>
          <StringListEditor
            :model-value="provider.whitelist || []"
            :suggestions="providerModelSuggestions"
            panel-title="Model slugs"
            placeholder="gpt-4.1"
            split-mode="tags"
            :advanced-rows="3"
            advanced-placeholder="gpt-4.1"
            @update:model-value="(v) => setEntryField('provider', providerId, 'whitelist', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Blacklist models</span>
          <StringListEditor
            :model-value="provider.blacklist || []"
            :suggestions="providerModelSuggestions"
            panel-title="Model slugs"
            placeholder="gpt-3.5"
            split-mode="tags"
            :advanced-rows="3"
            advanced-placeholder="gpt-3.5"
            @update:model-value="(v) => setEntryField('provider', providerId, 'blacklist', v)"
          />
        </label>
      </div>

      <div class="grid gap-3">
        <div class="text-sm font-semibold">Options</div>
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">API key</span>
            <div class="flex items-center gap-2">
              <Input
                :type="providerApiKeyReveal[providerId] ? 'text' : 'password'"
                :model-value="String(getProviderOption(providerId, 'apiKey') || '')"
                @update:model-value="(v) => setProviderOption(providerId, 'apiKey', v)"
                placeholder="(not set)"
              />
              <Button size="sm" variant="ghost" @click="toggleProviderApiKey(providerId)">
                {{ providerApiKeyReveal[providerId] ? 'Hide' : 'Reveal' }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                @click="copyProviderApiKey(providerId)"
                :disabled="!String(getProviderOption(providerId, 'apiKey') || '').trim()"
              >
                Copy
              </Button>
            </div>
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Base URL</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'baseURL') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'baseURL', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Enterprise URL</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'enterpriseUrl') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'enterpriseUrl', v)"
            />
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'setCacheKey') === true"
              @change="(e) => setProviderOption(providerId, 'setCacheKey', (e.target as HTMLInputElement).checked)"
            />
            Set cache key
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'includeUsage') === true"
              @change="(e) => setProviderOption(providerId, 'includeUsage', (e.target as HTMLInputElement).checked)"
            />
            Include usage
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'useCompletionUrls') === true"
              @change="
                (e) => setProviderOption(providerId, 'useCompletionUrls', (e.target as HTMLInputElement).checked)
              "
            />
            Use completion URLs
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Timeout</span>
            <select
              :value="getProviderTimeoutMode(providerId)"
              @change="(e) => setProviderTimeoutMode(providerId, (e.target as HTMLSelectElement).value)"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="default">default</option>
              <option value="disabled">disabled</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label v-if="getProviderTimeoutMode(providerId) === 'custom'" class="grid gap-1">
            <span class="text-xs text-muted-foreground">Timeout (ms)</span>
            <input
              :value="getProviderTimeoutValue(providerId)"
              @input="(e) => setProviderTimeoutValue(providerId, (e.target as HTMLInputElement).value)"
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Region</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'region') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'region', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Profile</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'profile') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'profile', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Endpoint</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'endpoint') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'endpoint', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Project</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'project') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'project', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Location</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'location') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'location', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Deployment ID</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'deploymentId') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'deploymentId', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Resource group</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'resourceGroup') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'resourceGroup', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">GitLab instance URL</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'instanceUrl') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'instanceUrl', v)"
            />
          </label>
        </div>

        <ProviderMapsEditor :provider-id="providerId" />
      </div>
    </div>

    <ProviderModelsEditor :provider-id="providerId" />
  </div>
</template>
