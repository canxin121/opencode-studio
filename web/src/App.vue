<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'

import { useAuthStore } from './stores/auth'
import { useHealthStore } from './stores/health'
import { useSettingsStore } from './stores/settings'

import { applyAppearanceSettingsToDom } from './lib/appearance'

import LoginPage from './pages/LoginPage.vue'
import MainLayout from './layout/MainLayout.vue'
import ToastHost from './components/ToastHost.vue'

const auth = useAuthStore()
const health = useHealthStore()
const settings = useSettingsStore()

const initialLoading = ref(true)
const showLogin = computed(() => auth.needsLogin)

onMounted(async () => {
  await Promise.all([auth.refresh(), health.refresh()])
  initialLoading.value = false
})

watchEffect(() => {
  // Apply theme + typography immediately when settings change.
  applyAppearanceSettingsToDom(settings.data)
})
</script>

<template>
  <div class="app-root">
    <ToastHost />
    <!-- Initial Loading State: Matches Login Page aesthetic for seamless transition -->
    <div v-if="initialLoading" class="flex min-h-screen items-center justify-center bg-background px-4">
      <div class="flex flex-col items-center gap-6 animate-pulse">
        <div
          class="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 ring-1 ring-inset ring-foreground/5"
        >
          <img src="/favicon.svg" alt="OpenCode Studio" class="h-12 w-12 opacity-90" />
        </div>
      </div>
    </div>

    <LoginPage v-else-if="showLogin" />
    <MainLayout v-else />
  </div>
</template>

<style scoped>
.app-root {
  height: 100%;
}
</style>
