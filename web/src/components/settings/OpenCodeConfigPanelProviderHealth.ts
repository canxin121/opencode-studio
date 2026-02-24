import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

type JsonValue = unknown
type JsonObject = Record<string, JsonValue>

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null
}

function asRecord(value: JsonValue): JsonObject {
  return isRecord(value) ? value : {}
}

function asStringArray(value: JsonValue): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

export function useOpenCodeConfigPanelProviderHealth(opts: {
  apiJson: <T>(path: string, init?: RequestInit) => Promise<T>
  dirQuery: () => string
  providersList: { value: Array<[string, JsonValue]> }
  providersRemote: { value: JsonValue[] }
  draft: { value: JsonValue }
  getPath: (obj: JsonValue, path: string) => JsonValue
  normalizeStringList: (value: JsonValue) => string[]
  getProviderOption: (providerId: string, key: string) => JsonValue
  // ToastKind is wider than just 'success'/'error' in this repo.
  toasts: { push: (kind: 'success' | 'error', message: string, timeoutMs?: number) => void }
}) {
  const { t } = useI18n()

  const providerEnvPresent = ref<Record<string, boolean>>({})
  const providerEnvError = ref<string | null>(null)
  const providerSources = ref<Record<string, JsonValue>>({})
  const providerSourcesError = ref<Record<string, string>>({})
  const providerHealthLoading = ref(false)
  const providerApiKeyReveal = ref<Record<string, boolean>>({})

  function providerRemoteInfo(providerId: string): JsonObject | null {
    const id = String(providerId || '').trim()
    if (!id) return null
    for (const p of opts.providersRemote.value) {
      const rec = asRecord(p)
      if (String(rec.id || '').trim() === id) return rec
    }
    return null
  }

  function providerRequiredEnv(providerId: string): string[] {
    const remote = providerRemoteInfo(providerId)
    const fromRemote = asStringArray(remote?.env)
    if (fromRemote.length) return fromRemote

    // Fallback: show provider.env from config entry if present.
    const localEnv = opts.getPath(opts.draft.value, `provider.${providerId}.env`)
    return opts.normalizeStringList(localEnv)
  }

  function providerEnvMissing(providerId: string): string[] {
    const required = providerRequiredEnv(providerId)
    return required.filter((name) => !providerEnvPresent.value[name])
  }

  async function refreshProviderHealth() {
    providerHealthLoading.value = true
    providerEnvError.value = null

    try {
      // Batch env check.
      const vars = new Set<string>()
      for (const p of opts.providersRemote.value) {
        for (const n of asStringArray(asRecord(p).env)) {
          const s = String(n || '').trim()
          if (s) vars.add(s)
        }
      }
      // Also include local provider.env keys (custom providers).
      for (const [, provider] of opts.providersList.value) {
        const env = asRecord(provider).env
        for (const n of asStringArray(env)) {
          const s = String(n || '').trim()
          if (s) vars.add(s)
        }
      }

      if (vars.size > 0) {
        try {
          const resp = await opts.apiJson<{ present: string[]; missing: string[] }>(`/api/provider/env/check`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ vars: Array.from(vars) }),
          })
          const map: Record<string, boolean> = {}
          for (const name of resp.present || []) map[String(name)] = true
          for (const name of resp.missing || []) map[String(name)] = false
          providerEnvPresent.value = map
        } catch (err) {
          providerEnvPresent.value = {}
          providerEnvError.value = err instanceof Error ? err.message : String(err)
        }
      } else {
        providerEnvPresent.value = {}
      }

      // Provider sources (auth/user/project/custom) are per-provider; best-effort.
      const ids = opts.providersList.value.map(([id]) => String(id || '').trim()).filter(Boolean)
      const nextSources: Record<string, JsonValue> = {}
      const nextErrors: Record<string, string> = {}
      await Promise.all(
        ids.map(async (id) => {
          try {
            const resp = await opts.apiJson<{ providerId: string; sources: JsonValue }>(
              `/api/provider/${encodeURIComponent(id)}/source${opts.dirQuery()}`,
            )
            nextSources[id] = resp?.sources
          } catch (err) {
            nextErrors[id] = err instanceof Error ? err.message : String(err)
          }
        }),
      )
      providerSources.value = nextSources
      providerSourcesError.value = nextErrors
    } finally {
      providerHealthLoading.value = false
    }
  }

  async function copyText(value: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(value)
      opts.toasts.push('success', okMsg)
    } catch {
      opts.toasts.push('error', t('settings.opencodeConfig.toasts.failedToCopyToClipboard'))
    }
  }

  function toggleProviderApiKey(providerId: string) {
    const cur = Boolean(providerApiKeyReveal.value[providerId])
    providerApiKeyReveal.value = { ...providerApiKeyReveal.value, [providerId]: !cur }
  }

  function copyProviderApiKey(providerId: string) {
    const v = String(opts.getProviderOption(providerId, 'apiKey') || '')
    if (!v.trim()) {
      opts.toasts.push('error', t('settings.opencodeConfig.providerHealth.apiKeyEmpty'))
      return
    }
    void copyText(v, t('settings.opencodeConfig.providerHealth.copiedApiKey'))
  }

  return {
    providerApiKeyReveal,
    providerEnvError,
    providerEnvMissing,
    providerEnvPresent,
    providerHealthLoading,
    providerRemoteInfo,
    providerRequiredEnv,
    providerSources,
    providerSourcesError,
    refreshProviderHealth,
    toggleProviderApiKey,
    copyProviderApiKey,
  }
}
