<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import type { DesktopBackendErrorInfo } from '@/lib/desktopConfig'

const props = defineProps<{
  backendError?: string | null
  backendErrorInfo?: DesktopBackendErrorInfo | null
}>()

const emit = defineEmits<{
  retry: []
  openConfig: []
}>()

const { t } = useI18n()

type DesktopBackendIssue = {
  title: string
  summary: string
  detail: string
  hint: string
  code: string
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function formatExitContext(info: DesktopBackendErrorInfo): string {
  if (typeof info.exitCode === 'number' && Number.isFinite(info.exitCode)) {
    return `exit code: ${Math.floor(info.exitCode)}`
  }
  if (typeof info.signal === 'number' && Number.isFinite(info.signal)) {
    return `signal: ${Math.floor(info.signal)}`
  }
  return ''
}

function buildBackendIssueFromInfo(info: DesktopBackendErrorInfo): DesktopBackendIssue {
  const title = String(t('login.backendNotReachable'))
  const summary = normalizeText(info.summary)
  const hint = normalizeText(info.hint)
  const code = normalizeText(info.code)
  const exitContext = formatExitContext(info)

  let detail = normalizeText(info.detail)
  if (!detail) {
    detail = exitContext
  } else if (exitContext) {
    detail = `${detail}\n${exitContext}`
  }

  return {
    title,
    summary: summary || title,
    detail,
    hint,
    code,
  }
}

function buildLegacyBackendIssue(raw: string): DesktopBackendIssue {
  const title = String(t('login.backendNotReachable'))
  let summary = raw
  let detail = ''

  if (!detail && raw.includes('\n')) {
    const lines = raw
      .split('\n')
      .map((line) => normalizeText(line))
      .filter(Boolean)
    if (lines.length >= 2) {
      summary = lines[0]
      detail = lines.slice(1).join(' | ')
    }
  }

  return {
    title,
    summary: summary || title,
    detail,
    hint: '',
    code: '',
  }
}

const backendIssue = computed(() => {
  if (props.backendErrorInfo) {
    return buildBackendIssueFromInfo(props.backendErrorInfo)
  }
  const raw = normalizeText(props.backendError)
  if (!raw) return null
  return buildLegacyBackendIssue(raw)
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background px-4">
    <div
      class="w-full max-w-[420px] rounded-2xl border border-border/80 bg-card/80 p-8 text-center shadow-xl shadow-black/5 backdrop-blur"
    >
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/20"
      >
        <img src="/favicon.svg" :alt="t('app.title')" class="h-8 w-8" />
      </div>
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('app.title') }}</h1>
      <p class="mt-2 text-sm text-muted-foreground">{{ t('login.backendLoadingToast') }}</p>

      <div class="mt-6 flex items-center justify-center gap-3 text-muted-foreground" v-if="!backendIssue">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <span class="text-sm">{{ t('common.connecting') }}</span>
      </div>

      <div
        v-else
        class="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive"
      >
        <div class="space-y-1">
          <p class="text-center">{{ backendIssue?.title }}</p>
          <p v-if="backendIssue?.summary && backendIssue.summary !== backendIssue.title">{{ backendIssue.summary }}</p>
          <p
            v-if="backendIssue?.detail"
            class="break-words rounded bg-destructive/5 px-2 py-1 font-mono text-[11px] text-destructive/90"
          >
            {{ backendIssue.detail }}
          </p>
          <p v-if="backendIssue?.hint" class="text-[12px]">{{ backendIssue.hint }}</p>
          <p v-if="backendIssue?.code" class="font-mono text-[10px] text-destructive/70">
            code: {{ backendIssue.code }}
          </p>
        </div>
      </div>

      <div class="mt-5 flex items-center justify-center gap-2">
        <Button size="sm" variant="outline" @click="emit('retry')">{{ t('common.retry') }}</Button>
        <Button size="sm" @click="emit('openConfig')">{{ t('login.openRuntimeConfig') }}</Button>
      </div>
    </div>
  </div>
</template>
