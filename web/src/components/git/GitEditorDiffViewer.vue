<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiLoader4Line } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import { apiJson } from '@/lib/api'
import Button from '@/components/ui/Button.vue'
import { buildUnifiedDiffModel } from '@/features/git/diff/unifiedDiff'
import type { GitDiffMeta, GitDiffResponse } from '@/types/git'

const { t } = useI18n()

type DiffHunkView = {
  id: string
  header: string
  range: string
  anchorLine: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
  patch: string
  patchReady: boolean
}

type EditorHunkAction = {
  id: string
  anchorLine: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
  stageEnabled: boolean
  unstageEnabled: boolean
  discardEnabled: boolean
  disabled: boolean
}

type HunkActionMode = 'stage' | 'unstage' | 'discard'

const props = defineProps<{
  directory: string | null
  path: string | null
  staged?: boolean
  onStageHunk?: (patch: string) => void | Promise<void>
  onUnstageHunk?: (patch: string) => void | Promise<void>
  onDiscardHunk?: (patch: string) => void | Promise<void>
  onOpenFile?: (path: string) => void | Promise<void>
  onRevealFile?: (path: string) => void | Promise<void>
}>()

const loading = ref(false)
const error = ref<string | null>(null)

const diffText = ref('')
const diffMeta = ref<GitDiffMeta | null>(null)
const original = ref('')
const modified = ref('')

// Keep current content visible while switching files.
const staleDiffText = ref('')
const staleDiffMeta = ref<GitDiffMeta | null>(null)
const staleOriginal = ref('')
const staleModified = ref('')

const activeHunkAction = ref<{ hunkId: string; mode: HunkActionMode } | null>(null)

let loadSeq = 0
let activeAbort: AbortController | null = null

function isDataImageUrl(value: string): boolean {
  return typeof value === 'string' && value.startsWith('data:image/')
}

const normalizedPath = computed(() => (props.path || '').trim())
const diffScope = computed(() => (props.staged ? 'staged' : 'working'))

const originalModelPath = computed(() => {
  const path = normalizedPath.value || 'git-diff-file'
  return `git-diff:${diffScope.value}:original:${path}`
})

const modifiedModelPath = computed(() => {
  const path = normalizedPath.value || 'git-diff-file'
  return `git-diff:${diffScope.value}:modified:${path}`
})

const displayOriginal = computed(() => (loading.value ? original.value || staleOriginal.value : original.value))
const displayModified = computed(() => (loading.value ? modified.value || staleModified.value : modified.value))

const isImageDiff = computed(() => isDataImageUrl(displayOriginal.value) || isDataImageUrl(displayModified.value))
const leftLabel = computed(() => (props.staged ? 'HEAD' : t('git.ui.diffViewer.labels.index')))
const rightLabel = computed(() => (props.staged ? t('git.ui.diffViewer.labels.index') : t('git.ui.diffViewer.labels.workingTree')))
const canOpenFile = computed(() => Boolean(props.onOpenFile) && Boolean(normalizedPath.value))
const canRevealFile = computed(() => Boolean(props.onRevealFile) && Boolean(normalizedPath.value))
const canStageHunk = computed(() => !props.staged && Boolean(props.onStageHunk))
const canUnstageHunk = computed(() => Boolean(props.staged) && Boolean(props.onUnstageHunk))
const canDiscardHunk = computed(() => !props.staged && Boolean(props.onDiscardHunk))
const hasAnyHunkAction = computed(() => canStageHunk.value || canUnstageHunk.value || canDiscardHunk.value)
const isAnyActionBusy = computed(() => Boolean(activeHunkAction.value))

const activeDiff = computed(() => diffText.value || staleDiffText.value)
const activeDiffMeta = computed(() => diffMeta.value || staleDiffMeta.value)
const parsedDiff = computed(() => buildUnifiedDiffModel(activeDiff.value, activeDiffMeta.value))

const hunks = computed<DiffHunkView[]>(() => {
  return parsedDiff.value.hunks.map((hunk) => ({
    id: hunk.id,
    header: hunk.header,
    range: hunk.range,
    anchorLine: hunk.anchorLine,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    additions: hunk.additions,
    deletions: hunk.deletions,
    patch: hunk.patch,
    patchReady: hunk.patchReady,
  }))
})

const hunkById = computed(() => {
  const map = new Map<string, DiffHunkView>()
  for (const hunk of hunks.value) {
    map.set(hunk.id, hunk)
  }
  return map
})

const editorHunkActions = computed<EditorHunkAction[]>(() =>
  hunks.value.map((hunk) => ({
    id: hunk.id,
    anchorLine: hunk.anchorLine,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    additions: hunk.additions,
    deletions: hunk.deletions,
    stageEnabled: canStageHunk.value,
    unstageEnabled: canUnstageHunk.value,
    discardEnabled: canDiscardHunk.value,
    disabled: !hunk.patchReady,
  })),
)

function resetState() {
  loading.value = false
  error.value = null
  diffText.value = ''
  diffMeta.value = null
  original.value = ''
  modified.value = ''
  staleDiffText.value = ''
  staleDiffMeta.value = null
  staleOriginal.value = ''
  staleModified.value = ''
  activeHunkAction.value = null
}

async function runHunkAction(hunk: DiffHunkView, mode: HunkActionMode) {
  if (!hunk.patchReady || !hunk.patch) return
  if (isAnyActionBusy.value) return

  const apply = mode === 'stage' ? props.onStageHunk : mode === 'unstage' ? props.onUnstageHunk : props.onDiscardHunk
  if (!apply) return

  activeHunkAction.value = { hunkId: hunk.id, mode }
  try {
    await Promise.resolve(apply(hunk.patch))
  } finally {
    const active = activeHunkAction.value
    if (active && active.hunkId === hunk.id && active.mode === mode) {
      activeHunkAction.value = null
    }
  }
}

function handleEditorHunkAction(payload: { id: string; kind: HunkActionMode }) {
  const hunkId = String(payload?.id || '').trim()
  if (!hunkId) return
  const hunk = hunkById.value.get(hunkId)
  if (!hunk) return

  if (payload.kind === 'discard' && typeof window !== 'undefined') {
    const confirmed = window.confirm('Discard this hunk? This cannot be undone.')
    if (!confirmed) return
  }

  void runHunkAction(hunk, payload.kind)
}

async function load(opts: { directory: string; path: string; staged: boolean; signal: AbortSignal; seq: number }) {
  staleDiffText.value = diffText.value
  staleDiffMeta.value = diffMeta.value
  staleOriginal.value = original.value
  staleModified.value = modified.value

  loading.value = true
  error.value = null

  try {
    const [diffResponse, fileResponse] = await Promise.all([
      apiJson<GitDiffResponse>(
        `/api/git/diff?directory=${encodeURIComponent(opts.directory)}&path=${encodeURIComponent(opts.path)}&staged=${opts.staged ? 'true' : 'false'}&contextLines=3&includeMeta=true`,
        { signal: opts.signal },
      ),
      apiJson<{ original: string; modified: string }>(
        `/api/git/file-diff?directory=${encodeURIComponent(opts.directory)}&path=${encodeURIComponent(opts.path)}&staged=${opts.staged ? 'true' : 'false'}`,
        { signal: opts.signal },
      ),
    ])

    if (opts.signal.aborted || opts.seq !== loadSeq) return

    diffText.value = diffResponse?.diff || ''
    diffMeta.value = diffResponse?.meta && typeof diffResponse.meta === 'object' ? diffResponse.meta : null
    original.value = fileResponse?.original || ''
    modified.value = fileResponse?.modified || ''
  } catch (e) {
    if (opts.signal.aborted || opts.seq !== loadSeq) return

    error.value = e instanceof Error ? e.message : String(e)
    diffText.value = ''
    diffMeta.value = null
    original.value = ''
    modified.value = ''
  } finally {
    if (opts.signal.aborted || opts.seq !== loadSeq) return
    loading.value = false
  }
}

function openFile() {
  const path = normalizedPath.value
  if (!path || !props.onOpenFile) return
  props.onOpenFile(path)
}

function revealFile() {
  const path = normalizedPath.value
  if (!path || !props.onRevealFile) return
  props.onRevealFile(path)
}

function refresh() {
  const directory = (props.directory || '').trim()
  const path = normalizedPath.value
  if (!directory || !path) return

  activeAbort?.abort()
  const ac = new AbortController()
  activeAbort = ac
  const seq = ++loadSeq

  void load({
    directory,
    path,
    staged: Boolean(props.staged),
    signal: ac.signal,
    seq,
  })
}

defineExpose({ refresh })

watch(
  () => ({
    directory: props.directory,
    path: props.path,
    staged: props.staged,
  }),
  (next, _prev, onInvalidate) => {
    const directory = (next.directory || '').trim()
    const path = (next.path || '').trim()

    if (!directory || !path) {
      activeAbort?.abort()
      activeAbort = null
      loadSeq += 1
      resetState()
      return
    }

    activeAbort?.abort()
    const ac = new AbortController()
    activeAbort = ac
    const seq = ++loadSeq
    onInvalidate(() => ac.abort())

    void load({
      directory,
      path,
      staged: Boolean(next.staged),
      signal: ac.signal,
      seq,
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="git-editor-diff" :aria-busy="loading ? 'true' : 'false'">
    <div v-if="error" class="error">{{ error }}</div>

      <div v-else-if="isImageDiff" class="images">
        <div class="image-panel">
          <div class="image-title">{{ leftLabel }}</div>
          <img v-if="displayOriginal" :src="displayOriginal" class="preview" />
          <div v-else class="hint">{{ t('git.ui.diffViewer.noOriginal') }}</div>
        </div>
        <div class="image-panel">
          <div class="image-title">{{ rightLabel }}</div>
          <img v-if="displayModified" :src="displayModified" class="preview" />
          <div v-else class="hint">{{ t('git.ui.diffViewer.noModified') }}</div>
        </div>
      </div>

    <div v-else class="editor-shell">
        <div v-if="canOpenFile || canRevealFile" class="toolbar">
          <div v-if="path" class="path">{{ path }}</div>
          <div class="toolbar-actions">
            <Button v-if="canOpenFile" variant="secondary" size="sm" class="h-7" @click="openFile">{{ t('git.ui.diffViewer.actions.openFile') }}</Button>
            <Button v-if="canRevealFile" variant="secondary" size="sm" class="h-7" @click="revealFile"
              >{{ t('git.ui.diffViewer.actions.revealInFiles') }}</Button
            >
          </div>
        </div>

      <div class="editor-container">
        <MonacoDiffEditor
          :original-value="displayOriginal"
          :modified-value="displayModified"
          :path="modifiedModelPath"
          :original-path="originalModelPath"
          :use-files-theme="true"
          :wrap="true"
          :read-only="true"
          :hunk-actions="editorHunkActions"
          :hunk-actions-enabled="hasAnyHunkAction && editorHunkActions.length > 0"
          :hunk-actions-busy="isAnyActionBusy"
          :active-hunk-action-id="activeHunkAction?.hunkId || null"
          :active-hunk-action-kind="activeHunkAction?.mode || null"
          @hunk-action="handleEditorHunkAction"
        />

        <div v-if="loading" class="loading-overlay" aria-hidden="true">
          <RiLoader4Line class="h-4 w-4 animate-spin" />
          <span>{{ t('git.ui.diffViewer.loading') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.git-editor-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.editor-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.toolbar {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.path {
  color: oklch(var(--muted-foreground));
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-actions {
  align-items: center;
  display: flex;
  gap: 6px;
}

.editor-container {
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.loading-overlay {
  align-items: center;
  backdrop-filter: blur(1px);
  background: oklch(var(--background) / 0.52);
  color: oklch(var(--muted-foreground));
  display: inline-flex;
  font-size: 11px;
  gap: 6px;
  padding: 6px 10px;
  pointer-events: none;
  position: absolute;
  right: 10px;
  top: 10px;
}

.error {
  background: rgba(255, 120, 120, 0.08);
  border: 1px solid rgba(255, 120, 120, 0.26);
  border-radius: 10px;
  color: oklch(var(--destructive));
  font-size: 12px;
  padding: 10px 12px;
}

.images {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr;
  height: 100%;
  min-height: 0;
  padding: 12px;
}

.image-panel {
  align-content: start;
  background: oklch(var(--muted) / 0.15);
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 10px;
  display: grid;
  gap: 8px;
  min-height: 0;
  padding: 10px;
}

.image-title {
  color: oklch(var(--muted-foreground));
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.preview {
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 8px;
  max-height: calc(100vh - 260px);
  max-width: 100%;
  object-fit: contain;
}

.hint {
  color: oklch(var(--muted-foreground));
  font-size: 12px;
}

@media (max-width: 920px) {
  .images {
    grid-template-columns: 1fr;
  }
}
</style>
