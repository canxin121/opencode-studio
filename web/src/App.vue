<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'

import { useAuthStore } from './stores/auth'
import { useHealthStore } from './stores/health'
import { useSettingsStore } from './stores/settings'
import { desktopBackendStatus, desktopOpenConfig, isDesktopRuntime } from './lib/desktopConfig'
import type { DesktopBackendErrorInfo } from './lib/desktopConfig'
import { syncDesktopBackendTarget } from './lib/backend'

import { applyAppearanceSettingsToDom } from './lib/appearance'
import { isEmbeddedWorkspacePaneContext } from './app/windowScope'

import LoginPage from './pages/LoginPage.vue'
import DesktopLoadingPage from './pages/DesktopLoadingPage.vue'
import MainLayout from './layout/MainLayout.vue'
import ToastHost from './components/ToastHost.vue'

const auth = useAuthStore()
const health = useHealthStore()
const settings = useSettingsStore()
const desktopRuntime = isDesktopRuntime()
const isEmbeddedWorkspacePane = isEmbeddedWorkspacePaneContext()
const embeddedBootSettled = ref(!isEmbeddedWorkspacePane)

const desktopBackendReachable = computed(() => health.data !== null)
const backendReady = computed(() => health.data !== null && health.data.isOpenCodeReady)
const showDesktopLoading = computed(() => desktopRuntime && !desktopBackendReachable.value)
const showEmbeddedBootPlaceholder = computed(() => isEmbeddedWorkspacePane && !embeddedBootSettled.value)
const showLogin = computed(
  () =>
    !isEmbeddedWorkspacePane &&
    !showDesktopLoading.value &&
    !showEmbeddedBootPlaceholder.value &&
    (auth.needsLogin || !backendReady.value),
)

let desktopProbeTimer: ReturnType<typeof setInterval> | null = null
let desktopProbeBusy = false
const desktopBackendError = ref('')
const desktopBackendErrorInfo = ref<DesktopBackendErrorInfo | null>(null)

async function refreshDesktopBootState() {
  if (desktopProbeBusy) return
  desktopProbeBusy = true
  try {
    if (desktopRuntime) {
      const syncState = await syncDesktopBackendTarget().catch(() => null)
      if (String(syncState?.last_error || '').trim()) {
        desktopBackendError.value = String(syncState?.last_error || '').trim()
        desktopBackendErrorInfo.value = syncState?.last_error_info || null
      } else {
        const status = await desktopBackendStatus().catch(() => null)
        const err = String(status?.last_error || '').trim()
        desktopBackendError.value = err
        desktopBackendErrorInfo.value = status?.last_error_info || null
      }
    }

    await health.refresh().catch(() => {})
    if (health.data !== null) {
      desktopBackendError.value = ''
      desktopBackendErrorInfo.value = null
      await auth.refresh().catch(() => {})
    }
  } finally {
    desktopProbeBusy = false
  }
}

const loadingError = computed(() => (desktopRuntime ? desktopBackendError.value : ''))
const loadingErrorInfo = computed(() => (desktopRuntime ? desktopBackendErrorInfo.value : null))

function openRuntimeConfig() {
  if (!desktopRuntime) return
  void desktopOpenConfig().catch(() => {})
}

function clearDesktopProbeTimer() {
  if (!desktopProbeTimer) return
  clearInterval(desktopProbeTimer)
  desktopProbeTimer = null
}

function scheduleDesktopProbe() {
  if (!showDesktopLoading.value) return
  if (desktopProbeTimer) return
  desktopProbeTimer = setInterval(() => {
    void refreshDesktopBootState()
  }, 2000)
}

onMounted(() => {
  const authRefresh = auth.refresh().catch(() => {})
  const healthRefresh = health.refresh().catch(() => {})

  if (!isEmbeddedWorkspacePane) return

  void Promise.allSettled([authRefresh, healthRefresh]).then(() => {
    embeddedBootSettled.value = true
  })
})

watch(
  () => showDesktopLoading.value,
  (loading) => {
    if (loading) {
      void refreshDesktopBootState()
      scheduleDesktopProbe()
      return
    }
    clearDesktopProbeTimer()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearDesktopProbeTimer()
})

watchEffect(() => {
  // Apply theme + typography immediately when settings change.
  applyAppearanceSettingsToDom(settings.data)
})
</script>

<template>
  <div class="app-root">
    <ToastHost />
    <DesktopLoadingPage
      v-if="!isEmbeddedWorkspacePane && showDesktopLoading"
      :backend-error="loadingError"
      :backend-error-info="loadingErrorInfo"
      @retry="refreshDesktopBootState"
      @open-config="openRuntimeConfig"
    />
    <div v-else-if="showEmbeddedBootPlaceholder" class="h-full w-full bg-background" />
    <LoginPage v-else-if="showLogin" />
    <MainLayout v-else />
  </div>
</template>

<style scoped>
.app-root {
  height: 100%;
}
</style>
