<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { loader } from '@/lib/monaco-editor'
import type * as Monaco from 'monaco-editor'

type HunkActionKind = 'stage' | 'unstage' | 'discard'

type HunkAction = {
  id: string
  anchorLine?: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
  stageEnabled?: boolean
  unstageEnabled?: boolean
  discardEnabled?: boolean
  disabled?: boolean
}

const props = defineProps<{
  originalValue: string
  modifiedValue: string
  path?: string | null
  originalPath?: string | null
  wrap?: boolean
  readOnly?: boolean
  useFilesTheme?: boolean
  hunkActions?: HunkAction[]
  hunkActionsEnabled?: boolean
  hunkActionsBusy?: boolean
  activeHunkActionId?: string | null
  activeHunkActionKind?: HunkActionKind | null
}>()

const emit = defineEmits<{
  (e: 'hunkAction', payload: { id: string; kind: HunkActionKind }): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const ready = ref(false)
const isDark = ref(false)

const monacoRef = shallowRef<typeof import('monaco-editor') | null>(null)
const diffEditorRef = shallowRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
const originalModelRef = shallowRef<Monaco.editor.ITextModel | null>(null)
const modifiedModelRef = shallowRef<Monaco.editor.ITextModel | null>(null)

let monacoSetup: Promise<void> | null = null
let themeObserver: MutationObserver | null = null
let diffUpdateListener: Monaco.IDisposable | null = null
let hunkZoneIds: string[] = []
let pendingHunkZoneRefresh = false
let disposed = false

function extname(path: string): string {
  const base = path.split('/').pop() || path
  const idx = base.lastIndexOf('.')
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : ''
}

function languageByPath(path?: string | null): string {
  if (!path) return 'plaintext'
  const ext = extname(path)
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') return 'typescript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return 'json'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return ext
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'py') return 'python'
  if (ext === 'rs') return 'rust'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'sql' || ext === 'psql' || ext === 'plsql') return 'sql'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell'
  if (ext === 'xml') return 'xml'
  if (ext === 'ini' || ext === 'conf' || ext === 'config' || ext === 'env') return 'ini'
  return 'plaintext'
}

const language = computed(() => languageByPath(props.path))

const modelPath = computed(() => {
  const raw = String(props.path || '').trim()
  return raw || 'timeline/current'
})

const originalModelPath = computed(() => {
  const raw = String(props.originalPath || '').trim()
  return raw || `${modelPath.value}:base`
})

const originalUriPath = computed(() => `inmemory://timeline/original/${encodeURIComponent(originalModelPath.value)}`)
const modifiedUriPath = computed(() => `inmemory://timeline/modified/${encodeURIComponent(modelPath.value)}`)

const monacoTheme = computed(() => (isDark.value ? 'vs-dark' : 'vs'))

function updateThemeFromDom() {
  if (typeof document === 'undefined') return
  isDark.value = document.documentElement.classList.contains('dark')
}

function updateDiffEditorOptions() {
  if (disposed) return
  const editor = diffEditorRef.value
  if (!editor) return
  editor.updateOptions({
    readOnly: Boolean(props.readOnly),
    wordWrap: props.wrap ? 'on' : 'off',
    diffWordWrap: props.wrap ? 'on' : 'off',
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hunkRangeLabel(hunk: HunkAction): string {
  const oldStart = Math.max(0, Math.floor(hunk.oldStart || 0))
  const oldCount = Math.max(0, Math.floor(hunk.oldCount || 0))
  const newStart = Math.max(0, Math.floor(hunk.newStart || 0))
  const newCount = Math.max(0, Math.floor(hunk.newCount || 0))
  return `-${oldStart},${oldCount} +${newStart},${newCount}`
}

function resolveHunkAnchorLine(hunk: HunkAction, lineCount: number): number {
  const maxAnchor = Math.max(1, lineCount + 1)
  const directAnchor = Number(hunk.anchorLine)
  if (Number.isFinite(directAnchor) && directAnchor > 0) {
    return clamp(Math.floor(directAnchor), 1, maxAnchor)
  }
  const preferred = hunk.newCount > 0 ? hunk.newStart : hunk.newStart || hunk.oldStart || 1
  return clamp(Math.floor(preferred || 1), 1, maxAnchor)
}

function isHunkActionActive(id: string, kind: HunkActionKind): boolean {
  const activeId = String(props.activeHunkActionId || '').trim()
  if (!activeId || activeId !== id) return false
  return props.activeHunkActionKind === kind
}

function buildHunkActionRow(hunk: HunkAction): HTMLDivElement {
  const id = String(hunk.id || '').trim()
  const row = document.createElement('div')
  row.className = 'oc-monaco-hunk-zone'
  row.style.pointerEvents = 'all'

  const meta = document.createElement('div')
  meta.className = 'oc-monaco-hunk-meta'

  const range = document.createElement('span')
  range.className = 'oc-monaco-hunk-range'
  range.textContent = hunkRangeLabel(hunk)
  meta.appendChild(range)

  const counts = document.createElement('span')
  counts.className = 'oc-monaco-hunk-counts'
  const additions = Math.max(0, Math.floor(hunk.additions || 0))
  const deletions = Math.max(0, Math.floor(hunk.deletions || 0))
  const chunks: string[] = []
  if (additions > 0) chunks.push(`+${additions}`)
  if (deletions > 0) chunks.push(`-${deletions}`)
  if (chunks.length) {
    counts.textContent = chunks.join(' ')
    meta.appendChild(counts)
  }

  if (hunk.disabled) {
    const unavailable = document.createElement('span')
    unavailable.className = 'oc-monaco-hunk-unavailable'
    unavailable.textContent = 'Patch unavailable'
    meta.appendChild(unavailable)
  }

  row.appendChild(meta)

  const actions = document.createElement('div')
  actions.className = 'oc-monaco-hunk-actions'

  const addActionButton = (label: string, kind: HunkActionKind, enabled: boolean, destructive = false) => {
    if (!enabled) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'oc-monaco-hunk-button'
    if (destructive) button.classList.add('is-destructive')

    const active = isHunkActionActive(id, kind)
    if (active) button.classList.add('is-active')
    button.textContent = active ? `${label}...` : label

    button.disabled = Boolean(props.hunkActionsBusy) || Boolean(hunk.disabled)

    button.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      if (button.disabled || !id) return
      emit('hunkAction', { id, kind })
    })

    actions.appendChild(button)
  }

  addActionButton('Stage', 'stage', Boolean(hunk.stageEnabled))
  addActionButton('Unstage', 'unstage', Boolean(hunk.unstageEnabled))
  addActionButton('Discard', 'discard', Boolean(hunk.discardEnabled), true)

  row.appendChild(actions)
  return row
}

function clearHunkActionZones() {
  const diffEditor = diffEditorRef.value
  if (!diffEditor || !hunkZoneIds.length) {
    hunkZoneIds = []
    return
  }

  const modifiedEditor = diffEditor.getModifiedEditor()
  const stale = hunkZoneIds
  hunkZoneIds = []
  modifiedEditor.changeViewZones((accessor) => {
    for (const id of stale) {
      accessor.removeZone(id)
    }
  })
}

function refreshHunkActionZones() {
  if (disposed) return
  const diffEditor = diffEditorRef.value
  if (!diffEditor) return

  const modifiedEditor = diffEditor.getModifiedEditor()
  const model = modifiedEditor.getModel()
  const actions = Array.isArray(props.hunkActions) ? props.hunkActions : []
  const enabled = props.hunkActionsEnabled !== false

  if (!model || !enabled || !actions.length) {
    clearHunkActionZones()
    return
  }

  clearHunkActionZones()

  const lineCount = Math.max(1, model.getLineCount())
  const sorted = [...actions]
    .map((item) => ({
      ...item,
      id: String(item?.id || '').trim(),
    }))
    .filter((item) => Boolean(item.id))
    .sort((a, b) => resolveHunkAnchorLine(a, lineCount) - resolveHunkAnchorLine(b, lineCount))

  if (!sorted.length) return

  const nextZoneIds: string[] = []
  modifiedEditor.changeViewZones((accessor) => {
    for (const hunk of sorted) {
      const anchorLine = resolveHunkAnchorLine(hunk, lineCount)
      const domNode = buildHunkActionRow(hunk)
      const zoneId = accessor.addZone({
        afterLineNumber: clamp(anchorLine - 1, 0, lineCount),
        afterColumn: 0,
        domNode,
        heightInPx: 28,
        suppressMouseDown: true,
        showInHiddenAreas: true,
        ordinal: 0,
      })
      nextZoneIds.push(zoneId)
    }
  })

  hunkZoneIds = nextZoneIds
}

function scheduleHunkActionZoneRefresh() {
  if (pendingHunkZoneRefresh) return
  pendingHunkZoneRefresh = true
  queueMicrotask(() => {
    pendingHunkZoneRefresh = false
    refreshHunkActionZones()
  })
}

function syncModels() {
  if (disposed) return
  const monaco = monacoRef.value
  const editor = diffEditorRef.value
  if (!monaco || !editor) return

  const nextLanguage = language.value
  const nextOriginalValue = props.originalValue ?? ''
  const nextModifiedValue = props.modifiedValue ?? ''

  const originalUri = monaco.Uri.parse(originalUriPath.value)
  const modifiedUri = monaco.Uri.parse(modifiedUriPath.value)

  const previousOriginal = originalModelRef.value
  const previousModified = modifiedModelRef.value

  let originalModel = previousOriginal
  if (!originalModel || originalModel.uri.toString() !== originalUri.toString()) {
    originalModel =
      (monaco.editor.getModel(originalUri) as Monaco.editor.ITextModel | null) ??
      monaco.editor.createModel(nextOriginalValue, nextLanguage, originalUri)
  }
  if (originalModel.getLanguageId() !== nextLanguage) {
    monaco.editor.setModelLanguage(originalModel, nextLanguage)
  }
  if (originalModel.getValue() !== nextOriginalValue) {
    originalModel.setValue(nextOriginalValue)
  }

  let modifiedModel = previousModified
  if (!modifiedModel || modifiedModel.uri.toString() !== modifiedUri.toString()) {
    modifiedModel =
      (monaco.editor.getModel(modifiedUri) as Monaco.editor.ITextModel | null) ??
      monaco.editor.createModel(nextModifiedValue, nextLanguage, modifiedUri)
  }
  if (modifiedModel.getLanguageId() !== nextLanguage) {
    monaco.editor.setModelLanguage(modifiedModel, nextLanguage)
  }
  if (modifiedModel.getValue() !== nextModifiedValue) {
    modifiedModel.setValue(nextModifiedValue)
  }

  const currentDiffModel = editor.getModel()
  if (currentDiffModel?.original !== originalModel || currentDiffModel?.modified !== modifiedModel) {
    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    })
  }

  originalModelRef.value = originalModel
  modifiedModelRef.value = modifiedModel

  if (previousOriginal && previousOriginal !== originalModel) {
    previousOriginal.dispose()
  }
  if (previousModified && previousModified !== modifiedModel) {
    previousModified.dispose()
  }

  scheduleHunkActionZoneRefresh()
}

async function ensureMonacoReady() {
  if (monacoSetup) return monacoSetup
  monacoSetup = (async () => {
    const monaco = await import('monaco-editor')
    const [
      { default: editorWorker },
      { default: jsonWorker },
      { default: cssWorker },
      { default: htmlWorker },
      { default: tsWorker },
    ] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ])

    if (typeof self !== 'undefined') {
      const globalScope = self as typeof globalThis & {
        MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker }
      }
      globalScope.MonacoEnvironment = {
        getWorker(_id, label) {
          if (label === 'json') return new jsonWorker()
          if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
          if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
          if (label === 'typescript' || label === 'javascript') return new tsWorker()
          return new editorWorker()
        },
      }
    }

    loader.config({ monaco })
  })()

  return monacoSetup
}

onMounted(async () => {
  disposed = false
  await ensureMonacoReady()
  if (disposed) return
  const monaco = await import('monaco-editor')
  if (disposed) return
  monacoRef.value = monaco

  updateThemeFromDom()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    themeObserver = new MutationObserver(() => updateThemeFromDom())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }

  if (!containerRef.value || disposed) return

  diffEditorRef.value = monaco.editor.createDiffEditor(containerRef.value, {
    automaticLayout: true,
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    lineNumbers: 'on',
    minimap: { enabled: false },
    originalEditable: false,
    padding: { top: 12, bottom: 12 },
    readOnly: Boolean(props.readOnly),
    renderSideBySide: true,
    renderSideBySideInlineBreakpoint: 860,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    wordWrap: props.wrap ? 'on' : 'off',
    diffWordWrap: props.wrap ? 'on' : 'off',
    ignoreTrimWhitespace: false,
  })

  monaco.editor.setTheme(monacoTheme.value)
  syncModels()
  updateDiffEditorOptions()
  diffUpdateListener = diffEditorRef.value.onDidUpdateDiff(() => scheduleHunkActionZoneRefresh())
  scheduleHunkActionZoneRefresh()
  ready.value = true
})

onBeforeUnmount(() => {
  disposed = true
  themeObserver?.disconnect()
  themeObserver = null

  diffUpdateListener?.dispose()
  diffUpdateListener = null

  clearHunkActionZones()

  diffEditorRef.value?.setModel(null)
  diffEditorRef.value?.dispose()
  diffEditorRef.value = null

  const originalModel = originalModelRef.value
  const modifiedModel = modifiedModelRef.value
  originalModelRef.value = null
  modifiedModelRef.value = null

  queueMicrotask(() => {
    originalModel?.dispose()
    modifiedModel?.dispose()
  })
})

watch(
  monacoTheme,
  (theme) => {
    if (!monacoRef.value) return
    monacoRef.value.editor.setTheme(theme)
  },
  { immediate: true },
)

watch(
  () => [props.originalValue, props.modifiedValue, props.path, props.originalPath, language.value],
  () => {
    syncModels()
  },
)

watch(
  () => [props.hunkActionsEnabled, props.hunkActionsBusy, props.activeHunkActionId, props.activeHunkActionKind, props.hunkActions],
  () => scheduleHunkActionZoneRefresh(),
  { deep: true },
)

watch(
  () => props.wrap,
  () => updateDiffEditorOptions(),
)

watch(
  () => props.readOnly,
  () => updateDiffEditorOptions(),
)
</script>

<template>
  <div class="monaco-diff-host" :data-files-theme="props.useFilesTheme ? '1' : '0'">
    <div v-if="!ready" class="monaco-loading">Loading diff editor...</div>
    <div v-show="ready" ref="containerRef" class="monaco-diff-container" />
  </div>
</template>

<style scoped>
.monaco-diff-host {
  height: 100%;
  min-height: 0;
  width: 100%;
}

.monaco-diff-container {
  height: 100%;
  min-height: 0;
  width: 100%;
}

.monaco-loading {
  align-items: center;
  color: oklch(var(--muted-foreground));
  display: flex;
  font-size: 12px;
  height: 100%;
  justify-content: center;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .margin),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .monaco-editor-background),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .inputarea.ime-input) {
  background-color: oklch(var(--background)) !important;
}

:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .line-numbers) {
  color: oklch(var(--muted-foreground) / 0.85) !important;
}

:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .view-line),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .line-numbers),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .codelens-decoration) {
  font-family: var(--font-mono) !important;
}

:global(.oc-monaco-hunk-zone) {
  align-items: center;
  background: oklch(var(--muted) / 0.22);
  border-top: 1px solid oklch(var(--border) / 0.45);
  box-sizing: border-box;
  color: oklch(var(--muted-foreground));
  display: flex;
  font-family: var(--font-mono);
  font-size: 10px;
  gap: 16px;
  height: 28px;
  justify-content: space-between;
  line-height: 1;
  pointer-events: all !important;
  padding: 0 12px;
  position: relative;
  z-index: 3;
}

:global(.oc-monaco-hunk-zone *) {
  pointer-events: all !important;
}

:global(.monaco-diff-host .monaco-editor .view-zones),
:global(.monaco-diff-host .monaco-editor .view-zones > div) {
  pointer-events: all !important;
}

:global(.oc-monaco-hunk-meta) {
  align-items: center;
  display: inline-flex;
  gap: 12px;
  min-width: 0;
}

:global(.oc-monaco-hunk-range) {
  color: oklch(var(--foreground));
}

:global(.oc-monaco-hunk-counts) {
  color: oklch(var(--muted-foreground));
}

:global(.oc-monaco-hunk-unavailable) {
  color: oklch(var(--muted-foreground));
}

:global(.oc-monaco-hunk-actions) {
  align-items: center;
  display: inline-flex;
  gap: 8px;
}

:global(.oc-monaco-hunk-button) {
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: oklch(var(--foreground));
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  text-decoration: none;
  text-decoration-color: oklch(var(--border));
  text-underline-offset: 2px;
}

:global(.oc-monaco-hunk-button:hover:not(:disabled)) {
  background: oklch(var(--muted));
  text-decoration-color: currentColor;
}

:global(.oc-monaco-hunk-button.is-destructive:hover:not(:disabled)) {
  color: oklch(var(--destructive));
}

:global(.oc-monaco-hunk-button:disabled) {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(.oc-monaco-hunk-button.is-active) {
  font-weight: 600;
}
</style>
