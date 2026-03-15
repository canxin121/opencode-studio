<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RiCloseLine,
  RiFileList2Line,
  RiFileTextLine,
  RiGitMergeLine,
  RiRefreshLine,
  RiTerminalBoxLine,
  RiGlobalLine,
} from '@remixicon/vue'

import ChatSessionChangesDockPanel from '@/components/chat/ChatSessionChangesDockPanel.vue'
import { useUiStore } from '@/stores/ui'
import IconButton from '@/components/ui/IconButton.vue'
import TerminalDockPanel from '@/features/terminal/components/TerminalDockPanel.vue'
import WorkspacePreviewDockPanel from '@/features/workspacePreview/components/WorkspacePreviewDockPanel.vue'

const FilesDockPanel = defineAsyncComponent(() => import('@/pages/FilesPage.vue'))
const GitDockPanel = defineAsyncComponent(() => import('@/pages/GitPage.vue'))

const { t } = useI18n()
const ui = useUiStore()
const route = useRoute()

if (ui.workspaceDockPlacement !== 'right') {
  ui.setWorkspaceDockPlacement('right')
}

const changesDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)
const filesDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)
const gitDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)
const terminalDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)
const previewDockRef = ref<{ refresh: () => Promise<void> | void } | null>(null)

const showChatChangesPanel = computed(() =>
  String(route.path || '')
    .trim()
    .toLowerCase()
    .startsWith('/chat'),
)

watch(
  showChatChangesPanel,
  (enabled) => {
    if (!enabled && ui.workspaceDockPanel === 'changes') {
      ui.setWorkspaceDockPanel('git')
    }
  },
  { immediate: true },
)

function refreshActivePanel() {
  if (ui.workspaceDockPanel === 'changes') {
    void changesDockRef.value?.refresh()
    return
  }
  if (ui.workspaceDockPanel === 'preview') {
    void previewDockRef.value?.refresh()
    return
  }
  if (ui.workspaceDockPanel === 'git') {
    void gitDockRef.value?.refresh()
    return
  }
  if (ui.workspaceDockPanel === 'files') {
    void filesDockRef.value?.refresh()
    return
  }
  void terminalDockRef.value?.refresh()
}
</script>

<template>
  <aside class="h-full w-full border-l border-border/60 bg-sidebar/70 backdrop-blur-sm">
    <div class="flex h-full flex-col">
      <div class="border-b border-border/60 px-2 py-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1 rounded-md bg-background/70 p-1">
            <button
              v-if="showChatChangesPanel"
              type="button"
              class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors"
              :class="
                ui.workspaceDockPanel === 'changes'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="ui.setWorkspaceDockPanel('changes')"
            >
              <RiFileList2Line class="h-3.5 w-3.5" />
              {{ t('workspaceDock.changes.tab') }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors"
              :class="
                ui.workspaceDockPanel === 'preview'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="ui.setWorkspaceDockPanel('preview')"
            >
              <RiGlobalLine class="h-3.5 w-3.5" />
              {{ t('workspaceDock.preview.tab') }}
            </button>
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
                ui.workspaceDockPanel === 'files'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="ui.setWorkspaceDockPanel('files')"
            >
              <RiFileTextLine class="h-3.5 w-3.5" />
              {{ t('workspaceDock.files.tab') }}
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
        <div
          v-if="showChatChangesPanel && ui.workspaceDockPanel === 'changes'"
          key="changes"
          class="min-h-0 flex-1 overflow-hidden"
        >
          <ChatSessionChangesDockPanel ref="changesDockRef" />
        </div>

        <div v-else-if="ui.workspaceDockPanel === 'preview'" key="preview" class="min-h-0 flex-1 overflow-hidden">
          <WorkspacePreviewDockPanel ref="previewDockRef" viewer-mode="responsive" />
        </div>

        <div v-else-if="ui.workspaceDockPanel === 'git'" key="git" class="min-h-0 flex-1 overflow-hidden">
          <GitDockPanel ref="gitDockRef" embedded />
        </div>

        <div v-else-if="ui.workspaceDockPanel === 'files'" key="files" class="min-h-0 flex-1 overflow-hidden">
          <FilesDockPanel ref="filesDockRef" embedded />
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
