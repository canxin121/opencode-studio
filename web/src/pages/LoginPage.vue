<script setup lang="ts">
import { computed, ref } from 'vue'

import { useAuthStore } from '../stores/auth'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const auth = useAuthStore()

const password = ref('')
const busy = ref(false)

const canSubmit = computed(() => password.value.trim().length > 0 && !busy.value)

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  try {
    await auth.login(password.value)
    password.value = ''
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
          <h1 class="text-2xl font-semibold tracking-tight text-foreground">OpenCode Studio</h1>
          <p class="text-sm text-muted-foreground">Enter your password to continue</p>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="grid gap-2">
          <Input
            id="password"
            v-model="password"
            type="password"
            placeholder="Password"
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
          {{ busy ? 'Verifying...' : 'Unlock' }}
        </Button>
      </div>

      <div v-if="auth.lastError" class="animate-in fade-in slide-in-from-top-2">
        <div
          class="rounded-lg bg-destructive/10 p-3 text-center text-sm font-medium text-destructive ring-1 ring-inset ring-destructive/20"
        >
          {{ auth.lastError }}
        </div>
      </div>
    </div>
  </div>
</template>
