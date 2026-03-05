<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'

defineProps<{
  backendError?: string | null
}>()

const emit = defineEmits<{
  retry: []
  openConfig: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background px-4">
    <div
      class="w-full max-w-[420px] rounded-2xl border border-border/80 bg-card/80 p-8 text-center shadow-xl shadow-black/5 backdrop-blur"
    >
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20"
      >
        <img src="/favicon.svg" alt="OpenCode Studio" class="h-8 w-8" />
      </div>
      <h1 class="text-xl font-semibold tracking-tight text-foreground">OpenCode Studio</h1>
      <p class="mt-2 text-sm text-muted-foreground">{{ t('login.backendLoadingToast') }}</p>

      <div class="mt-6 flex items-center justify-center gap-3 text-muted-foreground" v-if="!backendError">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <span class="text-sm">{{ t('common.connecting') }}</span>
      </div>

      <div
        v-else
        class="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive"
      >
        {{ backendError }}
      </div>

      <div class="mt-5 flex items-center justify-center gap-2">
        <Button size="sm" variant="outline" @click="emit('retry')">{{ t('common.retry') }}</Button>
        <Button size="sm" @click="emit('openConfig')">{{ t('login.openRuntimeConfig') }}</Button>
      </div>
    </div>
  </div>
</template>
