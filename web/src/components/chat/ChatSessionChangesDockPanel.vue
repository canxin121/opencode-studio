<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { RiArrowLeftSLine, RiExternalLinkLine, RiLoader4Line, RiRefreshLine, RiTextWrap } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import GitStatusListItem from '@/components/git/GitStatusListItem.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { buildVirtualMonacoDiffModel } from '@/features/git/diff/unifiedDiff'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import type { SessionFileDiff } from '@/types/chat'
import { resolveSessionDiffNavigationView, type SessionDiffMobileView } from './sessionDiffMobileNav'
import { resolveSessionDiffPanelView } from './sessionDiffPanelState'

const { t } = useI18n()
const chat = useChatStore()
const ui = useUiStore()

const rootEl = ref<HTMLElement | null>(null)
const diffListEl = ref<HTMLElement | null>(null)
const selectedDiffFile = ref('')
const sessionDiffWrap = ref(true)
const mobileDiffView = ref<SessionDiffMobileView>('list')

const { width: panelWidth } = useElementSize(rootEl)

const sessionDiff = computed<SessionFileDiff[]>(() => {
  const list = chat.selectedSessionDiff
  return Array.isArray(list) ? list : []
})
const sessionDiffCount = computed(() => sessionDiff.value.length)
const sessionSummaryFileCount = computed(() => {
  const raw = chat.selectedSession?.summary?.files
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
})
const hasSummarySessionChanges = computed(() => sessionSummaryFileCount.value > 0)
const sessionDiffPanelView = computed(() =>
  resolveSessionDiffPanelView({
    loading: chat.selectedSessionDiffLoading,
    error: chat.selectedSessionDiffError,
    diffCount: sessionDiffCount.value,
    diffLoaded: chat.selectedSessionDiffLoaded,
    hasSummaryChanges: hasSummarySessionChanges.value,
  }),
)
const selectedDiff = computed(() => {
  const target = selectedDiffFile.value
  if (!target) return null
  return sessionDiff.value.find((entry) => entry.file === target) || null
})
const selectedDiffPath = computed(() => selectedDiff.value?.file || '')
const selectedDiffPreview = computed(() => {
  const entry = selectedDiff.value
  if (!entry) return null
  return buildVirtualMonacoDiffModel({
    modelId: `session-diff:dock:${entry.file}`,
    path: entry.file,
    original: entry.before,
    modified: entry.after,
    diff: entry.diff,
    meta: entry.meta,
    preferPatch: true,
    compactSnapshots: true,
  })
})
const isNarrowPanel = computed(() => panelWidth.value > 0 && panelWidth.value < 520)
const sessionDiffNavigationView = computed(() =>
  resolveSessionDiffNavigationView({
    isNarrowViewport: isNarrowPanel.value,
    hasDiffEntries: sessionDiffCount.value > 0,
    selectedDiffPath: selectedDiffPath.value,
    mobileView: mobileDiffView.value,
  }),
)

function selectDiffFile(path: string) {
  selectedDiffFile.value = path
  if (isNarrowPanel.value) mobileDiffView.value = 'detail'
}

function backToDiffList() {
  mobileDiffView.value = 'list'
}

async function refresh() {
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  await chat.refreshSessionDiff(sid, { silent: true })
}

function openSelectedFile() {
  const path = selectedDiffPath.value
  if (!path) return
  ui.requestWorkspaceDockFile(path, 'open')
}

function maybeLoadMoreSessionDiff() {
  if (!chat.selectedSessionDiffHasMore || chat.selectedSessionDiffLoadingMore || chat.selectedSessionDiffLoading) return
  const el = diffListEl.value
  if (!el) return
  const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight)
  if (remaining > 88) return
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  void chat.loadMoreSessionDiff(sid, { silent: true })
}

watch(
  sessionDiff,
  () => {
    const list = sessionDiff.value
    if (!list.length) {
      selectedDiffFile.value = ''
      mobileDiffView.value = 'list'
      return
    }
    if (!list.some((entry) => entry.file === selectedDiffFile.value)) {
      selectedDiffFile.value = list[0]?.file || ''
    }
    void nextTick(() => {
      maybeLoadMoreSessionDiff()
    })
  },
  { immediate: true },
)

watch(
  () => chat.selectedSessionId,
  (sid, previousSid) => {
    selectedDiffFile.value = ''
    mobileDiffView.value = 'list'
    if (previousSid !== undefined) return
    if (!String(sid || '').trim()) return
    if (chat.selectedSessionDiffLoaded || chat.selectedSessionDiffLoading) return
    void refresh()
  },
  { immediate: true },
)

defineExpose({ refresh })
</script>

<template>
  <section ref="rootEl" class="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
    <div class="border-b border-sidebar-border/50 px-2 py-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="typography-ui-label font-medium text-foreground">{{ t('workspaceDock.changes.tab') }}</div>
          <div class="truncate text-[11px] text-muted-foreground">
            {{
              chat.selectedSessionId ? t('workspaceDock.changes.currentSession') : t('workspaceDock.changes.noSession')
            }}
          </div>
        </div>

        <div class="flex items-center gap-1">
          <IconButton
            size="sm"
            :disabled="!chat.selectedSessionId || chat.selectedSessionDiffLoading"
            :tooltip="t('workspaceDock.refresh')"
            :aria-label="t('workspaceDock.refresh')"
            @click="refresh"
          >
            <RiLoader4Line v-if="chat.selectedSessionDiffLoading" class="h-4 w-4 animate-spin" />
            <RiRefreshLine v-else class="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>

    <div v-if="!chat.selectedSessionId" class="flex min-h-0 flex-1 items-center justify-center p-4">
      <div class="max-w-[24rem] rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3 text-center">
        <div class="text-sm font-medium text-foreground">{{ t('workspaceDock.changes.noSession') }}</div>
        <div class="mt-1 text-xs text-muted-foreground">{{ t('workspaceDock.changes.noSessionHint') }}</div>
      </div>
    </div>

    <div v-else-if="sessionDiffPanelView === 'loading'" class="px-3 py-6 text-xs text-muted-foreground">
      {{ t('chat.sessionDiff.loading') }}
    </div>
    <div v-else-if="sessionDiffPanelView === 'error'" class="px-3 py-6 text-xs text-destructive">
      {{ chat.selectedSessionDiffError }}
    </div>
    <div v-else-if="sessionDiffPanelView === 'empty'" class="px-3 py-6 text-xs text-muted-foreground">
      {{ t('chat.sessionDiff.empty') }}
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col" :class="sessionDiffNavigationView === 'split' ? 'flex-row' : ''">
      <div
        v-if="sessionDiffNavigationView !== 'detail'"
        ref="diffListEl"
        class="min-h-0 flex-1 overflow-auto border-sidebar-border/60"
        :class="sessionDiffNavigationView === 'split' ? 'w-72 max-w-72 min-w-72 border-r' : ''"
        @scroll.passive="maybeLoadMoreSessionDiff"
      >
        <div class="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
          {{ t('chat.sessionDiff.listTitle') }}
        </div>

        <div class="space-y-0.5 px-1 pb-1">
          <GitStatusListItem
            v-for="entry in sessionDiff"
            :key="entry.file"
            :path="entry.file"
            :active="selectedDiffPath === entry.file"
            :insertions="entry.additions"
            :deletions="entry.deletions"
            :is-mobile-pointer="ui.isMobilePointer"
            @select="selectDiffFile(entry.file)"
          />
        </div>

        <div v-if="chat.selectedSessionDiffLoadingMore" class="px-3 py-2 text-[11px] text-muted-foreground">
          {{ t('chat.sessionDiff.loading') }}
        </div>
      </div>

      <div v-if="sessionDiffNavigationView === 'detail'" class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-center gap-2 border-b border-sidebar-border/50 px-2 py-1">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/45 hover:text-foreground"
            :title="t('chat.sessionDiff.backToList')"
            :aria-label="t('chat.sessionDiff.backToList')"
            @click="backToDiffList"
          >
            <RiArrowLeftSLine class="h-4 w-4" />
            <span>{{ t('chat.sessionDiff.backToList') }}</span>
          </button>

          <div class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" :title="selectedDiffPath">
            {{ selectedDiffPath }}
          </div>

          <IconButton
            variant="outline"
            size="xs"
            class="h-6 w-6 transition-colors"
            :class="
              sessionDiffWrap
                ? 'bg-sidebar-accent/70 text-foreground shadow-inner'
                : 'text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground'
            "
            :aria-pressed="sessionDiffWrap"
            :title="sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable')"
            :aria-label="sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable')"
            @click="sessionDiffWrap = !sessionDiffWrap"
          >
            <RiTextWrap class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="outline"
            size="xs"
            class="h-6 w-6"
            :title="t('workspaceDock.changes.openFile')"
            :aria-label="t('workspaceDock.changes.openFile')"
            @click="openSelectedFile"
          >
            <RiExternalLinkLine class="h-4 w-4" />
          </IconButton>
        </div>

        <div class="min-h-[220px] min-w-0 flex-1">
          <MonacoDiffEditor
            class="h-full"
            :path="selectedDiffPreview?.path || selectedDiffPath"
            :language-path="selectedDiffPreview?.path || selectedDiffPath"
            :model-id="selectedDiffPreview?.modelId || ''"
            :original-model-id="selectedDiffPreview ? `${selectedDiffPreview.modelId}:base` : ''"
            :original-value="selectedDiffPreview?.original || ''"
            :modified-value="selectedDiffPreview?.modified || ''"
            :initial-top-line="selectedDiffPreview?.initialTopLine || null"
            :original-start-line="selectedDiffPreview?.originalStartLine || null"
            :modified-start-line="selectedDiffPreview?.modifiedStartLine || null"
            :original-line-numbers="selectedDiffPreview?.originalLineNumbers || null"
            :modified-line-numbers="selectedDiffPreview?.modifiedLineNumbers || null"
            :use-files-theme="true"
            :read-only="true"
            :wrap="sessionDiffWrap"
          />
        </div>
      </div>

      <div v-else-if="sessionDiffNavigationView === 'split'" class="min-w-0 flex flex-1 flex-col">
        <div class="flex items-center gap-2 border-b border-sidebar-border/50 px-2 py-1">
          <div class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" :title="selectedDiffPath">
            {{ selectedDiffPath }}
          </div>

          <IconButton
            variant="outline"
            size="xs"
            class="h-6 w-6 transition-colors"
            :class="
              sessionDiffWrap
                ? 'bg-sidebar-accent/70 text-foreground shadow-inner'
                : 'text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground'
            "
            :aria-pressed="sessionDiffWrap"
            :title="sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable')"
            :aria-label="sessionDiffWrap ? t('chat.sessionDiff.wrap.disable') : t('chat.sessionDiff.wrap.enable')"
            @click="sessionDiffWrap = !sessionDiffWrap"
          >
            <RiTextWrap class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="outline"
            size="xs"
            class="h-6 w-6"
            :title="t('workspaceDock.changes.openFile')"
            :aria-label="t('workspaceDock.changes.openFile')"
            @click="openSelectedFile"
          >
            <RiExternalLinkLine class="h-4 w-4" />
          </IconButton>
        </div>

        <MonacoDiffEditor
          class="h-full"
          :path="selectedDiffPreview?.path || selectedDiffPath"
          :language-path="selectedDiffPreview?.path || selectedDiffPath"
          :model-id="selectedDiffPreview?.modelId || ''"
          :original-model-id="selectedDiffPreview ? `${selectedDiffPreview.modelId}:base` : ''"
          :original-value="selectedDiffPreview?.original || ''"
          :modified-value="selectedDiffPreview?.modified || ''"
          :initial-top-line="selectedDiffPreview?.initialTopLine || null"
          :original-start-line="selectedDiffPreview?.originalStartLine || null"
          :modified-start-line="selectedDiffPreview?.modifiedStartLine || null"
          :original-line-numbers="selectedDiffPreview?.originalLineNumbers || null"
          :modified-line-numbers="selectedDiffPreview?.modifiedLineNumbers || null"
          :use-files-theme="true"
          :read-only="true"
          :wrap="sessionDiffWrap"
        />
      </div>
    </div>
  </section>
</template>
