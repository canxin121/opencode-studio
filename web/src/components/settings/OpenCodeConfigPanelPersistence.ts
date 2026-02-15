import { onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'

type ToastKind = 'info' | 'success' | 'error'
type PersistenceValue = unknown
type PersistenceRecord = Record<string, PersistenceValue>
type ValidationIssue = { severity?: string; [k: string]: PersistenceValue }
type ConfigScope = 'user' | 'project' | 'custom'
type RefreshArgs = { scope?: ConfigScope; directory?: string | null }

type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

function asRecord(value: PersistenceValue): PersistenceRecord {
  return typeof value === 'object' && value !== null ? (value as PersistenceRecord) : {}
}

export function useOpenCodeConfigPanelPersistence(opts: {
  configStore: {
    data: PersistenceValue
    refresh: (args?: RefreshArgs) => Promise<void>
    save: (data: PersistenceRecord, args?: RefreshArgs) => Promise<void>
  }
  scope: Ref<ConfigScope>
  directory: ComputedRef<string>
  activePath: ComputedRef<string>
  draft: Ref<PersistenceRecord>
  syncDraft: () => void
  refreshOptionLists: () => Promise<void>
  runClientValidation: () => ValidationIssue[]
  validationIssues: Ref<ValidationIssue[]>
  applyAllJsonBuffers: () => boolean
  providerListConflict: ComputedRef<string[]>
  isJsoncActivePath: ComputedRef<boolean>
  jsoncWarnEnabled: Ref<boolean>
  JSONC_WARN_KEY: string
  loadSaveMeta: () => void
  persistSaveMeta: () => void
  lastSaveOkAt: Ref<number | null>
  lastSaveError: Ref<string | null>
  lastSaveErrorAt: Ref<number | null>
  parseServerErrorMessage: (err: PersistenceValue) => string
  mapServerErrorToIssues: (msg: string) => ValidationIssue[]
  toasts: Toasts
  reloadOpenCodeConfig: () => Promise<PersistenceValue>
}) {
  const reloading = ref(false)

  function requiresJsoncRewriteConfirm(): boolean {
    return opts.isJsoncActivePath.value && opts.jsoncWarnEnabled.value
  }

  async function refresh() {
    await opts.configStore.refresh({ scope: opts.scope.value, directory: opts.directory.value || null })
    opts.syncDraft()
  }

  async function reloadOpenCode() {
    reloading.value = true
    try {
      const resp = asRecord(await opts.reloadOpenCodeConfig())
      const message = typeof resp.message === 'string' && resp.message.trim() ? resp.message : 'OpenCode reloaded'
      opts.toasts.push('success', message)
    } catch (err) {
      opts.toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      reloading.value = false
    }
  }

  async function save(saveOpts: { allowJsoncRewrite?: boolean } = {}): Promise<boolean> {
    // Clear previous save error, but keep last OK timestamp.
    opts.lastSaveError.value = null
    opts.lastSaveErrorAt.value = null

    const issues = opts.runClientValidation()
    opts.validationIssues.value = issues
    const hardErrors = issues.filter((i) => i?.severity === 'error')
    if (hardErrors.length > 0) {
      opts.toasts.push('error', `Fix validation errors before saving (${hardErrors.length})`)
      return false
    }

    if (!opts.applyAllJsonBuffers()) {
      opts.toasts.push('error', 'Fix JSON errors before saving')
      return false
    }
    if (opts.providerListConflict.value.length > 0) {
      opts.toasts.push(
        'error',
        `Providers cannot be both enabled and disabled: ${opts.providerListConflict.value.join(', ')}`,
      )
      return false
    }

    if (requiresJsoncRewriteConfirm() && !saveOpts.allowJsoncRewrite) return false

    try {
      await opts.configStore.save(opts.draft.value, {
        scope: opts.scope.value,
        directory: opts.directory.value || null,
      })
      opts.syncDraft()
      opts.toasts.push('success', 'OpenCode config saved')
      opts.lastSaveOkAt.value = Date.now()
      opts.persistSaveMeta()
      return true
    } catch (err) {
      const msg = opts.parseServerErrorMessage(err)
      opts.lastSaveError.value = msg || (err instanceof Error ? err.message : String(err))
      opts.lastSaveErrorAt.value = Date.now()
      opts.persistSaveMeta()

      // Best-effort: map server validation into field-level issues.
      const mapped = opts.mapServerErrorToIssues(opts.lastSaveError.value || '')
      if (mapped.length) opts.validationIssues.value = [...opts.validationIssues.value, ...mapped]
      opts.toasts.push('error', opts.lastSaveError.value || 'Save failed')
      return false
    }
  }

  function resetDraft() {
    opts.syncDraft()
  }

  watch(
    () => opts.configStore.data,
    () => opts.syncDraft(),
    { immediate: true },
  )

  watch(
    () => opts.scope.value,
    () => {
      void refresh()
    },
  )

  onMounted(() => {
    opts.loadSaveMeta()
    try {
      const raw = window.localStorage.getItem(opts.JSONC_WARN_KEY)
      if (raw === '0') opts.jsoncWarnEnabled.value = false
    } catch {
      // ignore
    }
    void refresh()
  })

  watch(
    () => opts.activePath.value,
    () => {
      opts.loadSaveMeta()
    },
  )

  watch(opts.jsoncWarnEnabled, (v) => {
    try {
      window.localStorage.setItem(opts.JSONC_WARN_KEY, v ? '1' : '0')
    } catch {
      // ignore
    }
  })

  watch(opts.directory, () => {
    void opts.refreshOptionLists()
  })

  return {
    refresh,
    reloadOpenCode,
    save,
    resetDraft,
    reloading,
    requiresJsoncRewriteConfirm,
  }
}
