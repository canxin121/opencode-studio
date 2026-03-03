<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { useToastsStore, type ToastKind } from '@/stores/toasts'
import { apiJson } from '@/lib/api'
import { useDirectoryStore } from '@/stores/directory'

type ToastPreset = 'info' | 'success' | 'error' | 'action' | 'persistent' | 'burst'
type DiagnosticPathEntry = {
  path: string
  exists: boolean
}

type DiagnosticsPayload = {
  timestamp?: string
  opencode?: {
    status?: {
      port?: number | null
      ready?: boolean
      restarting?: boolean
      lastError?: string | null
      baseUrl?: string | null
    }
    version?: {
      cli?: string | null
    }
  }
  paths?: {
    input?: {
      directory?: string | null
      normalizedDirectory?: string | null
    }
    studio?: {
      settingsPath?: DiagnosticPathEntry
      sidebarPreferencesPath?: DiagnosticPathEntry
      terminalRegistryPath?: DiagnosticPathEntry
    }
    opencodeStorage?: {
      dbPath?: DiagnosticPathEntry
      sessionsDir?: DiagnosticPathEntry
      messagesDir?: DiagnosticPathEntry
      messagePartsDir?: DiagnosticPathEntry
    }
    opencodeConfig?: {
      userPath?: DiagnosticPathEntry
      projectPath?: DiagnosticPathEntry | null
      customPath?: DiagnosticPathEntry | null
    }
  }
}

const toasts = useToastsStore()
const directoryStore = useDirectoryStore()
const { t } = useI18n()

const messageDraft = ref('')
const timeoutDraft = ref('2500')
const actionLabelDraft = ref('')
const appendUnique = ref(true)
const diagnosticsLoading = ref(false)
const diagnosticsError = ref('')
const diagnostics = ref<DiagnosticsPayload | null>(null)
const diagnosticsDirectory = ref('')

const timeoutMs = computed(() => {
  const parsed = Number.parseInt(String(timeoutDraft.value || '').trim(), 10)
  if (!Number.isFinite(parsed)) return 2500
  return Math.max(0, Math.min(60_000, parsed))
})

const toastHostReady = computed(() => toasts.isHostReady)
const diagnosticsPretty = computed(() => {
  if (!diagnostics.value) return ''
  return JSON.stringify(diagnostics.value, null, 2)
})

function resolveMessage(preset: ToastPreset): string {
  const trimmed = String(messageDraft.value || '').trim()
  const fallback = String(t(`settings.debug.toast.defaults.${preset}`))
  const base = trimmed || fallback
  if (!appendUnique.value) return base
  return `${base} #${Date.now().toString(36).slice(-5)}`
}

function push(kind: ToastKind) {
  toasts.push(kind, resolveMessage(kind), timeoutMs.value)
}

function pushWithAction() {
  const label =
    String(actionLabelDraft.value || '').trim() || String(t('settings.debug.toast.placeholders.actionLabel'))
  toasts.push('info', resolveMessage('action'), timeoutMs.value, {
    label,
    onClick: () => {
      toasts.push('success', String(t('settings.debug.toast.defaults.actionFollowup')))
    },
  })
}

function pushPersistent() {
  toasts.push('info', resolveMessage('persistent'), 0)
}

function pushBurst() {
  const msg = resolveMessage('burst')
  for (let i = 0; i < 3; i++) {
    toasts.push('info', msg, timeoutMs.value)
  }
}

function diagnosticsUrl(): string {
  const directory = String(diagnosticsDirectory.value || '').trim()
  if (!directory) return '/api/opencode-studio/diagnostics'
  const params = new URLSearchParams()
  params.set('directory', directory)
  return `/api/opencode-studio/diagnostics?${params.toString()}`
}

async function refreshDiagnostics() {
  diagnosticsLoading.value = true
  diagnosticsError.value = ''
  try {
    diagnostics.value = await apiJson<DiagnosticsPayload>(diagnosticsUrl())
  } catch (err) {
    diagnosticsError.value = err instanceof Error ? err.message : String(err)
  } finally {
    diagnosticsLoading.value = false
  }
}

onMounted(() => {
  diagnosticsDirectory.value = String(directoryStore.currentDirectory || '')
  void refreshDiagnostics()
})
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg border border-border bg-muted/10 p-4">
      <div class="text-sm font-medium">{{ t('settings.debug.title') }}</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ t('settings.debug.intro') }}</div>
    </div>

    <section class="rounded-lg border border-border bg-background/60 p-4 space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <h2 class="text-sm font-semibold">{{ t('settings.debug.diagnostics.title') }}</h2>
          <p class="text-xs text-muted-foreground">{{ t('settings.debug.diagnostics.description') }}</p>
        </div>
        <Button size="sm" variant="outline" :disabled="diagnosticsLoading" @click="refreshDiagnostics">
          {{ diagnosticsLoading ? t('settings.debug.diagnostics.actions.loading') : t('settings.debug.diagnostics.actions.refresh') }}
        </Button>
      </div>

      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.debug.diagnostics.fields.directory') }}</span>
        <Input v-model="diagnosticsDirectory" :placeholder="String(t('settings.debug.diagnostics.placeholders.directory'))" />
      </label>

      <div v-if="diagnosticsError" class="text-xs text-destructive">{{ diagnosticsError }}</div>

      <div v-if="diagnostics" class="grid gap-2 text-xs">
        <div>
          <span class="text-muted-foreground">{{ t('settings.debug.diagnostics.fields.opencodeCliVersion') }}: </span>
          <span class="font-medium">{{ diagnostics.opencode?.version?.cli || '-' }}</span>
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('settings.debug.diagnostics.fields.opencodeBaseUrl') }}: </span>
          <span class="font-medium">{{ diagnostics.opencode?.status?.baseUrl || '-' }}</span>
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('settings.debug.diagnostics.fields.studioSettingsPath') }}: </span>
          <span class="font-medium">{{ diagnostics.paths?.studio?.settingsPath?.path || '-' }}</span>
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('settings.debug.diagnostics.fields.opencodeDbPath') }}: </span>
          <span class="font-medium">{{ diagnostics.paths?.opencodeStorage?.dbPath?.path || '-' }}</span>
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('settings.debug.diagnostics.fields.opencodeSessionsPath') }}: </span>
          <span class="font-medium">{{ diagnostics.paths?.opencodeStorage?.sessionsDir?.path || '-' }}</span>
        </div>
      </div>

      <details v-if="diagnosticsPretty" class="rounded border border-border/70 bg-muted/20 p-3">
        <summary class="cursor-pointer text-xs font-medium">{{ t('settings.debug.diagnostics.fullPayload') }}</summary>
        <pre class="mt-2 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap break-all">{{ diagnosticsPretty }}</pre>
      </details>
    </section>

    <section class="rounded-lg border border-border bg-background/60 p-4 space-y-4">
      <div class="space-y-1">
        <h2 class="text-sm font-semibold">{{ t('settings.debug.toast.title') }}</h2>
        <p class="text-xs text-muted-foreground">{{ t('settings.debug.toast.description') }}</p>
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <label class="grid gap-1 lg:col-span-2">
          <span class="text-xs text-muted-foreground">{{ t('settings.debug.toast.fields.message') }}</span>
          <Input v-model="messageDraft" :placeholder="String(t('settings.debug.toast.placeholders.message'))" />
        </label>

        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.debug.toast.fields.timeoutMs') }}</span>
          <Input v-model="timeoutDraft" type="number" min="0" max="60000" inputmode="numeric" />
        </label>
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <label class="grid gap-1 lg:col-span-2">
          <span class="text-xs text-muted-foreground">{{ t('settings.debug.toast.fields.actionLabel') }}</span>
          <Input v-model="actionLabelDraft" :placeholder="String(t('settings.debug.toast.placeholders.actionLabel'))" />
        </label>

        <label class="inline-flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" v-model="appendUnique" />
          {{ t('settings.debug.toast.options.uniqueMessage') }}
        </label>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="push('info')">{{ t('settings.debug.toast.actions.info') }}</Button>
        <Button variant="outline" size="sm" @click="push('success')">{{
          t('settings.debug.toast.actions.success')
        }}</Button>
        <Button variant="outline" size="sm" @click="push('error')">{{
          t('settings.debug.toast.actions.error')
        }}</Button>
        <Button variant="outline" size="sm" @click="pushWithAction">{{
          t('settings.debug.toast.actions.withAction')
        }}</Button>
        <Button variant="outline" size="sm" @click="pushPersistent">{{
          t('settings.debug.toast.actions.persistent')
        }}</Button>
        <Button variant="outline" size="sm" @click="pushBurst">{{ t('settings.debug.toast.actions.burst') }}</Button>
      </div>

      <div class="space-y-1 text-[11px] text-muted-foreground">
        <div>{{ t('settings.debug.toast.hints.dedupe') }}</div>
        <div>{{ t('settings.debug.toast.hints.action') }}</div>
        <div>
          Toast host status:
          <span class="font-medium" :class="toastHostReady ? 'text-primary' : 'text-destructive'">
            {{ toastHostReady ? 'ready' : 'waiting to mount' }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
