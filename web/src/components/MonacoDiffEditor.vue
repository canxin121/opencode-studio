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

const props = withDefaults(
  defineProps<{
    originalValue: string
    modifiedValue: string
    path?: string | null
    originalPath?: string | null
    modelId?: string | null
    originalModelId?: string | null
    languagePath?: string | null
    wrap?: boolean
    readOnly?: boolean
    useFilesTheme?: boolean
    hunkActions?: HunkAction[]
    hunkActionsEnabled?: boolean
    hunkActionsBusy?: boolean
    activeHunkActionId?: string | null
    activeHunkActionKind?: HunkActionKind | null
    autoRevealFirstChange?: boolean
    initialTopLine?: number | null
    originalStartLine?: number | null
    modifiedStartLine?: number | null
    originalLineNumbers?: Array<number | null> | null
    modifiedLineNumbers?: Array<number | null> | null
  }>(),
  {
    autoRevealFirstChange: true,
    hunkActionsEnabled: true,
  },
)

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
let modifiedLayoutListener: Monaco.IDisposable | null = null
let hunkZoneIds: string[] = []
let pendingHunkZoneRefresh = false
let pendingFirstChangeReveal = true
let revealRetryFrame: number | null = null
let lastRevealModelKey = ''
let lastRevealContentKey = ''
let lastLineNumberOptionsKey = ''
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

const language = computed(() => languageByPath(props.languagePath || props.path))

const modelPath = computed(() => {
  const raw = String(props.modelId || props.path || '').trim()
  return raw || 'timeline/current'
})

const originalModelPath = computed(() => {
  const raw = String(props.originalModelId || props.originalPath || '').trim()
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
  const wrapMode = props.wrap ? 'on' : 'off'
  editor.updateOptions({
    readOnly: Boolean(props.readOnly),
    wordWrap: wrapMode,
    diffWordWrap: wrapMode,
  })

  // Monaco's diff-level wrapping can diverge between panes in some cases.
  // Apply wrap mode directly to both sub-editors to keep behavior consistent.
  editor.getOriginalEditor().updateOptions({
    wordWrap: wrapMode,
  })
  editor.getModifiedEditor().updateOptions({
    wordWrap: wrapMode,
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
  const directAnchor = Number(hunk.anchorLine)
  if (Number.isFinite(directAnchor) && directAnchor > 0) {
    return resolveModifiedModelLineFromDisplayLine(Math.floor(directAnchor), lineCount)
  }
  const preferred = hunk.newCount > 0 ? hunk.newStart : hunk.newStart || hunk.oldStart || 1
  return resolveModifiedModelLineFromDisplayLine(Math.floor(preferred || 1), lineCount)
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
  if (additions > 0) {
    const addCount = document.createElement('span')
    addCount.className = 'oc-monaco-hunk-count oc-monaco-hunk-count--add'
    addCount.textContent = `+${additions}`
    counts.appendChild(addCount)
  }
  if (deletions > 0) {
    const delCount = document.createElement('span')
    delCount.className = 'oc-monaco-hunk-count oc-monaco-hunk-count--del'
    delCount.textContent = `-${deletions}`
    counts.appendChild(delCount)
  }
  if (counts.childNodes.length) {
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
        heightInPx: 24,
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

function normalizePositiveInteger(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next) || next <= 0) return null
  return Math.floor(next)
}

function normalizeLineNumberMap(
  value: Array<number | null> | null | undefined,
  lineCount: number,
): Array<number | null> | null {
  if (!Array.isArray(value) || lineCount <= 0) return null
  const normalized: Array<number | null> = new Array(lineCount).fill(null)
  let hasMappedLine = false
  const limit = Math.min(lineCount, value.length)
  for (let idx = 0; idx < limit; idx += 1) {
    const mapped = normalizePositiveInteger(value[idx])
    if (mapped === null) continue
    normalized[idx] = mapped
    hasMappedLine = true
  }
  return hasMappedLine ? normalized : null
}

function getRequestedInitialTopLine(): number | null {
  return normalizePositiveInteger(props.initialTopLine)
}

function getOriginalStartLine(): number | null {
  return normalizePositiveInteger(props.originalStartLine)
}

function getModifiedStartLine(): number | null {
  return normalizePositiveInteger(props.modifiedStartLine)
}

function getOriginalLineNumberMap(lineCount: number): Array<number | null> | null {
  return normalizeLineNumberMap(props.originalLineNumbers || null, lineCount)
}

function getModifiedLineNumberMap(lineCount: number): Array<number | null> | null {
  return normalizeLineNumberMap(props.modifiedLineNumbers || null, lineCount)
}

function resolveModelLineFromDisplayLine(
  displayLine: number,
  lineCount: number,
  lineMap: Array<number | null> | null,
  startLine: number | null,
): number {
  const target = normalizePositiveInteger(displayLine) || 1

  if (lineMap) {
    let fallback: number | null = null
    for (let index = 0; index < Math.min(lineMap.length, lineCount); index += 1) {
      const mapped = normalizePositiveInteger(lineMap[index])
      if (mapped === null) continue
      const modelLine = index + 1
      if (mapped >= target) return modelLine
      fallback = modelLine
    }
    if (fallback !== null) return fallback
  }

  if (startLine !== null) {
    return clamp(target - startLine + 1, 1, lineCount)
  }

  return clamp(target, 1, lineCount)
}

function resolveModifiedModelLineFromDisplayLine(displayLine: number, lineCount: number): number {
  return resolveModelLineFromDisplayLine(
    displayLine,
    lineCount,
    getModifiedLineNumberMap(lineCount),
    getModifiedStartLine(),
  )
}

function resolveExplicitInitialTopLine(lineCount: number): number | null {
  const requested = getRequestedInitialTopLine()
  if (requested === null) return null
  return resolveModifiedModelLineFromDisplayLine(requested, lineCount)
}

function resolveMaxDisplayLineNumber(
  lineCount: number,
  lineMap: Array<number | null> | null,
  startLine: number | null,
): number {
  let maxLine = lineCount
  if (lineMap) {
    for (const entry of lineMap) {
      const mapped = normalizePositiveInteger(entry)
      if (mapped !== null && mapped > maxLine) maxLine = mapped
    }
    return Math.max(1, maxLine)
  }

  if (startLine !== null) {
    return Math.max(1, startLine + Math.max(0, lineCount - 1))
  }

  return Math.max(1, maxLine)
}

function computeLineNumberDigits(
  lineCount: number,
  lineMap: Array<number | null> | null,
  startLine: number | null,
): number {
  return String(resolveMaxDisplayLineNumber(lineCount, lineMap, startLine)).length
}

function computeLineNumberMinChars(
  lineCount: number,
  lineMap: Array<number | null> | null,
  startLine: number | null,
  extraChars = 0,
): number {
  const digits = computeLineNumberDigits(lineCount, lineMap, startLine)
  return clamp(digits + Math.max(0, Math.floor(extraChars)), 1, 12)
}

function computeInlineGapChars(originalDigits: number, modifiedDigits: number): number {
  const maxDigits = Math.max(1, originalDigits, modifiedDigits)
  return clamp(Math.ceil(maxDigits / 6), 1, 3)
}

function isInlineDiffMode(): boolean {
  const diffEditor = diffEditorRef.value
  if (!diffEditor) return false
  const container = diffEditor.getContainerDomNode?.()
  if (!container) return false
  return !container.classList.contains('side-by-side')
}

function setInlineGapCssVar(gapChars: number) {
  const diffEditor = diffEditorRef.value
  const container = diffEditor?.getContainerDomNode?.()
  if (!container) return
  container.style.setProperty('--oc-inline-line-gap-ch', `${Math.max(0, Math.floor(gapChars))}ch`)
}

function applyEditorLineNumberOptions(
  editor: Monaco.editor.ICodeEditor,
  lineMap: Array<number | null> | null,
  startLine: number | null,
  trailingGapChars = 0,
) {
  const model = editor.getModel()
  if (!model) return
  const lineCount = Math.max(1, model.getLineCount())

  if (!lineMap && startLine === null && trailingGapChars <= 0) {
    editor.updateOptions({
      lineNumbers: 'on',
      lineNumbersMinChars: 1,
    })
    return
  }

  const minChars = computeLineNumberMinChars(lineCount, lineMap, startLine, trailingGapChars)
  editor.updateOptions({
    lineNumbers: (lineNumber: number) => {
      const modelLine = clamp(Math.floor(lineNumber || 1), 1, lineCount)
      if (lineMap) {
        const mapped = normalizePositiveInteger(lineMap[modelLine - 1])
        return mapped !== null ? String(mapped) : ''
      }
      if (startLine !== null) {
        return String(startLine + modelLine - 1)
      }
      return String(modelLine)
    },
    lineNumbersMinChars: minChars,
  })
}

function updateLineNumberOptions() {
  if (disposed) return
  const diffEditor = diffEditorRef.value
  if (!diffEditor) return

  const originalEditor = diffEditor.getOriginalEditor()
  const modifiedEditor = diffEditor.getModifiedEditor()

  const originalLineCount = Math.max(1, originalEditor.getModel()?.getLineCount() || 1)
  const modifiedLineCount = Math.max(1, modifiedEditor.getModel()?.getLineCount() || 1)

  const originalLineMap = getOriginalLineNumberMap(originalLineCount)
  const modifiedLineMap = getModifiedLineNumberMap(modifiedLineCount)
  const originalStartLine = getOriginalStartLine()
  const modifiedStartLine = getModifiedStartLine()

  const inlineMode = isInlineDiffMode()
  const originalDigits = computeLineNumberDigits(originalLineCount, originalLineMap, originalStartLine)
  const modifiedDigits = computeLineNumberDigits(modifiedLineCount, modifiedLineMap, modifiedStartLine)
  const inlineGapChars = inlineMode ? computeInlineGapChars(originalDigits, modifiedDigits) : 0

  const lineNumberKey = `${inlineMode ? 'inline' : 'side'}:${inlineGapChars}:${originalDigits}:${modifiedDigits}:${lineMapSignature(originalLineMap)}:${lineMapSignature(modifiedLineMap)}:${originalStartLine ?? 'n'}:${modifiedStartLine ?? 'n'}`
  if (lineNumberKey === lastLineNumberOptionsKey) return
  lastLineNumberOptionsKey = lineNumberKey

  setInlineGapCssVar(inlineGapChars)
  applyEditorLineNumberOptions(originalEditor, originalLineMap, originalStartLine, inlineGapChars)
  applyEditorLineNumberOptions(modifiedEditor, modifiedLineMap, modifiedStartLine)
}

function revealModifiedLineAtTop(modifiedEditor: Monaco.editor.ICodeEditor, targetLine: number) {
  const scrollTop = Math.max(0, modifiedEditor.getTopForLineNumber(targetLine))
  const immediate = monacoRef.value?.editor.ScrollType.Immediate
  if (typeof immediate === 'number') {
    modifiedEditor.setScrollTop(scrollTop, immediate)
    return
  }
  modifiedEditor.setScrollTop(scrollTop)
}

function maybeRevealFirstDiffChange() {
  if (disposed) return
  if (!pendingFirstChangeReveal) return

  const diffEditor = diffEditorRef.value
  if (!diffEditor) return

  const modifiedEditor = diffEditor.getModifiedEditor()
  const model = modifiedEditor.getModel()
  if (!model) return

  const lineCount = Math.max(1, model.getLineCount())
  const explicitTopLine = resolveExplicitInitialTopLine(lineCount)

  const layout = modifiedEditor.getLayoutInfo()
  if (layout.width <= 0 || layout.height <= 0) {
    if (revealRetryFrame === null && typeof requestAnimationFrame === 'function') {
      revealRetryFrame = requestAnimationFrame(() => {
        revealRetryFrame = null
        maybeRevealFirstDiffChange()
      })
    }
    return
  }

  if (explicitTopLine !== null) {
    pendingFirstChangeReveal = false
    if (revealRetryFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(revealRetryFrame)
    }
    revealRetryFrame = null
    revealModifiedLineAtTop(modifiedEditor, explicitTopLine)
    return
  }

  if (props.autoRevealFirstChange === false) {
    pendingFirstChangeReveal = false
    if (revealRetryFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(revealRetryFrame)
    }
    revealRetryFrame = null
    return
  }

  const lineChanges = diffEditor.getLineChanges()
  if (lineChanges === null) {
    return
  }

  if (!lineChanges.length) {
    pendingFirstChangeReveal = false
    if (revealRetryFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(revealRetryFrame)
    }
    revealRetryFrame = null
    return
  }

  const first = lineChanges[0]

  pendingFirstChangeReveal = false
  if (revealRetryFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(revealRetryFrame)
  }
  revealRetryFrame = null

  const candidates = [
    first.modifiedStartLineNumber,
    first.modifiedEndLineNumber,
    first.originalStartLineNumber,
    first.originalEndLineNumber,
  ]
  const firstChangedLine = candidates.find((line) => Number.isFinite(line) && line > 0) ?? 1
  const targetLine = clamp(Math.floor(firstChangedLine), 1, lineCount)
  const revealLine = clamp(targetLine - 2, 1, lineCount)
  revealModifiedLineAtTop(modifiedEditor, revealLine)
}

function lineMapSignature(value: Array<number | null> | null | undefined): string {
  if (!Array.isArray(value) || !value.length) return 'none'
  let first = 'x'
  let last = 'x'
  let count = 0
  for (const raw of value) {
    const mapped = normalizePositiveInteger(raw)
    if (mapped === null) continue
    if (count === 0) first = String(mapped)
    last = String(mapped)
    count += 1
  }
  return `${value.length}:${count}:${first}:${last}`
}

function buildRevealContentKey(): string {
  const original = props.originalValue ?? ''
  const modified = props.modifiedValue ?? ''
  const revealMode = props.autoRevealFirstChange === false ? 'off' : 'on'
  const explicitTop = getRequestedInitialTopLine()
  const originalStartLine = getOriginalStartLine()
  const modifiedStartLine = getModifiedStartLine()
  const originalLineMapSig = lineMapSignature(props.originalLineNumbers || null)
  const modifiedLineMapSig = lineMapSignature(props.modifiedLineNumbers || null)
  return `${revealMode}:${explicitTop ?? 'none'}:${originalStartLine ?? 'none'}:${modifiedStartLine ?? 'none'}:${originalLineMapSig}:${modifiedLineMapSig}:${original.length}:${modified.length}:${original.slice(0, 160)}:${original.slice(-160)}:${modified.slice(0, 160)}:${modified.slice(-160)}`
}

function requestFirstChangeReveal() {
  if (props.autoRevealFirstChange === false && getRequestedInitialTopLine() === null) return
  pendingFirstChangeReveal = true
  queueMicrotask(() => maybeRevealFirstDiffChange())
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

  updateLineNumberOptions()
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
    lineDecorationsWidth: 10,
    lineNumbers: 'on',
    lineNumbersMinChars: 1,
    minimap: { enabled: false },
    originalEditable: false,
    padding: { top: 12, bottom: 12 },
    readOnly: Boolean(props.readOnly),
    renderSideBySide: true,
    renderSideBySideInlineBreakpoint: 860,
    renderOverviewRuler: false,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    wordWrap: props.wrap ? 'on' : 'off',
    diffWordWrap: props.wrap ? 'on' : 'off',
    ignoreTrimWhitespace: false,
  })

  monaco.editor.setTheme(monacoTheme.value)
  syncModels()
  updateDiffEditorOptions()
  modifiedLayoutListener = diffEditorRef.value.getModifiedEditor().onDidLayoutChange(() => {
    updateLineNumberOptions()
    maybeRevealFirstDiffChange()
  })
  diffUpdateListener = diffEditorRef.value.onDidUpdateDiff(() => {
    scheduleHunkActionZoneRefresh()
    maybeRevealFirstDiffChange()
  })
  scheduleHunkActionZoneRefresh()
  maybeRevealFirstDiffChange()
  ready.value = true
})

onBeforeUnmount(() => {
  disposed = true
  themeObserver?.disconnect()
  themeObserver = null

  diffUpdateListener?.dispose()
  diffUpdateListener = null

  modifiedLayoutListener?.dispose()
  modifiedLayoutListener = null

  if (revealRetryFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(revealRetryFrame)
  }
  revealRetryFrame = null

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
  () => [
    props.originalValue,
    props.modifiedValue,
    props.path,
    props.originalPath,
    props.modelId,
    props.originalModelId,
    props.languagePath,
    language.value,
  ],
  () => {
    syncModels()
  },
)

watch(
  () => `${originalUriPath.value}::${modifiedUriPath.value}`,
  (nextKey) => {
    if (!nextKey || nextKey === lastRevealModelKey) return
    lastRevealModelKey = nextKey
    requestFirstChangeReveal()
  },
  { immediate: true },
)

watch(
  () => [
    props.originalValue,
    props.modifiedValue,
    props.autoRevealFirstChange,
    props.initialTopLine,
    props.originalStartLine,
    props.modifiedStartLine,
    props.originalLineNumbers,
    props.modifiedLineNumbers,
  ],
  () => {
    const nextKey = buildRevealContentKey()
    if (nextKey === lastRevealContentKey) return
    lastRevealContentKey = nextKey
    requestFirstChangeReveal()
  },
  { immediate: true },
)

watch(
  () => [
    props.hunkActionsEnabled,
    props.hunkActionsBusy,
    props.activeHunkActionId,
    props.activeHunkActionKind,
    props.hunkActions,
  ],
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

watch(
  () => [props.originalStartLine, props.modifiedStartLine, props.originalLineNumbers, props.modifiedLineNumbers],
  () => updateLineNumberOptions(),
  { deep: true },
)
</script>

<template>
  <div class="monaco-diff-host" data-oc-text-editor-root="true" :data-files-theme="props.useFilesTheme ? '1' : '0'">
    <div ref="containerRef" class="monaco-diff-container" :class="{ 'is-hidden': !ready }" />
    <div v-if="!ready" class="monaco-loading">Loading diff editor...</div>
  </div>
</template>

<style scoped>
.monaco-diff-host {
  height: 100%;
  min-height: 0;
  position: relative;
  width: 100%;
}

.monaco-diff-container {
  height: 100%;
  min-height: 0;
  width: 100%;
}

.monaco-diff-container.is-hidden {
  visibility: hidden;
}

.monaco-loading {
  align-items: center;
  color: oklch(var(--muted-foreground));
  display: flex;
  font-size: 12px;
  inset: 0;
  justify-content: center;
  letter-spacing: 0.08em;
  pointer-events: none;
  position: absolute;
  text-transform: uppercase;
}

:global(:root.mobile-pointer .monaco-diff-host .monaco-editor .lines-content),
:global(:root.mobile-pointer .monaco-diff-host .monaco-editor .view-line),
:global(:root.mobile-pointer .monaco-diff-host .monaco-editor .view-lines) {
  -webkit-touch-callout: default;
  -webkit-user-select: text !important;
  user-select: text !important;
}

:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .margin),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .monaco-editor-background),
:global(.monaco-diff-host[data-files-theme='1'] .monaco-editor .inputarea.ime-input) {
  background-color: oklch(var(--background)) !important;
}

:global(.monaco-diff-host .monaco-editor .sticky-widget .sticky-widget-line-numbers) {
  background-color: var(--vscode-editorStickyScroll-background) !important;
}

:global(.monaco-diff-host .monaco-editor .sticky-widget.peek .sticky-widget-line-numbers) {
  background-color: var(--vscode-peekViewEditorStickyScroll-background) !important;
}

:global(.monaco-diff-host .monaco-editor .sticky-widget .sticky-line-number),
:global(.monaco-diff-host .monaco-editor .sticky-widget .sticky-line-number-inner) {
  background-color: inherit !important;
}

:global(.monaco-diff-host .monaco-editor .sticky-widget .sticky-line-number) {
  align-items: center;
  display: inline-flex;
  height: 100%;
}

:global(.monaco-diff-host .monaco-editor .sticky-widget .sticky-line-number-inner) {
  align-items: center;
  display: inline-flex;
  height: 100%;
}

:global(.monaco-diff-host .monaco-diff-editor:not(.side-by-side) .editor.original .margin-view-overlays .line-numbers) {
  padding-right: var(--oc-inline-line-gap-ch, 1ch);
}

:global(
  .monaco-diff-host .monaco-diff-editor:not(.side-by-side) .editor.original .sticky-widget .sticky-line-number-inner
) {
  padding-right: var(--oc-inline-line-gap-ch, 1ch) !important;
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
  gap: 12px;
  height: 24px;
  justify-content: space-between;
  line-height: 1.2;
  pointer-events: all !important;
  padding: 0 10px;
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
  gap: 10px;
  height: 100%;
  min-width: 0;
}

:global(.oc-monaco-hunk-range) {
  color: oklch(var(--foreground));
}

:global(.oc-monaco-hunk-counts) {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

:global(.oc-monaco-hunk-count) {
  font-weight: 600;
}

:global(.oc-monaco-hunk-count--add) {
  color: oklch(0.62 0.17 145);
}

:global(.oc-monaco-hunk-count--del) {
  color: oklch(0.56 0.2 25);
}

:global(.dark .oc-monaco-hunk-count--add) {
  color: oklch(0.74 0.13 145);
}

:global(.dark .oc-monaco-hunk-count--del) {
  color: oklch(0.68 0.16 25);
}

:global(.monaco-diff-host .monaco-editor .insert-sign),
:global(.monaco-diff-host .monaco-diff-editor .insert-sign) {
  color: oklch(0.62 0.17 145) !important;
  opacity: 1 !important;
}

:global(.monaco-diff-host .monaco-editor .delete-sign),
:global(.monaco-diff-host .monaco-diff-editor .delete-sign) {
  color: oklch(0.56 0.2 25) !important;
  opacity: 1 !important;
}

:global(.oc-monaco-hunk-unavailable) {
  color: oklch(var(--muted-foreground));
}

:global(.oc-monaco-hunk-actions) {
  align-items: center;
  display: inline-flex;
  height: 100%;
  gap: 8px;
}

:global(.oc-monaco-hunk-button) {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: oklch(var(--foreground));
  cursor: pointer;
  display: inline-flex;
  font-family: var(--font-mono);
  font-size: 10px;
  height: 18px;
  justify-content: center;
  line-height: 1;
  padding: 0 6px;
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
