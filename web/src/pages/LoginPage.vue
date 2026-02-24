<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '../stores/auth'
import { useBackendsStore } from '@/stores/backends'
import { useHealthStore } from '@/stores/health'
import { clearUiAuthTokenForBaseUrl } from '@/lib/uiAuthToken'
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
const { t } = useI18n()

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
  if (id === NEW_BACKEND_ID) {
    if (!newBackendLabel.value.trim()) return false
    if (!newBackendUrl.value.trim()) return false
  }
  return true
})

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  formError.value = null
  try {
    const activeBefore = backends.activeBackend?.id || null
    const selectedId = String(selectedBackendId.value || '').trim()
    let backendChanged = false

    if (selectedId === NEW_BACKEND_ID) {
      const res = backends.addBackend({
        label: newBackendLabel.value,
        baseUrl: newBackendUrl.value,
        setActive: true,
      })
      if (!res.ok) {
        formError.value = res.error || String(t('login.failedToAddBackend'))
        return
      }
      backendChanged = true
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
  <div class="flex min-h-screen items-center justify-center bg-background px-4">
    <div class="w-full max-w-[360px] space-y-6">
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
              placeholder="http://127.0.0.1:3000"
              :disabled="busy"
              class="h-10"
              autocomplete="url"
              inputmode="url"
            />
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

      <div v-if="formError || auth.lastError" class="animate-in fade-in slide-in-from-top-2">
        <div
          class="rounded-lg bg-destructive/10 p-3 text-center text-sm font-medium text-destructive ring-1 ring-inset ring-destructive/20"
        >
          {{ formError || auth.lastError }}
        </div>
      </div>
    </div>
  </div>
</template>
