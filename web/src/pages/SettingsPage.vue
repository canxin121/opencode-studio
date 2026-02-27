<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RiArrowDownSLine, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import { useSettingsStore, type Settings } from '../stores/settings'
import { usePluginHostStore } from '@/stores/pluginHost'
import { useToastsStore } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import { i18n, setAppLocale } from '@/i18n'
import type { AppLocale } from '@/i18n/locale'

import Button from '@/components/ui/Button.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import SidebarTextButton from '@/components/ui/SidebarTextButton.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import OpenCodeConfigPanel from '@/components/settings/OpenCodeConfigPanel.vue'
import PluginSettingsPanel from '@/components/settings/PluginSettingsPanel.vue'
import BackendsPanel from '@/components/settings/BackendsPanel.vue'
import DebugPanel from '@/components/settings/DebugPanel.vue'
import Input from '@/components/ui/Input.vue'
import { opencodeSections } from '@/components/settings/opencodeSections'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import {
  desktopBackendRestart,
  desktopConfigGet,
  desktopConfigSave,
  isDesktopRuntime,
  type DesktopConfig,
} from '@/lib/desktopConfig'
import { syncDesktopBackendTarget } from '@/lib/backend'
import {
  DEFAULT_CHAT_ACTIVITY_FILTERS,
  DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS,
  DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS,
  normalizeChatActivityFilters,
  normalizeChatActivityDefaultExpanded,
  normalizeChatToolActivityFilters,
  ACTIVITY_DEFAULT_EXPANDED_OPTIONS as activityDefaultExpandedOptions,
  TOOL_ACTIVITY_OPTIONS as toolActivityOptions,
  type ChatActivityType,
  type ChatActivityExpandKey,
  type ChatToolActivityType,
} from '@/lib/chatActivity'

type SettingsTab = 'opencode' | 'plugins' | 'backends' | 'appearance' | 'debug'

const settings = useSettingsStore()
const pluginHost = usePluginHostStore()
const toasts = useToastsStore()
const ui = useUiStore()
const updates = useUpdatesStore()
const route = useRoute()
const router = useRouter()
const { startDesktopSidebarResize } = useDesktopSidebarResize()
const { t } = useI18n()

const useShellSidebar = computed(() => (ui.isMobile ? ui.isSessionSwitcherOpen : ui.isSidebarOpen))
const SETTINGS_LAST_ROUTE_KEY = 'oc2.settings.lastRoute'

function persistSettingsRoute(path: string) {
  try {
    localStorage.setItem(SETTINGS_LAST_ROUTE_KEY, path)
  } catch {
    // ignore
  }
}

const settingsSidebarClass = computed(() =>
  ui.isMobile
    ? 'relative h-full w-full border-r border-border bg-muted/10 shrink-0'
    : 'relative h-full border-r border-border bg-muted/10 shrink-0',
)

const desktopRuntimeEnabled = isDesktopRuntime()
const desktopRuntimeLoading = ref(false)
const desktopRuntimeSaving = ref(false)
const desktopBackendHost = ref('127.0.0.1')
const desktopBackendPortInput = ref('3000')
const desktopCorsOriginsText = ref('')
const desktopCorsAllowAll = ref(false)
const desktopAutostartOnBoot = ref(true)
const desktopBackendLogLevel = ref('')
const desktopUiPassword = ref('')
const desktopOpencodeHost = ref('127.0.0.1')
const desktopOpencodePortInput = ref('')
const desktopSkipOpencodeStart = ref(false)
const desktopOpencodeLogLevel = ref('')

const desktopRuntimeLogLevelOptions = computed(() => [
  { value: '', label: String(t('settings.desktopRuntime.options.logLevel.default')) },
  { value: 'DEBUG', label: String(t('settings.desktopRuntime.options.logLevel.DEBUG')) },
  { value: 'INFO', label: String(t('settings.desktopRuntime.options.logLevel.INFO')) },
  { value: 'WARN', label: String(t('settings.desktopRuntime.options.logLevel.WARN')) },
  { value: 'ERROR', label: String(t('settings.desktopRuntime.options.logLevel.ERROR')) },
])

function normalizeLogLevelInput(raw: string): string | null {
  const v = String(raw || '')
    .trim()
    .toUpperCase()
  return v === 'DEBUG' || v === 'INFO' || v === 'WARN' || v === 'ERROR' ? v : null
}

function parseCorsOriginsText(input: string): string[] {
  return String(input || '')
    .split(/\r?\n|,/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .filter((v, index, arr) => arr.indexOf(v) === index)
}

function applyDesktopRuntimeForm(cfg: DesktopConfig) {
  desktopAutostartOnBoot.value = cfg.autostart_on_boot !== false
  desktopBackendHost.value = String(cfg.backend.host || '127.0.0.1').trim() || '127.0.0.1'
  desktopBackendPortInput.value = String(cfg.backend.port || 3000)
  desktopCorsOriginsText.value = (cfg.backend.cors_origins || []).join('\n')
  desktopCorsAllowAll.value = cfg.backend.cors_allow_all === true
  desktopBackendLogLevel.value = normalizeLogLevelInput(String(cfg.backend.backend_log_level || '')) || ''
  desktopUiPassword.value = String(cfg.backend.ui_password || '')
  desktopOpencodeHost.value = String(cfg.backend.opencode_host || '127.0.0.1').trim() || '127.0.0.1'
  desktopOpencodePortInput.value = cfg.backend.opencode_port ? String(cfg.backend.opencode_port) : ''
  desktopSkipOpencodeStart.value = cfg.backend.skip_opencode_start === true
  desktopOpencodeLogLevel.value = normalizeLogLevelInput(String(cfg.backend.opencode_log_level || '')) || ''
}

async function loadDesktopRuntimeConfig() {
  if (!desktopRuntimeEnabled || desktopRuntimeLoading.value) return
  desktopRuntimeLoading.value = true
  try {
    const cfg = await desktopConfigGet()
    if (!cfg) return
    applyDesktopRuntimeForm(cfg)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg || String(t('settings.desktopRuntime.toasts.loadFailed')))
  } finally {
    desktopRuntimeLoading.value = false
  }
}

async function saveDesktopRuntimeConfig() {
  if (!desktopRuntimeEnabled || desktopRuntimeSaving.value) return

  const host = String(desktopBackendHost.value || '').trim() || '127.0.0.1'
  const parsedPort = Number.parseInt(String(desktopBackendPortInput.value || '').trim(), 10)
  if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    toasts.push('error', String(t('settings.desktopRuntime.toasts.invalidPort')))
    return
  }

  const opencodeHost = String(desktopOpencodeHost.value || '').trim() || '127.0.0.1'
  const opencodePortText = String(desktopOpencodePortInput.value || '').trim()
  const parsedOpencodePort = Number.parseInt(opencodePortText, 10)
  if (
    opencodePortText.length > 0 &&
    (!Number.isFinite(parsedOpencodePort) || parsedOpencodePort < 1 || parsedOpencodePort > 65535)
  ) {
    toasts.push('error', String(t('settings.desktopRuntime.toasts.invalidOpencodePort')))
    return
  }
  const opencodePort = opencodePortText.length > 0 ? parsedOpencodePort : null

  const uiPassword = String(desktopUiPassword.value || '')
  const normalizedUiPassword = uiPassword.trim().length > 0 ? uiPassword : null

  desktopRuntimeSaving.value = true
  try {
    const next: DesktopConfig = {
      autostart_on_boot: desktopAutostartOnBoot.value === true,
      backend: {
        host,
        port: parsedPort,
        cors_origins: parseCorsOriginsText(desktopCorsOriginsText.value),
        cors_allow_all: desktopCorsAllowAll.value === true,
        backend_log_level: normalizeLogLevelInput(desktopBackendLogLevel.value),
        ui_password: normalizedUiPassword,
        opencode_host: opencodeHost,
        opencode_port: opencodePort,
        skip_opencode_start: desktopSkipOpencodeStart.value === true,
        opencode_log_level: normalizeLogLevelInput(desktopOpencodeLogLevel.value),
      },
    }

    const saved = await desktopConfigSave(next)
    if (saved) {
      applyDesktopRuntimeForm(saved)
    }

    await desktopBackendRestart()
    await syncDesktopBackendTarget()
    toasts.push('success', String(t('settings.desktopRuntime.toasts.savedAndRestarted')))
    window.location.reload()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg || String(t('settings.desktopRuntime.toasts.saveFailed')))
  } finally {
    desktopRuntimeSaving.value = false
  }
}

const updateAutoCheckEnabled = computed<boolean>({
  get() {
    return updates.autoCheckEnabled
  },
  set(value) {
    void updates.setAutoCheckEnabled(value === true)
  },
})

const updateAutoPromptEnabled = computed<boolean>({
  get() {
    return updates.autoPromptEnabled
  },
  set(value) {
    void updates.setAutoPromptEnabled(value === true)
  },
})

const updateAutoServiceInstallEnabled = computed<boolean>({
  get() {
    return updates.autoServiceInstallEnabled
  },
  set(value) {
    void updates.setAutoServiceInstallEnabled(value === true)
  },
})

const updateAutoInstallerInstallEnabled = computed<boolean>({
  get() {
    return updates.autoInstallerInstallEnabled
  },
  set(value) {
    void updates.setAutoInstallerInstallEnabled(value === true)
  },
})

async function checkForUpdatesNow() {
  await updates.checkForUpdates({ notify: true, forcePrompt: true })
  if (updates.error) {
    toasts.push('error', String(t('settings.desktopRuntime.updates.toasts.checkFailed', { error: updates.error })))
    return
  }

  if (!updates.anyAvailable) {
    toasts.push('success', String(t('settings.desktopRuntime.updates.toasts.checkedNoUpdate')))
  }
}

async function openReleasePageForUpdate() {
  const ok = await updates.openReleasePage()
  if (!ok) {
    toasts.push('error', String(t('settings.desktopRuntime.updates.toasts.openReleaseFailed')))
  }
}

async function applyServiceUpdateNow() {
  const result = await updates.applyServiceUpdate()
  if (result.ok) {
    toasts.push('success', String(t('settings.desktopRuntime.updates.toasts.serviceUpdated')))
  } else {
    toasts.push(
      'error',
      String(t('settings.desktopRuntime.updates.toasts.serviceUpdateFailed', { error: result.error || '' })),
    )
  }
}

async function applyInstallerUpdateNow() {
  const result = await updates.applyInstallerUpdate()
  if (result.ok) {
    toasts.push('info', String(t('settings.desktopRuntime.updates.toasts.installerLaunching')))
  } else {
    toasts.push(
      'error',
      String(t('settings.desktopRuntime.updates.toasts.installerUpdateFailed', { error: result.error || '' })),
    )
  }
}

async function ignoreCurrentUpdateVersion() {
  const result = await updates.ignoreCurrentReleaseVersion()
  if (result.ok) {
    toasts.push('info', String(t('settings.desktopRuntime.updates.toasts.ignoredVersion')))
  } else {
    toasts.push(
      'error',
      String(t('settings.desktopRuntime.updates.toasts.ignoreVersionFailed', { error: result.error || '' })),
    )
  }
}

async function snoozeUpdateReminder() {
  const result = await updates.snoozeReminder(24)
  if (result.ok) {
    toasts.push('info', String(t('settings.desktopRuntime.updates.toasts.reminderSnoozed')))
  } else {
    toasts.push(
      'error',
      String(t('settings.desktopRuntime.updates.toasts.reminderSnoozeFailed', { error: result.error || '' })),
    )
  }
}

async function clearUpdateReminderSuppression() {
  const result = await updates.clearReminderSuppression()
  if (result.ok) {
    toasts.push('success', String(t('settings.desktopRuntime.updates.toasts.reminderSuppressionCleared')))
  } else {
    toasts.push(
      'error',
      String(t('settings.desktopRuntime.updates.toasts.reminderSuppressionClearFailed', { error: result.error || '' })),
    )
  }
}

const updateReminderSnoozeUntilLabel = computed(() => {
  const ts = Number(updates.reminderSnoozeUntil || 0)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  try {
    const locale = String(i18n.global.locale.value || 'en-US')
    return new Date(ts).toLocaleString(locale)
  } catch {
    return new Date(ts).toLocaleString()
  }
})

const tabs = computed<Array<{ id: SettingsTab; label: string }>>(() => [
  { id: 'opencode', label: String(t('settings.tabs.opencode')) },
  { id: 'plugins', label: String(t('settings.tabs.plugins')) },
  { id: 'backends', label: String(t('settings.tabs.backends')) },
  { id: 'appearance', label: String(t('settings.tabs.appearance')) },
  { id: 'debug', label: String(t('settings.tabs.debug')) },
])

function normalizeOpencodeSection(raw?: string): string {
  const val = (raw || '').trim().toLowerCase()
  const match = opencodeSections.find((s) => s.id === val)
  return match ? match.id : opencodeSections[0]!.id
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasSettingsSchema(pluginId: string): boolean {
  const manifest = pluginHost.getManifest(pluginId)
  const root = manifest?.manifest
  if (!isPlainObject(root)) return false
  const schema = (root as Record<string, unknown>).settingsSchema
  return isPlainObject(schema)
}

const pluginsTabPlugins = computed(() =>
  pluginHost.readyPlugins
    .filter((item) => hasSettingsSchema(item.id))
    .map((item) => ({
      id: item.id,
      label: item.displayName || item.id,
    })),
)

function normalizePluginsSection(raw?: string): string {
  const available = pluginsTabPlugins.value.map((item) => item.id)
  if (available.length === 0) return ''
  const val = String(raw || '').trim()
  return available.includes(val) ? val : available[0]!
}

const activeTab = computed<SettingsTab>(() => {
  const raw = String(route.params.tab || '').toLowerCase()
  const match = tabs.value.find((t) => t.id === raw)
  return match?.id || 'opencode'
})

const activeOpencodeSection = computed(() => {
  if (activeTab.value !== 'opencode') return null
  return normalizeOpencodeSection(route.params.section as string | undefined)
})

const activePluginsSection = computed(() => {
  if (activeTab.value !== 'plugins') return null
  return normalizePluginsSection(route.params.section as string | undefined)
})

const opencodeExpanded = ref(activeTab.value === 'opencode')
const pluginsExpanded = ref(activeTab.value === 'plugins')

function ensureSettingsRoute() {
  if (activeTab.value === 'plugins') {
    const currentSection = String(route.params.section || '')
    const normalized = normalizePluginsSection(currentSection)
    if (!normalized) {
      if (currentSection) {
        void router.replace('/settings/plugins')
      }
      return
    }
    if (!currentSection || currentSection !== normalized) {
      void router.replace(`/settings/plugins/${normalized}`)
    }
    return
  }

  if (activeTab.value !== 'opencode') {
    if (route.params.section) {
      void router.replace(`/settings/${activeTab.value}`)
    }
    return
  }
  const currentSection = (route.params.section as string | undefined) || ''
  const normalized = normalizeOpencodeSection(currentSection)
  if (!currentSection || currentSection !== normalized) {
    void router.replace(`/settings/opencode/${normalized}`)
  }
}

function goToTab(id: SettingsTab) {
  if (id === 'opencode') {
    if (activeTab.value !== 'opencode') {
      opencodeExpanded.value = true
      const section = activeOpencodeSection.value || normalizeOpencodeSection()
      void router.push(`/settings/opencode/${section}`)
    } else {
      opencodeExpanded.value = !opencodeExpanded.value
    }
    return
  }

  if (id === 'plugins') {
    if (activeTab.value !== 'plugins') {
      pluginsExpanded.value = true
      const section = activePluginsSection.value || normalizePluginsSection()
      if (section) {
        void router.push(`/settings/plugins/${section}`)
      } else {
        void router.push('/settings/plugins')
      }
    } else {
      pluginsExpanded.value = !pluginsExpanded.value
    }
    return
  }

  opencodeExpanded.value = false
  pluginsExpanded.value = false
  void router.push(`/settings/${id}`)
}

function goToOpencodeSection(id: string) {
  opencodeExpanded.value = true
  const section = normalizeOpencodeSection(id)
  void router.push(`/settings/opencode/${section}`)
}

function goToPluginsSection(id: string) {
  const section = normalizePluginsSection(id)
  if (!section) return
  pluginsExpanded.value = true
  void router.push(`/settings/plugins/${section}`)
}

onMounted(() => {
  if (!settings.data && !settings.loading) {
    void settings.refresh()
  }
  if (!pluginHost.bootstrapped && !pluginHost.loading) {
    void pluginHost.bootstrap()
  }
  if (desktopRuntimeEnabled) {
    void loadDesktopRuntimeConfig()
  }
  if (!updates.checkedAt && !updates.loading && updates.autoCheckEnabled) {
    void updates.checkForUpdates({ notify: false })
  }
})

watch(
  () => route.fullPath,
  (path) => {
    const fullPath = String(path || '')
    if (!fullPath.startsWith('/settings')) return
    persistSettingsRoute(fullPath)
  },
  { immediate: true },
)

watch(
  () => [route.params.tab, route.params.section],
  () => ensureSettingsRoute(),
  { immediate: true },
)

watch(
  () => pluginsTabPlugins.value.map((item) => item.id).join('|'),
  () => {
    if (activeTab.value === 'plugins') {
      ensureSettingsRoute()
    }
  },
)

watch(
  () => activeTab.value,
  (tab, prev) => {
    if (tab !== 'opencode') {
      opencodeExpanded.value = false
    } else if (prev !== 'opencode' && !opencodeExpanded.value) {
      opencodeExpanded.value = true
    }

    if (tab !== 'plugins') {
      pluginsExpanded.value = false
    } else if (prev !== 'plugins' && !pluginsExpanded.value) {
      pluginsExpanded.value = true
    }
  },
)

function makeSetting<K extends keyof Settings>(key: K, fallback: NonNullable<Settings[K]>) {
  return computed<NonNullable<Settings[K]>>({
    get() {
      const v = settings.data?.[key]
      // IMPORTANT: Only return the value without mutation side effects.
      return (v ?? fallback) as NonNullable<Settings[K]>
    },
    set(value: NonNullable<Settings[K]>) {
      // Direct store update without forcing a recursive re-compute of this same getter.
      void settings.save({ [key]: value } as Pick<Settings, K>)
    },
  })
}

const useSystemTheme = makeSetting('useSystemTheme', true)
const themeVariant = makeSetting('themeVariant', 'dark')
const uiFont = makeSetting('uiFont', 'ibm-plex-sans')
const monoFont = makeSetting('monoFont', 'ibm-plex-mono')
const fontSize = makeSetting('fontSize', 90)
const padding = makeSetting('padding', 100)
const cornerRadius = makeSetting('cornerRadius', 10)
const inputBarOffset = makeSetting('inputBarOffset', 0)

const uiLocale = computed<AppLocale>({
  get() {
    return i18n.global.locale.value as AppLocale
  },
  set(value) {
    setAppLocale(value)
  },
})

const localePickerOptions = computed(() => [
  { value: 'zh-CN', label: String(t('settings.appearance.language.options.zhCN')) },
  { value: 'en-US', label: String(t('settings.appearance.language.options.enUS')) },
])

const themeVariantPickerOptions = computed(() => [
  { value: 'light', label: String(t('settings.appearance.theme.options.light')) },
  { value: 'dark', label: String(t('settings.appearance.theme.options.dark')) },
])

const uiFontPickerOptions = computed(() => [
  { value: 'system', label: String(t('settings.appearance.fonts.options.system')) },
  { value: 'ibm-plex-sans', label: String(t('settings.appearance.fonts.options.ibmPlexSans')) },
  { value: 'atkinson', label: String(t('settings.appearance.fonts.options.atkinson')) },
  { value: 'serif', label: String(t('settings.appearance.fonts.options.serif')) },
])

const monoFontPickerOptions = computed(() => [
  { value: 'system', label: String(t('settings.appearance.fonts.options.system')) },
  { value: 'ibm-plex-mono', label: String(t('settings.appearance.fonts.options.ibmPlexMono')) },
  { value: 'jetbrains-mono', label: String(t('settings.appearance.fonts.options.jetbrainsMono')) },
])

const showChatTimestamps = makeSetting('showChatTimestamps', true)
const showReasoningTraces = makeSetting('showReasoningTraces', false)
const showTextJustificationActivity = makeSetting('showTextJustificationActivity', false)

const chatActivityAutoCollapseOnIdle = makeSetting('chatActivityAutoCollapseOnIdle', true)

const chatActivityDefaultExpanded = computed<ChatActivityExpandKey[]>({
  get() {
    const s = settings.data
    if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityDefaultExpanded')) {
      return normalizeChatActivityDefaultExpanded(s.chatActivityDefaultExpanded)
    }
    return DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS.slice()
  },
  set(value) {
    void settings.save({ chatActivityDefaultExpanded: value })
  },
})

function activityDefaultExpandedEnabled(id: ChatActivityExpandKey): boolean {
  return chatActivityDefaultExpanded.value.includes(id)
}

function toggleActivityDefaultExpanded(id: ChatActivityExpandKey) {
  const next = new Set(chatActivityDefaultExpanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  const ordered = DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS.filter((t) => next.has(t))
  chatActivityDefaultExpanded.value = ordered
}

function activityTransportEnabled(id: ChatActivityExpandKey): boolean {
  if (id === 'thinking') return showReasoningTraces.value
  if (id === 'justification') return showTextJustificationActivity.value
  return chatActivityFilters.value.includes(id as ChatActivityType)
}

function setActivityTransportEnabled(id: ChatActivityExpandKey, enabled: boolean) {
  if (id === 'thinking') {
    showReasoningTraces.value = enabled
  } else if (id === 'justification') {
    showTextJustificationActivity.value = enabled
  } else {
    const next = new Set(chatActivityFilters.value)
    if (enabled) next.add(id as ChatActivityType)
    else next.delete(id as ChatActivityType)
    const ordered = DEFAULT_CHAT_ACTIVITY_FILTERS.filter((t) => next.has(t))
    chatActivityFilters.value = ordered
  }

  if (!enabled) {
    const nextExpanded = new Set(chatActivityDefaultExpanded.value)
    if (nextExpanded.delete(id)) {
      chatActivityDefaultExpanded.value = DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS.filter((t) => nextExpanded.has(t))
    }
  }
}

function toggleActivityTransport(id: ChatActivityExpandKey) {
  setActivityTransportEnabled(id, !activityTransportEnabled(id))
}

const chatActivityDefaultExpandedToolFilters = computed<ChatToolActivityType[]>({
  get() {
    const s = settings.data
    if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityDefaultExpandedToolFilters')) {
      return normalizeChatToolActivityFilters(s.chatActivityDefaultExpandedToolFilters)
    }
    return []
  },
  set(value) {
    void settings.save({ chatActivityDefaultExpandedToolFilters: value })
  },
})

function activityDefaultExpandedToolEnabled(id: ChatToolActivityType): boolean {
  return chatActivityDefaultExpandedToolFilters.value.includes(id)
}

function toggleActivityDefaultExpandedTool(id: ChatToolActivityType) {
  const next = new Set(chatActivityDefaultExpandedToolFilters.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  const ordered = DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS.filter((t) => next.has(t))
  chatActivityDefaultExpandedToolFilters.value = ordered
}

function toggleToolDetailTransport(id: ChatToolActivityType) {
  const next = new Set(chatToolActivityFilters.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  const ordered = DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS.filter((t) => next.has(t))
  chatToolActivityFilters.value = ordered

  if (!next.has(id)) {
    const expanded = new Set(chatActivityDefaultExpandedToolFilters.value)
    if (expanded.delete(id)) {
      chatActivityDefaultExpandedToolFilters.value = DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS.filter((t) => expanded.has(t))
    }
  }
}

const chatActivityFilters = computed<ChatActivityType[]>({
  get() {
    const s = settings.data
    if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityFilters')) {
      return normalizeChatActivityFilters(s.chatActivityFilters)
    }
    return DEFAULT_CHAT_ACTIVITY_FILTERS.slice()
  },
  set(value) {
    void settings.save({ chatActivityFilters: value })
  },
})

const chatToolActivityFilters = computed<ChatToolActivityType[]>({
  get() {
    const s = settings.data
    if (s && Object.prototype.hasOwnProperty.call(s, 'chatActivityToolFilters')) {
      return normalizeChatToolActivityFilters(s.chatActivityToolFilters)
    }
    return DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS.slice()
  },
  set(value) {
    void settings.save({ chatActivityToolFilters: value })
  },
})

function toolActivityEnabled(id: ChatToolActivityType): boolean {
  return chatToolActivityFilters.value.includes(id)
}

const dirtyHint = computed(() => (settings.error ? settings.error : null))
</script>

<template>
  <div class="settings-page flex h-full flex-col overflow-hidden bg-background text-foreground">
    <div class="flex flex-1 overflow-hidden">
      <aside
        v-if="useShellSidebar"
        :class="settingsSidebarClass"
        :style="ui.isMobile ? undefined : { width: `${ui.sidebarWidth}px` }"
      >
        <div
          v-if="!ui.isMobile"
          class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
          @pointerdown="startDesktopSidebarResize"
        />
        <ScrollArea class="h-full">
          <div class="flex flex-col gap-1 p-3">
            <div class="mb-2 flex items-center justify-between px-1">
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ t('settings.title') }}
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :title="String(t('settings.refresh'))"
                :aria-label="String(t('settings.refreshAria'))"
                @click="settings.refresh"
                :disabled="settings.loading"
              >
                <RiRefreshLine class="h-4 w-4" :class="settings.loading ? 'animate-spin' : ''" />
              </Button>
            </div>
            <div v-for="tab in tabs" :key="tab.id" class="space-y-1">
              <SidebarTextButton
                @click="goToTab(tab.id)"
                class="flex w-full items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60 hover:text-foreground active:scale-95"
                :class="
                  activeTab === tab.id
                    ? 'bg-primary/12 dark:bg-accent/80 text-foreground border-border/60'
                    : 'text-muted-foreground'
                "
              >
                <span class="inline-flex items-center gap-2">
                  <RiArrowDownSLine
                    v-if="tab.id === 'opencode' || tab.id === 'plugins'"
                    class="h-3.5 w-3.5 transition-transform"
                    :class="
                      (tab.id === 'opencode' && opencodeExpanded && activeTab === 'opencode') ||
                      (tab.id === 'plugins' && pluginsExpanded && activeTab === 'plugins')
                        ? 'rotate-180'
                        : ''
                    "
                  />
                  {{ tab.label }}
                </span>
              </SidebarTextButton>

              <div
                v-if="tab.id === 'opencode' && activeTab === 'opencode' && opencodeExpanded"
                class="border-l border-border/60 pl-3 pt-2 space-y-1"
              >
                <SidebarTextButton
                  v-for="section in opencodeSections"
                  :key="section.id"
                  @click="goToOpencodeSection(section.id)"
                  class="w-full rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60 hover:text-foreground active:scale-95"
                  :class="
                    activeOpencodeSection === section.id
                      ? 'bg-primary/12 dark:bg-accent/80 text-foreground border-border/60'
                      : 'text-muted-foreground'
                  "
                >
                  {{ t(section.labelKey) }}
                </SidebarTextButton>
              </div>

              <div
                v-if="tab.id === 'plugins' && activeTab === 'plugins' && pluginsExpanded"
                class="border-l border-border/60 pl-3 pt-2 space-y-1"
              >
                <SidebarTextButton
                  v-for="plugin in pluginsTabPlugins"
                  :key="`desktop-plugins-${plugin.id}`"
                  @click="goToPluginsSection(plugin.id)"
                  class="w-full rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60 hover:text-foreground active:scale-95"
                  :class="
                    activePluginsSection === plugin.id
                      ? 'bg-primary/12 dark:bg-accent/80 text-foreground border-border/60'
                      : 'text-muted-foreground'
                  "
                >
                  {{ plugin.label }}
                </SidebarTextButton>
              </div>
            </div>
          </div>
        </ScrollArea>
      </aside>

      <!-- Content -->
      <main class="flex-1 min-w-0 overflow-y-auto bg-background" v-show="!ui.isMobile || !ui.isSessionSwitcherOpen">
        <div :class="['mx-auto w-full p-4 lg:p-8 space-y-8', activeTab === 'opencode' ? 'max-w-6xl' : 'max-w-3xl']">
          <div
            v-if="dirtyHint"
            class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
          >
            {{ dirtyHint }}
          </div>

          <!-- OpenCode Tab -->
          <div v-if="activeTab === 'opencode'" class="space-y-6">
            <OpenCodeConfigPanel :active-section="activeOpencodeSection || undefined" />
          </div>

          <!-- Plugins Tab -->
          <div v-else-if="activeTab === 'plugins'" class="space-y-6">
            <div
              v-if="pluginsTabPlugins.length === 0"
              class="rounded-lg border border-border bg-muted/10 p-4 text-sm text-muted-foreground"
            >
              {{ t('settings.emptyPlugins') }}
            </div>

            <PluginSettingsPanel v-else :plugin-id="activePluginsSection" :hide-plugin-selector="true" />
          </div>

          <!-- Backends Tab -->
          <div v-else-if="activeTab === 'backends'" class="space-y-6">
            <BackendsPanel />

            <div class="rounded-lg border border-border bg-muted/10 p-4">
              <div class="text-sm font-medium">{{ t('settings.desktopRuntime.updates.title') }}</div>
              <div class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.desktopRuntime.updates.description') }}
              </div>

              <div class="mt-4 grid gap-3">
                <label class="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" v-model="updateAutoCheckEnabled" />
                  {{ t('settings.desktopRuntime.updates.fields.autoCheck') }}
                </label>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" v-model="updateAutoPromptEnabled" :disabled="!updateAutoCheckEnabled" />
                  {{ t('settings.desktopRuntime.updates.fields.autoPrompt') }}
                </label>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    v-model="updateAutoServiceInstallEnabled"
                    :disabled="!desktopRuntimeEnabled || !updateAutoCheckEnabled || updates.serviceUpdating"
                  />
                  {{ t('settings.desktopRuntime.updates.fields.autoServiceInstall') }}
                </label>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    v-model="updateAutoInstallerInstallEnabled"
                    :disabled="!desktopRuntimeEnabled || !updateAutoCheckEnabled || updates.installerUpdating"
                  />
                  {{ t('settings.desktopRuntime.updates.fields.autoInstallerInstall') }}
                </label>

                <div class="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    :disabled="updates.loading || updates.serviceUpdating || updates.installerUpdating"
                    @click="checkForUpdatesNow"
                  >
                    {{
                      updates.loading
                        ? t('settings.desktopRuntime.updates.actions.checking')
                        : t('settings.desktopRuntime.updates.actions.checkNow')
                    }}
                  </Button>
                  <Button variant="outline" :disabled="!updates.release?.url" @click="openReleasePageForUpdate">
                    {{ t('settings.desktopRuntime.updates.actions.openRelease') }}
                  </Button>
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!updates.release?.tag"
                    @click="ignoreCurrentUpdateVersion"
                  >
                    {{ t('settings.desktopRuntime.updates.actions.ignoreThisVersion') }}
                  </Button>
                  <Button variant="outline" size="sm" @click="snoozeUpdateReminder">
                    {{ t('settings.desktopRuntime.updates.actions.remindLater') }}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!updates.currentReleaseIgnored && !updates.reminderSnoozed"
                    @click="clearUpdateReminderSuppression"
                  >
                    {{ t('settings.desktopRuntime.updates.actions.clearSuppression') }}
                  </Button>
                </div>

                <div v-if="updates.currentReleaseIgnored" class="text-xs text-muted-foreground">
                  {{ t('settings.desktopRuntime.updates.suppression.ignored') }}
                </div>
                <div v-else-if="updates.reminderSnoozed" class="text-xs text-muted-foreground">
                  {{
                    t('settings.desktopRuntime.updates.suppression.snoozed', {
                      until: updateReminderSnoozeUntilLabel || '-',
                    })
                  }}
                </div>

                <div
                  v-if="updates.error"
                  class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {{ updates.error }}
                </div>

                <div class="grid gap-2 rounded-md border border-border/60 bg-background/60 p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-muted-foreground">
                      {{ t('settings.desktopRuntime.updates.sections.service') }}
                    </div>
                    <span
                      class="inline-flex items-center rounded-full border border-border/70 bg-primary/10 px-2 py-0.5 text-[11px] font-medium"
                    >
                      {{
                        updates.service.available
                          ? t('settings.desktopRuntime.updates.status.updateAvailable')
                          : t('settings.desktopRuntime.updates.status.upToDate')
                      }}
                    </span>
                  </div>
                  <div class="text-sm">
                    {{
                      t('settings.desktopRuntime.updates.versionLine', {
                        current: updates.service.currentVersion || '-',
                        latest: updates.service.latestVersion || '-',
                      })
                    }}
                  </div>
                  <div v-if="updates.service.target" class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.updates.targetLine', { target: updates.service.target }) }}
                  </div>
                  <div v-if="updates.service.assetName" class="text-[11px] font-mono text-muted-foreground break-all">
                    {{ updates.service.assetName }}
                  </div>
                  <div
                    v-if="updates.serviceProgress?.running || updates.serviceProgress?.error"
                    class="grid gap-1 rounded-md border border-border/60 bg-muted/20 p-2"
                  >
                    <div class="text-[11px] text-muted-foreground">
                      {{ updates.serviceProgress?.message || t('settings.desktopRuntime.updates.progress.preparing') }}
                    </div>
                    <div class="h-1.5 overflow-hidden rounded bg-border/70">
                      <div
                        class="h-full bg-primary transition-all"
                        :style="{ width: `${updates.serviceProgressPercent || 10}%` }"
                      />
                    </div>
                    <div class="text-[11px] text-muted-foreground">
                      {{
                        updates.serviceProgressPercent !== null
                          ? t('settings.desktopRuntime.updates.progress.percent', {
                              percent: updates.serviceProgressPercent,
                            })
                          : t('settings.desktopRuntime.updates.progress.indeterminate')
                      }}
                    </div>
                    <div v-if="updates.serviceProgress?.error" class="text-[11px] text-destructive">
                      {{ updates.serviceProgress.error }}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="
                        !desktopRuntimeEnabled ||
                        updates.serviceUpdating ||
                        !updates.service.available ||
                        !updates.service.assetUrl
                      "
                      @click="applyServiceUpdateNow"
                    >
                      {{
                        updates.serviceUpdating
                          ? t('settings.desktopRuntime.updates.actions.updatingService')
                          : t('settings.desktopRuntime.updates.actions.updateServiceNow')
                      }}
                    </Button>
                  </div>
                  <div class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.updates.serviceHint') }}
                  </div>
                </div>

                <div
                  v-if="updates.installer"
                  class="grid gap-2 rounded-md border border-border/60 bg-background/60 p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-muted-foreground">
                      {{ t('settings.desktopRuntime.updates.sections.installer') }}
                    </div>
                    <span
                      class="inline-flex items-center rounded-full border border-border/70 bg-primary/10 px-2 py-0.5 text-[11px] font-medium"
                    >
                      {{
                        updates.installer.available
                          ? t('settings.desktopRuntime.updates.status.updateAvailable')
                          : t('settings.desktopRuntime.updates.status.upToDate')
                      }}
                    </span>
                  </div>
                  <div class="text-sm">
                    {{
                      t('settings.desktopRuntime.updates.versionLine', {
                        current: updates.installer.currentVersion || '-',
                        latest: updates.installer.latestVersion || '-',
                      })
                    }}
                  </div>
                  <div v-if="updates.installer.target" class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.updates.targetLine', { target: updates.installer.target }) }}
                  </div>
                  <div class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.updates.channelLine', { channel: updates.installer.channel }) }}
                  </div>
                  <div
                    v-if="updates.installer.primaryAssetName"
                    class="text-[11px] font-mono text-muted-foreground break-all"
                  >
                    {{ updates.installer.primaryAssetName }}
                  </div>
                  <div
                    v-if="updates.installerProgress?.running || updates.installerProgress?.error"
                    class="grid gap-1 rounded-md border border-border/60 bg-muted/20 p-2"
                  >
                    <div class="text-[11px] text-muted-foreground">
                      {{
                        updates.installerProgress?.message || t('settings.desktopRuntime.updates.progress.preparing')
                      }}
                    </div>
                    <div class="h-1.5 overflow-hidden rounded bg-border/70">
                      <div
                        class="h-full bg-primary transition-all"
                        :style="{ width: `${updates.installerProgressPercent || 10}%` }"
                      />
                    </div>
                    <div class="text-[11px] text-muted-foreground">
                      {{
                        updates.installerProgressPercent !== null
                          ? t('settings.desktopRuntime.updates.progress.percent', {
                              percent: updates.installerProgressPercent,
                            })
                          : t('settings.desktopRuntime.updates.progress.indeterminate')
                      }}
                    </div>
                    <div v-if="updates.installerProgress?.error" class="text-[11px] text-destructive">
                      {{ updates.installerProgress.error }}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="
                        !desktopRuntimeEnabled ||
                        updates.installerUpdating ||
                        !updates.installer.available ||
                        !updates.installer.primaryAssetUrl
                      "
                      @click="applyInstallerUpdateNow"
                    >
                      {{
                        updates.installerUpdating
                          ? t('settings.desktopRuntime.updates.actions.preparingInstaller')
                          : t('settings.desktopRuntime.updates.actions.installDesktopNow')
                      }}
                    </Button>
                  </div>
                  <div class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.updates.installerHint') }}
                  </div>
                </div>
              </div>
            </div>

            <div v-if="desktopRuntimeEnabled" class="rounded-lg border border-border bg-muted/10 p-4">
              <div class="text-sm font-medium">{{ t('settings.desktopRuntime.title') }}</div>
              <div class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.desktopRuntime.description') }}
              </div>

              <div class="mt-4 grid gap-3">
                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{ t('settings.desktopRuntime.fields.host') }}</label>
                  <Input
                    v-model="desktopBackendHost"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.host'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="h-10"
                    autocomplete="off"
                  />
                </div>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{ t('settings.desktopRuntime.fields.port') }}</label>
                  <Input
                    v-model="desktopBackendPortInput"
                    type="number"
                    min="1"
                    max="65535"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.port'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="h-10"
                    inputmode="numeric"
                  />
                </div>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.corsOrigins')
                  }}</label>
                  <textarea
                    v-model="desktopCorsOriginsText"
                    rows="4"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.corsOrigins'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <div class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.corsHint') }}
                  </div>
                </div>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    v-model="desktopCorsAllowAll"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                  />
                  {{ t('settings.desktopRuntime.fields.corsAllowAll') }}
                </label>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.backendLogLevel')
                  }}</label>
                  <div class="w-56 max-w-full">
                    <OptionPicker
                      v-model="desktopBackendLogLevel"
                      :options="desktopRuntimeLogLevelOptions"
                      :title="String(t('settings.desktopRuntime.fields.backendLogLevel'))"
                      :search-placeholder="String(t('settings.desktopRuntime.search.searchLogLevels'))"
                      :include-empty="false"
                      :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    />
                  </div>
                </div>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.uiPassword')
                  }}</label>
                  <Input
                    v-model="desktopUiPassword"
                    type="password"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.uiPassword'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="h-10"
                    autocomplete="new-password"
                  />
                </div>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.opencodeHost')
                  }}</label>
                  <Input
                    v-model="desktopOpencodeHost"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.opencodeHost'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="h-10"
                    autocomplete="off"
                  />
                </div>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.opencodePort')
                  }}</label>
                  <Input
                    v-model="desktopOpencodePortInput"
                    type="number"
                    min="1"
                    max="65535"
                    :placeholder="String(t('settings.desktopRuntime.placeholders.opencodePort'))"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    class="h-10"
                    inputmode="numeric"
                  />
                  <div class="text-[11px] text-muted-foreground">
                    {{ t('settings.desktopRuntime.opencodePortHint') }}
                  </div>
                </div>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    v-model="desktopSkipOpencodeStart"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                  />
                  {{ t('settings.desktopRuntime.fields.skipOpencodeStart') }}
                </label>

                <div class="grid gap-1">
                  <label class="text-xs text-muted-foreground">{{
                    t('settings.desktopRuntime.fields.opencodeLogLevel')
                  }}</label>
                  <div class="w-56 max-w-full">
                    <OptionPicker
                      v-model="desktopOpencodeLogLevel"
                      :options="desktopRuntimeLogLevelOptions"
                      :title="String(t('settings.desktopRuntime.fields.opencodeLogLevel'))"
                      :search-placeholder="String(t('settings.desktopRuntime.search.searchLogLevels'))"
                      :include-empty="false"
                      :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    />
                  </div>
                </div>

                <label class="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    v-model="desktopAutostartOnBoot"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                  />
                  {{ t('settings.desktopRuntime.fields.autostartOnBoot') }}
                </label>

                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    :disabled="desktopRuntimeLoading || desktopRuntimeSaving"
                    @click="loadDesktopRuntimeConfig"
                  >
                    {{ t('common.refresh') }}
                  </Button>
                  <Button :disabled="desktopRuntimeLoading || desktopRuntimeSaving" @click="saveDesktopRuntimeConfig">
                    {{ desktopRuntimeSaving ? t('common.saving') : t('settings.desktopRuntime.saveAndRestart') }}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- Appearance Tab -->
          <div v-else-if="activeTab === 'appearance'" class="space-y-6">
            <div class="text-lg font-medium">{{ t('settings.appearance.intro') }}</div>

            <div class="grid gap-6">
              <div class="grid gap-2">
                <label class="text-sm font-medium leading-none">{{ t('settings.appearance.language.label') }}</label>
                <div class="text-xs text-muted-foreground">{{ t('settings.appearance.language.help') }}</div>
                <div class="w-56 max-w-full">
                  <OptionPicker
                    v-model="uiLocale"
                    :options="localePickerOptions"
                    :title="String(t('settings.appearance.language.label'))"
                    :search-placeholder="String(t('settings.appearance.language.label'))"
                    :include-empty="false"
                  />
                </div>
              </div>

              <div class="grid gap-2">
                <label class="text-sm font-medium leading-none">{{ t('settings.appearance.theme.label') }}</label>
                <div class="flex items-center gap-3 flex-wrap">
                  <label class="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="useSystemTheme" />
                    {{ t('settings.appearance.theme.useSystem') }}
                  </label>
                  <div class="w-28 min-w-[7rem]">
                    <OptionPicker
                      v-model="themeVariant"
                      :options="themeVariantPickerOptions"
                      :title="String(t('settings.appearance.theme.pickerTitle'))"
                      :search-placeholder="String(t('settings.appearance.theme.pickerSearch'))"
                      :include-empty="false"
                      :disabled="useSystemTheme"
                    />
                  </div>
                </div>
              </div>

              <div class="grid gap-2">
                <label class="text-sm font-medium leading-none">{{ t('settings.appearance.fonts.label') }}</label>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div class="grid gap-1">
                    <div class="text-xs text-muted-foreground">{{ t('settings.appearance.fonts.ui') }}</div>
                    <OptionPicker
                      v-model="uiFont"
                      :options="uiFontPickerOptions"
                      :title="String(t('settings.appearance.fonts.ui'))"
                      :search-placeholder="String(t('settings.appearance.fonts.search'))"
                      :include-empty="false"
                    />
                  </div>
                  <div class="grid gap-1">
                    <div class="text-xs text-muted-foreground">{{ t('settings.appearance.fonts.mono') }}</div>
                    <OptionPicker
                      v-model="monoFont"
                      :options="monoFontPickerOptions"
                      :title="String(t('settings.appearance.fonts.mono'))"
                      :search-placeholder="String(t('settings.appearance.fonts.search'))"
                      :include-empty="false"
                    />
                  </div>
                </div>
              </div>

              <div class="grid gap-2">
                <label class="text-sm font-medium leading-none">{{ t('settings.appearance.sizing.label') }}</label>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <label class="grid gap-1">
                    <span class="text-xs text-muted-foreground">{{ t('settings.appearance.sizing.fontSize') }}</span>
                    <input
                      type="number"
                      min="70"
                      max="140"
                      v-model.number="fontSize"
                      class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="text-xs text-muted-foreground">{{ t('settings.appearance.sizing.padding') }}</span>
                    <input
                      type="number"
                      min="70"
                      max="140"
                      v-model.number="padding"
                      class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('settings.appearance.sizing.cornerRadius')
                    }}</span>
                    <input
                      type="number"
                      min="0"
                      max="28"
                      v-model.number="cornerRadius"
                      class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('settings.appearance.sizing.inputBarOffset')
                    }}</span>
                    <input
                      type="number"
                      min="-40"
                      max="80"
                      v-model.number="inputBarOffset"
                      class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div class="grid gap-2">
                <label class="text-sm font-medium leading-none">{{ t('settings.appearance.chat.label') }}</label>
                <div class="grid gap-3">
                  <label class="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="showChatTimestamps" />
                    {{ t('settings.appearance.chat.showTimestamps') }}
                  </label>
                  <label class="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="chatActivityAutoCollapseOnIdle" />
                    {{ t('settings.appearance.chat.autoCollapseActivity') }}
                  </label>
                  <div class="mt-1">
                    <div class="text-xs font-medium text-muted-foreground">
                      {{ t('settings.appearance.chat.activityDetails') }}
                    </div>
                    <div class="mt-2 overflow-x-auto rounded-md border border-border/60">
                      <table class="min-w-full text-sm">
                        <thead class="bg-muted/30 text-xs text-muted-foreground">
                          <tr>
                            <th class="px-3 py-2 text-left font-medium">
                              {{ t('settings.appearance.chat.activityTable.type') }}
                            </th>
                            <th class="px-3 py-2 text-center font-medium">
                              {{ t('settings.appearance.chat.activityTable.transport') }}
                            </th>
                            <th class="px-3 py-2 text-center font-medium">
                              {{ t('settings.appearance.chat.activityTable.expand') }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="opt in activityDefaultExpandedOptions"
                            :key="`activity-matrix-${opt.id}`"
                            class="border-t border-border/50"
                          >
                            <td class="px-3 py-2 align-top">
                              <div>{{ opt.label }}</div>
                              <div class="text-[11px] text-muted-foreground">{{ opt.description }}</div>
                            </td>
                            <td class="px-3 py-2 text-center align-middle">
                              <input
                                type="checkbox"
                                :checked="activityTransportEnabled(opt.id)"
                                @change="toggleActivityTransport(opt.id)"
                              />
                            </td>
                            <td class="px-3 py-2 text-center align-middle">
                              <input
                                type="checkbox"
                                :checked="activityDefaultExpandedEnabled(opt.id)"
                                :disabled="!activityTransportEnabled(opt.id)"
                                @change="toggleActivityDefaultExpanded(opt.id)"
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div class="mt-1">
                    <div class="text-xs font-medium text-muted-foreground">
                      {{ t('settings.appearance.chat.toolDetails') }}
                    </div>
                    <div class="mt-2 overflow-x-auto rounded-md border border-border/60">
                      <table class="min-w-full text-sm">
                        <thead class="bg-muted/30 text-xs text-muted-foreground">
                          <tr>
                            <th class="px-3 py-2 text-left font-medium">
                              {{ t('settings.appearance.chat.toolDetailsTable.tool') }}
                            </th>
                            <th class="px-3 py-2 text-center font-medium">
                              {{ t('settings.appearance.chat.toolDetailsTable.transport') }}
                            </th>
                            <th class="px-3 py-2 text-center font-medium">
                              {{ t('settings.appearance.chat.toolDetailsTable.expand') }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="opt in toolActivityOptions"
                            :key="`tool-matrix-${opt.id}`"
                            class="border-t border-border/50"
                          >
                            <td class="px-3 py-2 align-top">
                              <div>{{ opt.label }}</div>
                              <div class="text-[11px] text-muted-foreground">{{ opt.description }}</div>
                            </td>
                            <td class="px-3 py-2 text-center align-middle">
                              <input
                                type="checkbox"
                                :checked="toolActivityEnabled(opt.id)"
                                @change="toggleToolDetailTransport(opt.id)"
                              />
                            </td>
                            <td class="px-3 py-2 text-center align-middle">
                              <input
                                type="checkbox"
                                :checked="activityDefaultExpandedToolEnabled(opt.id)"
                                :disabled="!toolActivityEnabled(opt.id)"
                                @change="toggleActivityDefaultExpandedTool(opt.id)"
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div class="mt-2 text-[11px] text-muted-foreground">
                      {{ t('settings.appearance.chat.toolDetailsHint') }}
                    </div>
                  </div>

                  <div class="text-xs text-muted-foreground">
                    {{ t('settings.appearance.chat.activityTransportHelp') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Debug Tab -->
          <div v-else-if="activeTab === 'debug'" class="space-y-6">
            <DebugPanel />
          </div>

          <div v-else class="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p>{{ t('settings.unknownTab') }}</p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-page :deep(input[type='checkbox']),
.settings-page :deep(input[type='radio']) {
  accent-color: oklch(var(--muted-foreground));
}
</style>
