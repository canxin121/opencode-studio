<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '../stores/auth'
import { useBackendsStore } from '@/stores/backends'
import { useHealthStore } from '@/stores/health'
import type { OpenCodeErrorInfo } from '@/stores/health'
import { useToastsStore } from '@/stores/toasts'
import { clearUiAuthTokenForBaseUrl } from '@/lib/uiAuthToken'
import { isDesktopRuntime } from '@/lib/desktopConfig'
import { i18n, setAppLocale } from '@/i18n'
import type { AppLocale } from '@/i18n/locale'
import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import { buildLoginLocalePickerOptions } from '@/pages/loginLocaleOptions'

const NEW_BACKEND_ID = '__new__'

const auth = useAuthStore()
const health = useHealthStore()
const backends = useBackendsStore()
const toasts = useToastsStore()
const { t } = useI18n()
const desktopRuntime = isDesktopRuntime()

const password = ref('')
const busy = ref(false)
const formError = ref<string | null>(null)

const selectedBackendId = ref('')
const newBackendLabel = ref('')
const newBackendUrl = ref('')

const editOpen = ref(false)
const editBusy = ref(false)
const editError = ref<string | null>(null)
const editLabel = ref('')
const editBaseUrl = ref('')
const editBackendId = ref<string | null>(null)
const editOriginalBaseUrl = ref('')

const backendOptions = computed(() => {
  const opts = backends.backends.map((b) => ({
    value: b.id,
    label: b.label,
    description: b.baseUrl,
  }))

  return [
    {
      value: NEW_BACKEND_ID,
      label: String(t('login.newBackend')),
      description: String(t('login.newBackendHelp')),
    },
    ...opts,
  ]
})

const isNewBackend = computed(() => selectedBackendId.value === NEW_BACKEND_ID)

const selectedBackend = computed(() => {
  const id = String(selectedBackendId.value || '').trim()
  if (!id || id === NEW_BACKEND_ID) return null
  return backends.backends.find((b) => b.id === id) || null
})

const effectiveBackendBaseUrl = computed(() => {
  if (isNewBackend.value) return String(newBackendUrl.value || '').trim()
  return selectedBackend.value?.baseUrl || backends.activeBackend?.baseUrl || ''
})

const canManageSelectedBackend = computed(() => {
  return Boolean(selectedBackend.value && !isNewBackend.value)
})

const uiLocale = computed<AppLocale>({
  get() {
    return i18n.global.locale.value as AppLocale
  },
  set(value) {
    setAppLocale(value)
  },
})

const localePickerOptions = computed(() => buildLoginLocalePickerOptions((key) => String(t(key))))

function openEditSelectedBackend() {
  const b = selectedBackend.value
  if (!b) return
  if (editOpen.value && editBackendId.value === b.id) {
    editOpen.value = false
    editError.value = null
    return
  }
  editBackendId.value = b.id
  editLabel.value = b.label
  editBaseUrl.value = b.baseUrl
  editOriginalBaseUrl.value = b.baseUrl
  editError.value = null
  editOpen.value = true
}

function cancelEditSelectedBackend() {
  editOpen.value = false
  editError.value = null
}

async function submitEditSelectedBackend() {
  const id = String(editBackendId.value || '').trim()
  if (!id) return
  if (editBusy.value) return
  editBusy.value = true
  editError.value = null
  try {
    const previousBaseUrl = String(editOriginalBaseUrl.value || '').trim()
    const nextBaseUrl = String(editBaseUrl.value || '').trim()
    const res = backends.updateBackend({ id, label: editLabel.value, baseUrl: nextBaseUrl })
    if (!res.ok) {
      editError.value = res.error || String(t('login.failedToUpdateBackend'))
      return
    }

    if (previousBaseUrl && nextBaseUrl && previousBaseUrl !== nextBaseUrl) {
      clearUiAuthTokenForBaseUrl(previousBaseUrl)
      // Don’t carry tokens across baseUrl changes.
      clearUiAuthTokenForBaseUrl(nextBaseUrl)
    }

    editOpen.value = false
  } finally {
    editBusy.value = false
  }
}

function removeSelectedBackend() {
  const b = selectedBackend.value
  if (!b) return
  const res = backends.removeBackend(b.id)
  if (!res.ok) {
    formError.value = res.error || String(t('login.failedToRemoveBackend'))
    return
  }
  clearUiAuthTokenForBaseUrl(b.baseUrl)
  // selection watcher will snap to active backend if needed.
}

watch(
  () => selectedBackendId.value,
  () => {
    // Avoid editing the wrong target when switching selections.
    editOpen.value = false
    editBusy.value = false
    editError.value = null
    editBackendId.value = null
    editOriginalBaseUrl.value = ''
  },
)

watch(
  () => backends.activeBackend?.id,
  (id) => {
    const current = String(selectedBackendId.value || '').trim()
    const active = String(id || '').trim()
    if (!current && active) {
      selectedBackendId.value = active
    }
    // If the selected id no longer exists, fall back to active.
    const exists = backendOptions.value.some((o) => o.value === current)
    if (current && !exists && active) {
      selectedBackendId.value = active
    }
  },
  { immediate: true },
)

const canSubmit = computed(() => {
  if (busy.value) return false
  const id = String(selectedBackendId.value || '').trim()
  if (!id) return false
  if (id === NEW_BACKEND_ID) return false
  return true
})

const canSaveNewBackend = computed(() => {
  if (busy.value) return false
  return Boolean(newBackendLabel.value.trim() && newBackendUrl.value.trim())
})

const showBackendLoadingNotice = computed(() => {
  return desktopRuntime && (health.data === null || !health.data.isOpenCodeReady)
})

const shouldShowOpenCodeIssue = computed(() => {
  if (health.data === null) return desktopRuntime
  return !health.data.isOpenCodeReady
})

let backendProbeTimer: ReturnType<typeof setInterval> | null = null
const backendProbeBusy = ref(false)
let backendLoadingToastShown = false

const visibleAuthError = computed(() => {
  if (shouldShowOpenCodeIssue.value) return null
  return auth.lastError
})

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function buildOpenCodeIssue(info: OpenCodeErrorInfo | null | undefined, fallbackDetail: string) {
  const summary = normalizeText(info?.summary) || fallbackDetail

  let detail = normalizeText(info?.detail)
  if (!detail) {
    detail = normalizeText(info?.stderrExcerpt)
  }
  if (!detail && fallbackDetail && fallbackDetail !== summary) {
    detail = fallbackDetail
  }

  const hint = normalizeText(info?.hint)
  const code = normalizeText(info?.code)

  return {
    title: String(t('login.opencodeNotReady')),
    summary: summary || String(t('login.opencodeNotReady')),
    detail,
    hint,
    code,
  }
}

const visibleOpenCodeIssue = computed(() => {
  if (!shouldShowOpenCodeIssue.value) return null
  const legacyDetail = normalizeText(health.data?.lastOpenCodeError)
  const info = health.data?.lastOpenCodeErrorInfo
  return buildOpenCodeIssue(info, legacyDetail)
})

const visiblePageError = computed(() => {
  return formError.value || visibleAuthError.value
})

async function refreshBackendStatusOnce() {
  if (backendProbeBusy.value) return
  backendProbeBusy.value = true
  try {
    await health.refresh().catch(() => {})
    if (health.data !== null) {
      await auth.refresh().catch(() => {})
    }
  } finally {
    backendProbeBusy.value = false
  }
}

function scheduleBackendProbe() {
  if (!showBackendLoadingNotice.value) return
  if (backendProbeTimer) return
  backendProbeTimer = setInterval(() => {
    void refreshBackendStatusOnce()
  }, 2000)
}

function clearBackendProbeTimer() {
  if (!backendProbeTimer) return
  clearInterval(backendProbeTimer)
  backendProbeTimer = null
}

watch(
  () => showBackendLoadingNotice.value,
  (show) => {
    if (show) {
      if (!backendLoadingToastShown) {
        toasts.push('info', String(t('login.backendLoadingToast')), 2600)
        backendLoadingToastShown = true
      }
      scheduleBackendProbe()
      return
    }
    backendLoadingToastShown = false
    clearBackendProbeTimer()
  },
  { immediate: true },
)

onMounted(() => {
  if (!showBackendLoadingNotice.value) return
  void refreshBackendStatusOnce()
})

onBeforeUnmount(() => {
  clearBackendProbeTimer()
})

function cancelNewBackend() {
  newBackendLabel.value = ''
  newBackendUrl.value = ''
  selectedBackendId.value = backends.activeBackend?.id || backends.backends[0]?.id || ''
  formError.value = null
}

function saveNewBackend() {
  if (!canSaveNewBackend.value) return
  const res = backends.addBackend({
    label: newBackendLabel.value,
    baseUrl: newBackendUrl.value,
    setActive: true,
  })
  if (!res.ok) {
    formError.value = res.error || String(t('login.failedToAddBackend'))
    return
  }

  selectedBackendId.value = res.backend.id
  newBackendLabel.value = ''
  newBackendUrl.value = ''
  formError.value = null
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  formError.value = null
  try {
    const activeBefore = backends.activeBackend?.id || null
    const selectedId = String(selectedBackendId.value || '').trim()
    let backendChanged = false

    if (selectedId === NEW_BACKEND_ID) {
      formError.value = String(t('login.saveNewBackendFirst'))
      return
    } else if (selectedId && selectedId !== activeBefore) {
      backends.setActiveBackend(selectedId)
      backendChanged = true
    }

    // Check whether the selected backend requires UI auth.
    await Promise.all([auth.refresh().catch(() => {}), health.refresh().catch(() => {})])

    if (health.data === null) {
      formError.value = health.error || String(t('login.backendNotReachable'))
      return
    }

    if (auth.needsLogin) {
      if (password.value.trim().length === 0) {
        formError.value = String(t('login.passwordRequired'))
        return
      }
      await auth.login(password.value)
      if (auth.needsLogin) {
        // auth.login already refreshed state + lastError.
        return
      }
    }

    if (!health.data?.isOpenCodeReady) {
      if (!desktopRuntime) {
        const detail =
          normalizeText(health.data?.lastOpenCodeErrorInfo?.summary) || normalizeText(health.data?.lastOpenCodeError)
        formError.value = detail
          ? `${String(t('login.opencodeNotReady'))}: ${detail}`
          : String(t('login.opencodeNotReady'))
      }
      return
    }

    password.value = ''
    if (backendChanged) {
      try {
        window.location.reload()
      } catch {
        // ignore
      }
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-background px-4 py-6">
    <div class="mx-auto my-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-[360px] flex-col justify-center space-y-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <div
          class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-foreground/5"
        >
          <img src="/favicon.svg" alt="OpenCode Studio" class="h-10 w-10 opacity-90" />
        </div>
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold tracking-tight text-foreground">{{ t('login.title') }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ t('login.subtitle') }}
          </p>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="grid gap-2">
          <label class="text-xs font-medium text-muted-foreground">{{ t('settings.appearance.language.label') }}</label>
          <div class="w-40 max-w-full">
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
          <label class="text-xs font-medium text-muted-foreground">{{ t('login.backendLabel') }}</label>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                v-model="selectedBackendId"
                :options="backendOptions"
                :title="String(t('login.selectBackendTitle'))"
                :search-placeholder="String(t('login.searchBackends'))"
                :include-empty="false"
              />
            </div>

            <Button
              v-if="canManageSelectedBackend"
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="busy"
              @click="openEditSelectedBackend"
            >
              {{ t('common.edit') }}
            </Button>

            <ConfirmPopover
              v-if="canManageSelectedBackend"
              :title="String(t('login.removeBackendTitle'))"
              :description="selectedBackend?.baseUrl"
              :confirmText="String(t('common.remove'))"
              :cancelText="String(t('common.cancel'))"
              variant="destructive"
              :confirmDisabled="busy || backends.backends.length <= 1"
              @confirm="removeSelectedBackend"
            >
              <Button
                variant="outline"
                size="sm"
                class="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                :disabled="busy || backends.backends.length <= 1"
              >
                {{ t('common.remove') }}
              </Button>
            </ConfirmPopover>
          </div>
          <div v-if="effectiveBackendBaseUrl" class="text-[11px] text-muted-foreground break-all font-mono">
            {{ effectiveBackendBaseUrl }}
          </div>
        </div>

        <div v-if="isNewBackend" class="grid gap-3 rounded-lg border border-border bg-muted/10 p-3">
          <div class="grid gap-2">
            <label class="text-xs font-medium text-muted-foreground">{{ t('login.label') }}</label>
            <Input
              v-model="newBackendLabel"
              :placeholder="String(t('login.newBackendLabelPlaceholder'))"
              :disabled="busy"
              class="h-10"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-xs font-medium text-muted-foreground">{{ t('login.baseUrl') }}</label>
            <Input
              v-model="newBackendUrl"
              placeholder="http://127.0.0.1:3210"
              :disabled="busy"
              class="h-10"
              autocomplete="url"
              inputmode="url"
            />
          </div>
          <div class="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" :disabled="busy" @click="cancelNewBackend">
              {{ t('common.cancel') }}
            </Button>
            <Button size="sm" :disabled="!canSaveNewBackend" @click="saveNewBackend">
              {{ t('common.save') }}
            </Button>
          </div>
        </div>

        <div
          v-else-if="editOpen && canManageSelectedBackend"
          class="grid gap-3 rounded-lg border border-border bg-muted/10 p-3"
        >
          <div
            v-if="editError"
            class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {{ editError }}
          </div>

          <div class="grid gap-2">
            <label class="text-xs font-medium text-muted-foreground">{{ t('login.label') }}</label>
            <Input
              v-model="editLabel"
              :placeholder="String(t('login.label'))"
              :disabled="busy || editBusy"
              class="h-10"
            />
          </div>
          <div class="grid gap-2">
            <label class="text-xs font-medium text-muted-foreground">{{ t('login.baseUrl') }}</label>
            <Input
              v-model="editBaseUrl"
              placeholder="https://studio.cxits.cn"
              :disabled="busy || editBusy"
              class="h-10"
              autocomplete="url"
              inputmode="url"
            />
          </div>

          <div class="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" :disabled="busy || editBusy" @click="cancelEditSelectedBackend">
              {{ t('common.cancel') }}
            </Button>
            <Button size="sm" :disabled="busy || editBusy" @click="submitEditSelectedBackend">
              {{ editBusy ? t('common.saving') : t('common.save') }}
            </Button>
          </div>
        </div>

        <div class="grid gap-2">
          <Input
            id="password"
            v-model="password"
            type="password"
            :placeholder="String(t('login.passwordPlaceholder'))"
            autocomplete="current-password"
            @keydown.enter="submit"
            :disabled="busy"
            autofocus
            class="h-11 bg-muted/30 text-center text-lg placeholder:text-muted-foreground/50"
          />
        </div>
        <Button
          :disabled="!canSubmit"
          @click="submit"
          class="h-11 w-full text-base font-medium shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30"
          size="lg"
        >
          {{ busy ? t('common.connecting') : auth.needsLogin ? t('common.unlock') : t('common.continue') }}
        </Button>
      </div>

      <div v-if="visibleOpenCodeIssue || visiblePageError" class="animate-in fade-in slide-in-from-top-2">
        <div
          class="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive ring-1 ring-inset ring-destructive/20"
        >
          <template v-if="visibleOpenCodeIssue">
            <div class="space-y-1 text-left">
              <p class="text-center">{{ visibleOpenCodeIssue.title }}</p>
              <p v-if="visibleOpenCodeIssue.summary && visibleOpenCodeIssue.summary !== visibleOpenCodeIssue.title">
                {{ visibleOpenCodeIssue.summary }}
              </p>
              <p
                v-if="visibleOpenCodeIssue.detail"
                class="break-words rounded bg-destructive/5 px-2 py-1 font-mono text-[11px] text-destructive/90"
              >
                {{ visibleOpenCodeIssue.detail }}
              </p>
              <p v-if="visibleOpenCodeIssue.hint" class="text-[12px]">{{ visibleOpenCodeIssue.hint }}</p>
              <p v-if="visibleOpenCodeIssue.code" class="font-mono text-[10px] text-destructive/70">
                code: {{ visibleOpenCodeIssue.code }}
              </p>
            </div>
          </template>
          <template v-else>
            <div class="text-center">{{ visiblePageError }}</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
