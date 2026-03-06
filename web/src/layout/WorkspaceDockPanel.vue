<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RiCloseLine,
  RiGitMergeLine,
  RiLayoutBottomLine,
  RiLayoutRightLine,
  RiRefreshLine,
  RiTerminalBoxLine,
} from '@remixicon/vue'

import { apiJson } from '@/lib/api'
import type { GitStatusResponse, GitStatusFile } from '@/types/git'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'
import IconButton from '@/components/ui/IconButton.vue'
import TerminalDockPanel from '@/features/terminal/components/TerminalDockPanel.vue'

const router = useRouter()
const { t } = useI18n()
const ui = useUiStore()
const directoryStore = useDirectoryStore()

const gitLoading = ref(false)
const gitError = ref<string | null>(null)
const gitStatus = ref<GitStatusResponse | null>(null)

const terminalDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)

let gitTimer: number | null = null

const directoryPath = computed(() => String(directoryStore.currentDirectory || '').trim())
const isGitPanel = computed(() => ui.workspaceDockPanel === 'git')

const gitFilesPreview = computed(() => (gitStatus.value?.files || []).slice(0, 8))
const gitBranchLabel = computed(() => {
  const branch = String(gitStatus.value?.current || '').trim()
  return branch || String(t('workspaceDock.git.noRepo'))
})

const panelEdgeClass = computed(() => {
  return ui.workspaceDockPlacement === 'bottom' ? 'border-t border-border/60' : 'border-l border-border/60'
})

function statusTagForFile(file: GitStatusFile): string {
  const index = String(file.index || '').trim()
  const working = String(file.workingDir || '').trim()
  if (index === '?' || working === '?') return '??'
  if (index === 'D' || working === 'D') return 'D'
  if (index === 'A' || working === 'A') return 'A'
  if (index === 'M' || working === 'M') return 'M'
  if (index === 'R' || working === 'R') return 'R'
  return '•'
}

async function refreshGit() {
  if (!isGitPanel.value) return
  const dir = directoryPath.value
  if (!dir) {
    gitStatus.value = null
    gitError.value = null
    return
  }
  gitLoading.value = true
  gitError.value = null
  try {
    gitStatus.value = await apiJson<GitStatusResponse>(
      `/api/git/status?directory=${encodeURIComponent(dir)}&limit=12&offset=0`,
    )
  } catch (err) {
    gitStatus.value = null
    gitError.value = err instanceof Error ? err.message : String(err)
  } finally {
    gitLoading.value = false
  }
}

function clearTimers() {
  if (gitTimer !== null) {
    window.clearInterval(gitTimer)
    gitTimer = null
  }
}

function startPolling() {
  clearTimers()
  if (isGitPanel.value) {
    void refreshGit()
    gitTimer = window.setInterval(() => void refreshGit(), 4000)
  }
}

function openGitPage() {
  void router.push('/git')
}

function refreshActivePanel() {
  if (ui.workspaceDockPanel === 'git') {
    void refreshGit()
    return
  }
  void terminalDockRef.value?.refresh()
}

watch(
  () => [directoryPath.value, ui.workspaceDockPanel] as const,
  () => {
    startPolling()
  },
)

onMounted(() => {
  startPolling()
})

onBeforeUnmount(() => {
  clearTimers()
})
</script>

<template>
  <aside class="h-full w-full bg-sidebar/70 backdrop-blur-sm" :class="panelEdgeClass">
    <div class="flex h-full flex-col">
      <div class="border-b border-border/60 px-2 py-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1 rounded-md bg-background/70 p-1">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors"
              :class="
                ui.workspaceDockPanel === 'git'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="ui.setWorkspaceDockPanel('git')"
            >
              <RiGitMergeLine class="h-3.5 w-3.5" />
              {{ t('workspaceDock.git.tab') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors"
              :class="
                ui.workspaceDockPanel === 'terminal'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="ui.setWorkspaceDockPanel('terminal')"
            >
              <RiTerminalBoxLine class="h-3.5 w-3.5" />
              {{ t('workspaceDock.terminal.tab') }}
            </button>
          </div>

          <div class="flex items-center gap-1">
            <IconButton
              size="sm"
              :tooltip="t('workspaceDock.placementRight')"
              :aria-label="t('workspaceDock.placementRight')"
              :variant="ui.workspaceDockPlacement === 'right' ? 'secondary' : 'ghost'"
              @click="ui.setWorkspaceDockPlacement('right')"
            >
              <RiLayoutRightLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="sm"
              :tooltip="t('workspaceDock.placementBottom')"
              :aria-label="t('workspaceDock.placementBottom')"
              :variant="ui.workspaceDockPlacement === 'bottom' ? 'secondary' : 'ghost'"
              @click="ui.setWorkspaceDockPlacement('bottom')"
            >
              <RiLayoutBottomLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="sm"
              :tooltip="t('workspaceDock.refresh')"
              :aria-label="t('workspaceDock.refresh')"
              @click="refreshActivePanel"
            >
              <RiRefreshLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="sm"
              :tooltip="t('workspaceDock.close')"
              :aria-label="t('workspaceDock.close')"
              @click="ui.setWorkspaceDockOpen(false)"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <Transition name="fade" mode="out-in">
        <div v-if="ui.workspaceDockPanel === 'git'" key="git" class="min-h-0 flex-1 overflow-auto p-3">
          <div class="mb-3 rounded-md border border-border/60 bg-background/60 p-3">
            <div class="text-xs text-muted-foreground">{{ t('workspaceDock.git.branch') }}</div>
            <div class="mt-1 truncate font-mono text-xs text-foreground">{{ gitBranchLabel }}</div>
            <div v-if="gitStatus" class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span class="rounded bg-secondary px-1.5 py-0.5"
                >{{ t('workspaceDock.git.staged') }} {{ gitStatus.stagedCount }}</span
              >
              <span class="rounded bg-secondary px-1.5 py-0.5"
                >{{ t('workspaceDock.git.unstaged') }} {{ gitStatus.unstagedCount }}</span
              >
              <span class="rounded bg-secondary px-1.5 py-0.5"
                >{{ t('workspaceDock.git.untracked') }} {{ gitStatus.untrackedCount }}</span
              >
            </div>
          </div>

          <div
            v-if="gitError"
            class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {{ gitError }}
          </div>
          <div v-else-if="gitLoading" class="text-xs text-muted-foreground">{{ t('workspaceDock.loading') }}</div>
          <div v-else-if="!directoryPath" class="text-xs text-muted-foreground">
            {{ t('workspaceDock.noDirectory') }}
          </div>
          <div v-else-if="!gitStatus" class="text-xs text-muted-foreground">{{ t('workspaceDock.git.noRepo') }}</div>
          <div v-else-if="gitFilesPreview.length === 0" class="text-xs text-muted-foreground">
            {{ t('workspaceDock.git.clean') }}
          </div>
          <div v-else class="space-y-1">
            <button
              v-for="file in gitFilesPreview"
              :key="file.path"
              type="button"
              class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary/50"
              @click="openGitPage"
            >
              <span class="font-mono text-[10px] text-muted-foreground">{{ statusTagForFile(file) }}</span>
              <span class="truncate">{{ file.path }}</span>
            </button>
            <button type="button" class="mt-2 text-xs text-primary hover:underline" @click="openGitPage">
              {{ t('workspaceDock.openGit') }}
            </button>
          </div>
        </div>

        <div v-else key="terminal" class="min-h-0 flex-1 overflow-hidden">
          <TerminalDockPanel ref="terminalDockRef" />
        </div>
      </Transition>
    </div>
  </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 140ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
