<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Dialog from '@/components/ui/Dialog.vue'
import Button from '@/components/ui/Button.vue'
import { apiJson } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { useToastsStore } from '@/stores/toasts'

type McpStatus = { status: string; error?: string }

const ui = useUiStore()
const toasts = useToastsStore()

const loading = ref(false)
const error = ref('')
const busyName = ref<string | null>(null)
const statusMap = ref<Record<string, McpStatus>>({})

const entries = computed(() => {
  return Object.entries(statusMap.value).sort((a, b) => a[0].localeCompare(b[0]))
})

function statusTone(status: McpStatus | undefined): string {
  const s = status?.status || ''
  if (s === 'connected') return 'text-emerald-500'
  if (s === 'disabled') return 'text-muted-foreground'
  if (s === 'needs_auth') return 'text-amber-500'
  if (s === 'needs_client_registration') return 'text-amber-500'
  if (s === 'failed') return 'text-rose-500'
  return 'text-muted-foreground'
}

function actionLabel(status: McpStatus | undefined): string {
  const s = status?.status || ''
  if (s === 'connected') return 'Disconnect'
  if (s === 'disabled') return 'Connect'
  if (s === 'needs_auth') return 'Authenticate'
  if (s === 'failed') return 'Retry'
  return ''
}

function canAct(status: McpStatus | undefined): boolean {
  const s = status?.status || ''
  return s === 'connected' || s === 'disabled' || s === 'needs_auth' || s === 'failed'
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const data = await apiJson<Record<string, McpStatus>>('/api/mcp')
    statusMap.value = data || {}
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    statusMap.value = {}
  } finally {
    loading.value = false
  }
}

async function runAction(name: string, status: McpStatus | undefined) {
  if (!name || !status || busyName.value) return
  busyName.value = name
  try {
    const encoded = encodeURIComponent(name)
    if (status.status === 'connected') {
      await apiJson(`/api/mcp/${encoded}/disconnect`, { method: 'POST' })
    } else if (status.status === 'disabled' || status.status === 'failed') {
      await apiJson(`/api/mcp/${encoded}/connect`, { method: 'POST' })
    } else if (status.status === 'needs_auth') {
      await apiJson(`/api/mcp/${encoded}/auth/authenticate`, { method: 'POST' })
    }
    await refresh()
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    busyName.value = null
  }
}

watch(
  () => ui.isMcpDialogOpen,
  (open) => {
    if (open) void refresh()
  },
)
</script>

<template>
  <Dialog
    :open="ui.isMcpDialogOpen"
    title="MCP servers"
    description="Manage Model Context Protocol connections"
    maxWidth="max-w-[calc(100vw-2rem)] sm:max-w-lg"
    @update:open="(v) => ui.setMcpDialogOpen(v)"
  >
    <div class="space-y-4">
      <div v-if="loading" class="text-xs text-muted-foreground">Loading MCP status…</div>
      <div v-else-if="error" class="text-xs text-destructive">{{ error }}</div>
      <div v-else-if="entries.length === 0" class="text-xs text-muted-foreground">No MCP servers configured.</div>

      <div v-else class="space-y-2">
        <div
          v-for="[name, status] in entries"
          :key="name"
          class="rounded-md border border-border/60 bg-background/50 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-semibold break-words">{{ name }}</div>
              <div class="text-[11px]" :class="statusTone(status)">{{ status.status }}</div>
            </div>
            <Button
              v-if="canAct(status)"
              size="sm"
              variant="outline"
              :disabled="busyName === name"
              @click="runAction(name, status)"
            >
              {{ busyName === name ? 'Working…' : actionLabel(status) }}
            </Button>
          </div>
          <div v-if="status.error" class="mt-2 text-xs text-destructive break-words">{{ status.error }}</div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <Button variant="outline" @click="refresh" :disabled="loading">{{
          loading ? 'Refreshing…' : 'Refresh'
        }}</Button>
      </div>
    </div>
  </Dialog>
</template>
