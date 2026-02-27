import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { i18n } from '@/i18n'
import { apiJson } from '@/lib/api'
import {
  desktopInstallerUpdate,
  desktopOpenExternal,
  desktopRuntimeInfo,
  desktopServiceUpdate,
  desktopUpdateProgressGet,
  isDesktopRuntime,
  type DesktopUpdateProgress,
} from '@/lib/desktopConfig'
import { useSettingsStore } from '@/stores/settings'
import { useToastsStore } from '@/stores/toasts'

type ReleaseAssetLink = {
  name: string
  url: string
  installerType: string
  manager: string
}

type InstallerSelectionError = {
  code: string
  message: string
  expectedTarget?: string
  expectedInstallerType?: string
  expectedManager?: string
  availableIdentities?: Array<{ installerType: string; manager: string }>
}

type ReleaseSummary = {
  tag: string
  version: string
  url: string
  body?: string
  publishedAt?: string
}

type ServiceUpdateStatus = {
  currentVersion: string
  latestVersion?: string
  available: boolean
  target?: string
  assetName?: string
  assetUrl?: string
  updateCommand?: string
}

type InstallerUpdateStatus = {
  currentVersion: string
  latestVersion?: string
  available: boolean
  target?: string
  channel: string
  assets?: ReleaseAssetLink[]
  primaryAssetName?: string
  primaryAssetUrl?: string
  selectionError?: InstallerSelectionError
}

type UpdateCheckResponse = {
  source: string
  repo: string
  checkedAt: string
  release?: ReleaseSummary
  service: ServiceUpdateStatus
  installer?: InstallerUpdateStatus
  error?: string
}

type UpdateActionResult = {
  ok: boolean
  error?: string
}

type ReminderSuppressionReason = 'none' | 'ignored' | 'snoozed'
type RuntimeMode = 'service' | 'desktop'

function serviceFallback(): ServiceUpdateStatus {
  return {
    currentVersion: '-',
    available: false,
  }
}

function normalizeQueryValue(raw: string | null | undefined): string {
  return String(raw || '').trim()
}

function actionResult(error?: string): UpdateActionResult {
  const message = normalizeQueryValue(error)
  return message ? { ok: false, error: message } : { ok: true }
}

function sanitizeSnoozeTimestamp(raw: unknown): number {
  const asNumber = Number(raw)
  if (!Number.isFinite(asNumber) || asNumber <= 0) return 0
  return Math.floor(asNumber)
}

function computeProgressPercent(progress: DesktopUpdateProgress | null): number | null {
  if (!progress) return null
  const total = Number(progress.totalBytes || 0)
  if (!Number.isFinite(total) || total <= 0) return null
  const downloaded = Math.max(0, Number(progress.downloadedBytes || 0))
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)))
}

export const useUpdatesStore = defineStore('updates', () => {
  const settings = useSettingsStore()
  const toasts = useToastsStore()

  const loading = ref(false)
  const error = ref<string | null>(null)
  const checkedAt = ref<string | null>(null)
  const repo = ref('')
  const source = ref('')
  const release = ref<ReleaseSummary | null>(null)
  const service = ref<ServiceUpdateStatus>(serviceFallback())
  const installer = ref<InstallerUpdateStatus | null>(null)
  const runtimeMode = ref<RuntimeMode>(isDesktopRuntime() ? 'desktop' : 'service')
  const lastPromptKey = ref('')
  const lastAutoApplyKey = ref('')
  const serviceUpdating = ref(false)
  const installerUpdating = ref(false)
  const serviceProgress = ref<DesktopUpdateProgress | null>(null)
  const installerProgress = ref<DesktopUpdateProgress | null>(null)

  let progressPollTimer: number | null = null

  const showServiceUpdates = computed(() => runtimeMode.value === 'service')
  const showInstallerUpdates = computed(() => runtimeMode.value === 'desktop')
  const serviceAvailable = computed(() => showServiceUpdates.value && service.value.available === true)
  const installerAvailable = computed(() => showInstallerUpdates.value && installer.value?.available === true)
  const anyAvailable = computed(() => serviceAvailable.value || installerAvailable.value)
  const autoCheckEnabled = computed(() => settings.data?.updateAutoCheckEnabled !== false)
  const autoPromptEnabled = computed(() => settings.data?.updateAutoPromptEnabled !== false)
  const autoServiceInstallEnabled = computed(() => settings.data?.updateAutoServiceInstallEnabled === true)
  const autoInstallerInstallEnabled = computed(() => settings.data?.updateAutoInstallerInstallEnabled === true)
  const ignoredReleaseTag = computed(() => normalizeQueryValue(settings.data?.updateIgnoredReleaseTag || ''))
  const reminderSnoozeUntil = computed(() => sanitizeSnoozeTimestamp(settings.data?.updateReminderSnoozeUntil))
  const reminderSnoozed = computed(() => reminderSnoozeUntil.value > Date.now())
  const currentReleaseIgnored = computed(() => {
    const currentTag = normalizeQueryValue(release.value?.tag || '')
    return currentTag.length > 0 && currentTag === ignoredReleaseTag.value
  })
  const serviceProgressPercent = computed(() => computeProgressPercent(serviceProgress.value))
  const installerProgressPercent = computed(() => computeProgressPercent(installerProgress.value))

  function reminderSuppressionForReleaseTag(releaseTag: string): ReminderSuppressionReason {
    const tag = normalizeQueryValue(releaseTag)
    if (tag && tag === ignoredReleaseTag.value) {
      return 'ignored'
    }
    if (reminderSnoozeUntil.value > Date.now()) {
      return 'snoozed'
    }
    return 'none'
  }

  function releaseKeyFromResponse(resp: UpdateCheckResponse): string {
    return normalizeQueryValue(resp.release?.tag || resp.service.latestVersion || '')
  }

  function buildPromptKey(resp: UpdateCheckResponse): string {
    const releaseKey = releaseKeyFromResponse(resp)
    return [
      releaseKey,
      showServiceUpdates.value && resp.service.available ? 'service' : '',
      showInstallerUpdates.value && resp.installer?.available ? 'installer' : '',
    ]
      .filter((part) => part.length > 0)
      .join('|')
  }

  async function openUrl(url: string): Promise<boolean> {
    const href = normalizeQueryValue(url)
    if (!href) return false
    if (!/^https?:\/\//i.test(href)) return false

    try {
      await desktopOpenExternal(href)
      return true
    } catch {
      return false
    }
  }

  async function openReleasePage(): Promise<boolean> {
    return await openUrl(String(release.value?.url || ''))
  }

  async function setAutoCheckEnabled(enabled: boolean) {
    await settings.save({ updateAutoCheckEnabled: enabled === true })
  }

  async function setAutoPromptEnabled(enabled: boolean) {
    await settings.save({ updateAutoPromptEnabled: enabled === true })
  }

  async function setAutoServiceInstallEnabled(enabled: boolean) {
    await settings.save({ updateAutoServiceInstallEnabled: enabled === true })
  }

  async function setAutoInstallerInstallEnabled(enabled: boolean) {
    await settings.save({ updateAutoInstallerInstallEnabled: enabled === true })
  }

  async function ignoreCurrentReleaseVersion(): Promise<UpdateActionResult> {
    const tag = normalizeQueryValue(release.value?.tag || service.value.latestVersion || '')
    if (!tag) return actionResult('No current release version to ignore')
    try {
      await settings.save({
        updateIgnoredReleaseTag: tag,
        updateReminderSnoozeUntil: 0,
      })
      return actionResult()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return actionResult(msg)
    }
  }

  async function snoozeReminder(hours = 24): Promise<UpdateActionResult> {
    const safeHours = Math.max(1, Math.floor(hours || 24))
    const until = Date.now() + safeHours * 60 * 60 * 1000
    try {
      await settings.save({
        updateReminderSnoozeUntil: until,
      })
      return actionResult()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return actionResult(msg)
    }
  }

  async function clearReminderSuppression(): Promise<UpdateActionResult> {
    try {
      await settings.save({
        updateIgnoredReleaseTag: null,
        updateReminderSnoozeUntil: 0,
      })
      return actionResult()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return actionResult(msg)
    }
  }

  function maybeNotifyForUpdate(resp: UpdateCheckResponse, opts?: { forcePrompt?: boolean }) {
    const serviceVisibleAvailable = showServiceUpdates.value && resp.service.available
    const installerVisibleAvailable = showInstallerUpdates.value && !!resp.installer?.available
    if (!serviceVisibleAvailable && !installerVisibleAvailable) return

    const releaseTag = releaseKeyFromResponse(resp)
    const suppression = reminderSuppressionForReleaseTag(releaseTag)
    if (!opts?.forcePrompt && (suppression === 'ignored' || suppression === 'snoozed')) return
    if (!opts?.forcePrompt && !autoPromptEnabled.value) return

    const promptKey = buildPromptKey(resp)
    if (promptKey && promptKey === lastPromptKey.value && !opts?.forcePrompt) {
      return
    }
    lastPromptKey.value = promptKey

    if (installerVisibleAvailable) {
      toasts.push(
        'info',
        String(
          i18n.global.t('settings.desktopRuntime.updates.toasts.installerAvailable', {
            version: resp.installer?.latestVersion || resp.release?.version || '',
          }),
        ),
        5000,
      )
      return
    }

    if (serviceVisibleAvailable) {
      toasts.push(
        'info',
        String(
          i18n.global.t('settings.desktopRuntime.updates.toasts.serviceAvailable', {
            version: resp.service.latestVersion || resp.release?.version || '',
          }),
        ),
        5000,
      )
    }
  }

  function stopProgressPolling() {
    if (progressPollTimer !== null) {
      window.clearInterval(progressPollTimer)
      progressPollTimer = null
    }
  }

  async function pullProgressSnapshot(): Promise<DesktopUpdateProgress | null> {
    const progress = await desktopUpdateProgressGet().catch(() => null)
    if (!progress) return null

    if (progress.kind === 'service') {
      serviceProgress.value = progress
    }
    if (progress.kind === 'installer') {
      installerProgress.value = progress
    }

    if (!progress.running) {
      stopProgressPolling()
    }
    return progress
  }

  function startProgressPolling(kind: 'service' | 'installer') {
    stopProgressPolling()
    if (kind === 'service') {
      serviceProgress.value = {
        running: true,
        kind: 'service',
        phase: 'preparing',
        message: '',
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      }
    } else {
      installerProgress.value = {
        running: true,
        kind: 'installer',
        phase: 'preparing',
        message: '',
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      }
    }

    progressPollTimer = window.setInterval(() => {
      void pullProgressSnapshot()
    }, 400)
    void pullProgressSnapshot()
  }

  async function applyServiceUpdateInternal(assetUrl: string): Promise<UpdateActionResult> {
    const url = normalizeQueryValue(assetUrl)
    if (!url) return actionResult('Missing service update package URL')
    if (serviceUpdating.value) return actionResult('Service update is already running')

    serviceUpdating.value = true
    startProgressPolling('service')
    try {
      await desktopServiceUpdate(url)
      await pullProgressSnapshot()
      await checkForUpdates({ notify: false, autoApply: false })
      return actionResult()
    } catch (err) {
      await pullProgressSnapshot()
      const fallback = err instanceof Error ? err.message : String(err)
      return actionResult(serviceProgress.value?.error || fallback)
    } finally {
      serviceUpdating.value = false
      stopProgressPolling()
    }
  }

  async function applyInstallerUpdateInternal(assetUrl: string, assetName?: string): Promise<UpdateActionResult> {
    const url = normalizeQueryValue(assetUrl)
    if (!url) return actionResult('Missing desktop installer package URL')
    if (installerUpdating.value) return actionResult('Desktop installer update is already running')

    installerUpdating.value = true
    startProgressPolling('installer')
    try {
      await desktopInstallerUpdate(url, normalizeQueryValue(assetName) || undefined)
      await pullProgressSnapshot()
      return actionResult()
    } catch (err) {
      await pullProgressSnapshot()
      const fallback = err instanceof Error ? err.message : String(err)
      return actionResult(installerProgress.value?.error || fallback)
    } finally {
      installerUpdating.value = false
      stopProgressPolling()
    }
  }

  async function applyServiceUpdate(): Promise<UpdateActionResult> {
    return await applyServiceUpdateInternal(service.value.assetUrl || '')
  }

  async function applyInstallerUpdate(): Promise<UpdateActionResult> {
    if (!installer.value?.primaryAssetUrl) {
      return actionResult(
        installer.value?.selectionError?.message || 'No compatible installer candidate for current runtime',
      )
    }
    return await applyInstallerUpdateInternal(installer.value?.primaryAssetUrl || '', installer.value?.primaryAssetName)
  }

  async function maybeAutoApply(resp: UpdateCheckResponse, runtimeAvailable: boolean) {
    if (!runtimeAvailable) return
    if (!showInstallerUpdates.value) return
    if (serviceUpdating.value || installerUpdating.value) return

    const releaseTag = releaseKeyFromResponse(resp)
    const suppression = reminderSuppressionForReleaseTag(releaseTag)
    if (suppression === 'ignored' || suppression === 'snoozed') return

    const autoKey = buildPromptKey(resp)
    if (!autoKey || autoKey === lastAutoApplyKey.value) return

    let applied = false
    if (autoInstallerInstallEnabled.value && resp.installer?.available) {
      const result = await applyInstallerUpdateInternal(
        resp.installer.primaryAssetUrl || '',
        resp.installer.primaryAssetName,
      )
      if (!result.ok) {
        toasts.push(
          'error',
          String(
            i18n.global.t('settings.desktopRuntime.updates.toasts.autoInstallerFailed', {
              error: result.error || '',
            }),
          ),
        )
      } else {
        applied = true
      }
    }

    if (applied) {
      lastAutoApplyKey.value = autoKey
    }
  }

  async function checkForUpdates(opts?: { notify?: boolean; forcePrompt?: boolean; autoApply?: boolean }) {
    loading.value = true
    error.value = null

    try {
      const runtime = await desktopRuntimeInfo().catch(() => null)
      const desktopRuntime = runtime !== null || isDesktopRuntime()
      runtimeMode.value = desktopRuntime ? 'desktop' : 'service'

      const query = new URLSearchParams()
      if (runtime?.installerVersion) {
        query.set('installerVersion', runtime.installerVersion)
      }
      if (runtime?.installerTarget) {
        query.set('installerTarget', runtime.installerTarget)
      }
      if (runtime?.installerChannel) {
        query.set('installerChannel', runtime.installerChannel)
      }
      if (runtime?.installerType) {
        query.set('installerType', runtime.installerType)
      }
      if (runtime?.installerManager) {
        query.set('installerManager', runtime.installerManager)
      }

      const suffix = query.toString()
      const endpoint = suffix ? `/api/opencode-studio/update-check?${suffix}` : '/api/opencode-studio/update-check'
      const resp = await apiJson<UpdateCheckResponse>(endpoint)

      checkedAt.value = normalizeQueryValue(resp.checkedAt) || null
      repo.value = normalizeQueryValue(resp.repo)
      source.value = normalizeQueryValue(resp.source)
      release.value = resp.release || null
      service.value = resp.service || serviceFallback()
      installer.value = resp.installer || null
      error.value = normalizeQueryValue(resp.error) || null

      if (opts?.notify) {
        maybeNotifyForUpdate(resp, { forcePrompt: opts.forcePrompt })
      }
      if (opts?.autoApply !== false) {
        await maybeAutoApply(resp, desktopRuntime)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      service.value = serviceFallback()
      installer.value = null
      release.value = null
      runtimeMode.value = isDesktopRuntime() ? 'desktop' : 'service'
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    checkedAt,
    repo,
    source,
    release,
    service,
    installer,
    serviceUpdating,
    installerUpdating,
    serviceProgress,
    installerProgress,
    serviceProgressPercent,
    installerProgressPercent,
    ignoredReleaseTag,
    reminderSnoozeUntil,
    reminderSnoozed,
    currentReleaseIgnored,
    serviceAvailable,
    installerAvailable,
    anyAvailable,
    showServiceUpdates,
    showInstallerUpdates,
    autoCheckEnabled,
    autoPromptEnabled,
    autoServiceInstallEnabled,
    autoInstallerInstallEnabled,
    setAutoCheckEnabled,
    setAutoPromptEnabled,
    setAutoServiceInstallEnabled,
    setAutoInstallerInstallEnabled,
    ignoreCurrentReleaseVersion,
    snoozeReminder,
    clearReminderSuppression,
    checkForUpdates,
    openReleasePage,
    applyServiceUpdate,
    applyInstallerUpdate,
  }
})
