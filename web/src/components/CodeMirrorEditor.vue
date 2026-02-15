<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { VueMonacoEditor, loader } from '@/lib/monaco-editor'
import type * as Monaco from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  path?: string | null
  wrap?: boolean
  readOnly?: boolean
  useFilesTheme?: boolean
  inlineDecorations?: Array<{ line: number; text: string; className?: string; hover?: string }>
  inlineDecorationsEnabled?: boolean
  gitLineDecorations?: Array<{ line: number; type: 'add' | 'del' | 'mod'; hover?: string }>
  gitLineDecorationsEnabled?: boolean
  lineMarkers?: Array<{
    line: number
    className?: string
    gutterClassName?: string
    glyphClassName?: string
    hover?: string
  }>
  lineMarkersEnabled?: boolean
  diffZones?: Array<{ line: number; content: string[] }>
  diffZonesEnabled?: boolean
  diffDecorations?: Array<{ line: number; className: string }>
  diffDecorationsEnabled?: boolean
  codeLensActions?: Array<{ line: number; title: string; onClick: () => void }>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'user-edit'): void
  (
    e: 'editor-scroll',
    payload: {
      visibleStartLine: number
      visibleEndLine: number
    },
  ): void
}>()

const editorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRef = shallowRef<typeof import('monaco-editor') | null>(null)
const ready = ref(false)
const isDark = ref(false)

let contentListener: Monaco.IDisposable | null = null
let scrollListener: Monaco.IDisposable | null = null
let monacoSetup: Promise<void> | null = null
let themeObserver: MutationObserver | null = null

let inlineDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null
let gitLineDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null
let lineMarkerDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null
let diffDecorationCollection: Monaco.editor.IEditorDecorationsCollection | null = null
let diffZoneIds: string[] = []
let codeLensKey: string | null = null

const INLINE_DECORATION_LIMIT = 8000
const GIT_DECORATION_LIMIT = 4000

type CodeLensEntry = { line: number; title: string; actionKey: string }

type CodeLensRegistryState = {
  registered: boolean
  provider: Monaco.languages.CodeLensProvider | null
  emitter: Monaco.Emitter<Monaco.languages.CodeLensProvider> | null
  byModel: Map<string, CodeLensEntry[]>
  actionsByKey: Map<string, () => void>
  actionKeysByModel: Map<string, Set<string>>
  commandRegistered: boolean
  commandDisposable: Monaco.IDisposable | null
  counter: number
}

type GlobalCodeLensState = typeof globalThis & {
  __ocCodeLensRegistry__?: CodeLensRegistryState
}

const CODELENS_COMMAND_ID = 'oc-codelens-action'

function getCodeLensRegistry(): CodeLensRegistryState {
  const globalScope = globalThis as GlobalCodeLensState
  if (!globalScope.__ocCodeLensRegistry__) {
    globalScope.__ocCodeLensRegistry__ = {
      registered: false,
      provider: null,
      emitter: null,
      byModel: new Map<string, CodeLensEntry[]>(),
      actionsByKey: new Map<string, () => void>(),
      actionKeysByModel: new Map<string, Set<string>>(),
      commandRegistered: false,
      commandDisposable: null,
      counter: 0,
    }
  }
  return globalScope.__ocCodeLensRegistry__
}

function ensureCodeLensProvider(monaco: typeof import('monaco-editor')): CodeLensRegistryState {
  const registry = getCodeLensRegistry()
  if (registry.registered) return registry
  registry.registered = true
  registry.emitter = new monaco.Emitter<Monaco.languages.CodeLensProvider>()
  registry.provider = {
    onDidChange: registry.emitter.event,
    provideCodeLenses(model) {
      const key = model.uri.toString()
      const entries = registry.byModel.get(key) || []
      return {
        lenses: entries.map((entry) => ({
          range: new monaco.Range(Math.max(1, entry.line), 1, Math.max(1, entry.line), 1),
          command: {
            id: CODELENS_COMMAND_ID,
            title: entry.title,
            arguments: [entry.actionKey],
          },
        })),
        dispose: () => {},
      }
    },
    resolveCodeLens(_model, lens) {
      return lens
    },
  }
  monaco.languages.registerCodeLensProvider('*', registry.provider)
  return registry
}

function ensureCodeLensCommand(monaco: typeof import('monaco-editor')): CodeLensRegistryState {
  const registry = getCodeLensRegistry()
  if (registry.commandRegistered) return registry
  registry.commandRegistered = true
  registry.commandDisposable = monaco.editor.registerCommand(
    CODELENS_COMMAND_ID,
    (_accessor: unknown, actionKey?: string) => {
      const key = String(actionKey || '').trim()
      if (!key) return
      const fn = registry.actionsByKey.get(key)
      fn?.()
    },
  )
  return registry
}

function clearModelCodeLenses(modelKey: string) {
  const key = String(modelKey || '').trim()
  if (!key) return
  const registry = getCodeLensRegistry()
  registry.byModel.delete(key)
  const keys = registry.actionKeysByModel.get(key)
  if (keys) {
    for (const actionKey of keys) {
      registry.actionsByKey.delete(actionKey)
    }
  }
  registry.actionKeysByModel.delete(key)
}

function updateCodeLens() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const model = editor.getModel()
  if (!model) return
  const key = model.uri.toString()
  const registry = getCodeLensRegistry()

  if (codeLensKey && codeLensKey !== key) {
    clearModelCodeLenses(codeLensKey)
  }
  codeLensKey = key

  const actions = props.codeLensActions ?? []
  if (!actions.length) {
    clearModelCodeLenses(key)
    if (registry.provider) registry.emitter?.fire(registry.provider)
    return
  }

  ensureCodeLensProvider(monaco)
  ensureCodeLensCommand(monaco)

  clearModelCodeLenses(key)

  const actionKeys = new Set<string>()
  const entries: CodeLensEntry[] = actions.map((action) => {
    const actionKey = `${key}::${++registry.counter}`
    actionKeys.add(actionKey)
    registry.actionsByKey.set(actionKey, action.onClick)
    return { line: action.line, title: action.title, actionKey }
  })

  registry.byModel.set(key, entries)
  registry.actionKeysByModel.set(key, actionKeys)
  if (registry.provider) registry.emitter?.fire(registry.provider)
}

function formatInlineText(text: string): string {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77)}...`
}

function normalizeInlineClassName(value?: string): string {
  const fallback = 'oc-inline-blame'
  const cleaned = String(value || '').trim()
  return cleaned || fallback
}

function updateInlineDecorations() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const model = editor.getModel()
  if (!model) return

  if (!props.inlineDecorationsEnabled || !props.inlineDecorations?.length) {
    inlineDecorationCollection?.set([])
    return
  }

  if (!inlineDecorationCollection) {
    inlineDecorationCollection = editor.createDecorationsCollection()
  }

  const lineCount = model.getLineCount()
  const entries = props.inlineDecorations.slice(0, INLINE_DECORATION_LIMIT)
  const decorations = entries
    .map((item) => {
      const line = Math.max(1, Math.min(lineCount, Math.floor(item.line || 0)))
      const text = formatInlineText(item.text)
      if (!text) return null
      const inlineClassName = normalizeInlineClassName(item.className)
      const hoverMessage = item.hover?.trim()

      const maxCol = model.getLineMaxColumn(line)

      return {
        range: new monaco.Range(line, maxCol, line, maxCol),
        options: {
          after: {
            content: `    ${text}`,
            inlineClassName,
          },
          hoverMessage: hoverMessage ? ({ value: hoverMessage } as Monaco.IMarkdownString) : undefined,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        } as Monaco.editor.IModelDecorationOptions,
      }
    })
    .filter(Boolean) as Monaco.editor.IModelDeltaDecoration[]

  inlineDecorationCollection.set(decorations)
}

function normalizeGitType(value: string): 'add' | 'del' | 'mod' {
  if (value === 'del') return 'del'
  if (value === 'mod') return 'mod'
  return 'add'
}

function updateGitLineDecorations() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const model = editor.getModel()
  if (!model) return

  if (!props.gitLineDecorationsEnabled || !props.gitLineDecorations?.length) {
    gitLineDecorationCollection?.set([])
    return
  }

  if (!gitLineDecorationCollection) {
    gitLineDecorationCollection = editor.createDecorationsCollection()
  }

  const lineCount = model.getLineCount()
  const entries = props.gitLineDecorations.slice(0, GIT_DECORATION_LIMIT)
  const decorations = entries.map((item) => {
    const line = Math.max(1, Math.min(lineCount, Math.floor(item.line || 0)))
    const type = normalizeGitType(item.type)
    const hoverMessage = item.hover?.trim()
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: `oc-git-line--${type}`,
        linesDecorationsClassName: `oc-git-gutter-marker oc-git-gutter-marker--${type}`,
        hoverMessage: hoverMessage ? ({ value: hoverMessage } as Monaco.IMarkdownString) : undefined,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      } as Monaco.editor.IModelDecorationOptions,
    }
  })

  gitLineDecorationCollection.set(decorations)
}

function updateLineMarkers() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const model = editor.getModel()
  if (!model) return

  if (!props.lineMarkersEnabled || !props.lineMarkers?.length) {
    lineMarkerDecorationCollection?.set([])
    return
  }

  if (!lineMarkerDecorationCollection) {
    lineMarkerDecorationCollection = editor.createDecorationsCollection()
  }

  const lineCount = model.getLineCount()
  const entries = props.lineMarkers.slice(0, 5000)
  const decorations = entries.map((item) => {
    const line = Math.max(1, Math.min(lineCount, Math.floor(item.line || 0)))
    const hoverMessage = item.hover?.trim()
    const className = (item.className || '').trim()
    const gutterClassName = (item.gutterClassName || '').trim()
    const glyphClassName = (item.glyphClassName || '').trim()
    const hasGutterMarker = Boolean(gutterClassName)
    const hasGlyphMarker = Boolean(glyphClassName)

    const md = hoverMessage ? ({ value: hoverMessage } as Monaco.IMarkdownString) : undefined

    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: className || undefined,
        linesDecorationsClassName: hasGutterMarker ? gutterClassName : undefined,
        linesDecorationsTooltip: hasGutterMarker && hoverMessage ? hoverMessage : undefined,
        glyphMarginClassName: hasGlyphMarker ? glyphClassName : undefined,
        // Monaco defaults to a single glyph margin lane in many setups.
        // Using Center avoids laneIndex = -1 (which renders off-screen).
        glyphMargin: hasGlyphMarker ? { position: monaco.editor.GlyphMarginLane.Center } : undefined,
        glyphMarginHoverMessage: hasGlyphMarker && md ? md : undefined,
        hoverMessage: !hasGlyphMarker && !hasGutterMarker && md ? md : undefined,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      } as Monaco.editor.IModelDecorationOptions,
    }
  })

  lineMarkerDecorationCollection.set(decorations)
}

function updateDiffZones() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  editor.changeViewZones((changeAccessor) => {
    for (const id of diffZoneIds) {
      changeAccessor.removeZone(id)
    }
    diffZoneIds = []

    if (!props.diffZonesEnabled || !props.diffZones?.length) return

    for (const zone of props.diffZones) {
      const domNode = document.createElement('div')
      domNode.className = 'oc-diff-zone'
      for (const line of zone.content) {
        const lineEl = document.createElement('div')
        lineEl.textContent = line
        lineEl.className = 'oc-diff-zone-line'
        domNode.appendChild(lineEl)
      }

      const id = changeAccessor.addZone({
        afterLineNumber: zone.line,
        heightInLines: zone.content.length,
        domNode: domNode,
      })
      diffZoneIds.push(id)
    }
  })
}

function updateDiffDecorations() {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const model = editor.getModel()
  if (!model) return

  if (!props.diffDecorationsEnabled || !props.diffDecorations?.length) {
    diffDecorationCollection?.set([])
    return
  }

  if (!diffDecorationCollection) {
    diffDecorationCollection = editor.createDecorationsCollection()
  }

  const decorations = props.diffDecorations.map((item) => ({
    range: new monaco.Range(item.line, 1, item.line, 1),
    options: {
      isWholeLine: true,
      className: item.className,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    } as Monaco.editor.IModelDecorationOptions,
  }))

  diffDecorationCollection.set(decorations)
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

const value = computed({
  get: () => props.modelValue ?? '',
  set: (next) => emit('update:modelValue', next),
})

const language = computed(() => languageByPath(props.path))

const modelPath = computed(() => {
  const raw = (props.path || '').trim()
  return raw ? raw : 'inmemory://model/1'
})

const resolvedFontFamily = computed(() => (props.useFilesTheme ? 'var(--font-mono)' : 'var(--mono-font)'))

const glyphMarginEnabled = computed(() => {
  if (!props.lineMarkersEnabled || !props.lineMarkers?.length) return false
  return props.lineMarkers.some((m) => Boolean((m.glyphClassName || '').trim()))
})

const editorOptions = computed<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
  automaticLayout: true,
  fontFamily: resolvedFontFamily.value,
  fontSize: 13,
  // Keep glyph margin enabled in the file viewer so blame markers
  // render reliably even if markers arrive after mount.
  glyphMargin: Boolean(props.useFilesTheme) || glyphMarginEnabled.value,
  lineDecorationsWidth: 12,
  lineNumbers: 'on',
  minimap: { enabled: false },
  padding: { top: 12, bottom: 12 },
  readOnly: Boolean(props.readOnly),
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  wordWrap: props.wrap ? 'on' : 'off',
}))

const monacoTheme = computed(() => (isDark.value ? 'vs-dark' : 'vs'))

function updateThemeFromDom() {
  if (typeof document === 'undefined') return
  isDark.value = document.documentElement.classList.contains('dark')
}

function handleMount(
  editorInstance: Monaco.editor.IStandaloneCodeEditor,
  monacoInstance: typeof import('monaco-editor'),
) {
  editorRef.value = editorInstance
  monacoRef.value = monacoInstance

  monacoInstance.editor.setTheme(monacoTheme.value)

  contentListener?.dispose()
  contentListener = editorInstance.onDidChangeModelContent((event: Monaco.editor.IModelContentChangedEvent) => {
    if (event.isFlush) return
    emit('user-edit')
  })

  scrollListener?.dispose()
  const emitScroll = () => {
    const visibleRanges = editorInstance.getVisibleRanges()
    let visibleStartLine = 1
    let visibleEndLine = 1
    if (visibleRanges.length) {
      let start = Number.POSITIVE_INFINITY
      let end = 0
      for (const r of visibleRanges) {
        start = Math.min(start, r.startLineNumber)
        end = Math.max(end, r.endLineNumber)
      }
      if (Number.isFinite(start) && end > 0) {
        visibleStartLine = start
        visibleEndLine = end
      }
    }
    emit('editor-scroll', {
      visibleStartLine,
      visibleEndLine,
    })
  }
  scrollListener = editorInstance.onDidScrollChange(() => emitScroll())
  emitScroll()
  updateInlineDecorations()
  updateGitLineDecorations()
  updateLineMarkers()
  updateDiffZones()
  updateDiffDecorations()
  updateCodeLens()
}

function getSelection(): { fromLine: number; toLine: number; text: string } | null {
  const editor = editorRef.value
  const model = editor?.getModel()
  const selection = editor?.getSelection()
  if (!editor || !model || !selection || selection.isEmpty()) return null

  const startLine = Math.min(selection.startLineNumber, selection.endLineNumber)
  const endLine = Math.max(selection.startLineNumber, selection.endLineNumber)
  const text = model.getValueInRange(selection)
  return { fromLine: startLine, toLine: endLine, text }
}

function focus() {
  editorRef.value?.focus()
}

function insertText(text: string) {
  const editor = editorRef.value
  const monaco = monacoRef.value
  if (!editor || !monaco) return

  const selection = editor.getSelection() ?? new monaco.Selection(1, 1, 1, 1)
  editor.executeEdits('insert-text', [{ range: selection, text, forceMoveMarkers: true }])
  editor.setSelection(selection)
  editor.focus()
}

defineExpose({
  getSelection,
  focus,
  insertText,
})

onMounted(async () => {
  await ensureMonacoReady()
  updateThemeFromDom()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    themeObserver = new MutationObserver(() => updateThemeFromDom())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  ready.value = true
})

onBeforeUnmount(() => {
  if (codeLensKey) {
    const registry = getCodeLensRegistry()
    clearModelCodeLenses(codeLensKey)
    if (registry.provider) registry.emitter?.fire(registry.provider)
    codeLensKey = null
  }

  contentListener?.dispose()
  scrollListener?.dispose()
  themeObserver?.disconnect()
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
  () => props.wrap,
  (wrap) => {
    if (!editorRef.value) return
    editorRef.value.updateOptions({ wordWrap: wrap ? 'on' : 'off' })
  },
)

watch(
  () => props.readOnly,
  (readOnly) => {
    if (!editorRef.value) return
    editorRef.value.updateOptions({ readOnly: Boolean(readOnly) })
  },
)

watch(
  () => props.inlineDecorations,
  () => updateInlineDecorations(),
  { deep: true },
)

watch(
  () => props.inlineDecorationsEnabled,
  () => updateInlineDecorations(),
)

watch(
  () => props.gitLineDecorations,
  () => updateGitLineDecorations(),
  { deep: true },
)

watch(
  () => props.gitLineDecorationsEnabled,
  () => updateGitLineDecorations(),
)

watch(
  () => props.lineMarkers,
  () => updateLineMarkers(),
  { deep: true },
)

watch(
  () => props.lineMarkersEnabled,
  () => updateLineMarkers(),
)

watch(
  () => props.diffZones,
  () => updateDiffZones(),
  { deep: true },
)

watch(
  () => props.diffZonesEnabled,
  () => updateDiffZones(),
)

watch(
  () => props.diffDecorations,
  () => updateDiffDecorations(),
  { deep: true },
)

watch(
  () => props.diffDecorationsEnabled,
  () => updateDiffDecorations(),
)

watch(
  () => props.codeLensActions,
  () => updateCodeLens(),
  { deep: true },
)

watch(modelPath, () => {
  updateInlineDecorations()
  updateGitLineDecorations()
  updateLineMarkers()
  updateDiffZones()
  updateDiffDecorations()
  updateCodeLens()
})
</script>

<template>
  <div class="monaco-host" :data-files-theme="props.useFilesTheme ? '1' : '0'">
    <div v-if="!ready" class="monaco-loading">Loading editor...</div>
    <VueMonacoEditor
      v-else
      v-model:value="value"
      :language="language"
      :path="modelPath"
      :options="editorOptions"
      :theme="monacoTheme"
      @mount="handleMount"
    >
      <template #default>
        <div class="monaco-loading">Loading editor...</div>
      </template>
      <template #failure>
        <div class="monaco-loading">Editor failed to load.</div>
      </template>
    </VueMonacoEditor>
  </div>
</template>

<style scoped>
.monaco-host {
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
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

:global(.oc-inline-blame) {
  color: oklch(var(--muted-foreground));
  font-style: italic;
  font-size: 0.9em;
  opacity: 0.6;
  margin-left: 1rem;
}

:global(.oc-inline-blame--pending) {
  color: oklch(var(--primary));
  font-style: italic;
  font-weight: 500;
  font-size: 0.9em;
  opacity: 0.8;
  margin-left: 1rem;
}

:global(.oc-inline-git-hunk) {
  color: oklch(var(--muted-foreground));
  font-style: normal;
  font-weight: 500;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .margin),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .monaco-editor-background),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .inputarea.ime-input) {
  background-color: oklch(var(--background)) !important;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor .line-numbers) {
  color: oklch(var(--muted-foreground) / 0.85) !important;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor .find-widget) {
  margin-top: 8px;
  z-index: 20;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor .monaco-hover) {
  pointer-events: none;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor .find-widget > .button.codicon-widget-close),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .find-widget .button.toggle) {
  z-index: 2;
}

:global(.workbench-hover-container),
:global(.workbench-hover-container .monaco-hover.workbench-hover) {
  pointer-events: none !important;
}

:global(.monaco-host[data-files-theme='1'] .monaco-editor),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .view-line),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .line-numbers),
:global(.monaco-host[data-files-theme='1'] .monaco-editor .codelens-decoration) {
  font-family: var(--font-mono) !important;
}

:global(.oc-git-line--add) {
  background-color: oklch(0.78 0.12 145 / 0.14);
}

:global(.oc-git-line--mod) {
  background-color: oklch(0.83 0.1 90 / 0.14);
}

:global(.oc-git-line--del) {
  background-color: oklch(0.72 0.12 25 / 0.16);
}

:global(.dark .oc-git-line--add) {
  background-color: oklch(0.72 0.1 145 / 0.2);
}

:global(.dark .oc-git-line--mod) {
  background-color: oklch(0.68 0.09 90 / 0.22);
}

:global(.dark .oc-git-line--del) {
  background-color: oklch(0.55 0.11 25 / 0.24);
}

:global(.oc-git-gutter-marker) {
  width: 4px !important;
  margin-left: 3px;
  border-radius: 999px;
}

:global(.oc-git-gutter-marker--add) {
  background: oklch(0.72 0.14 145);
}

:global(.oc-git-gutter-marker--mod) {
  background: oklch(0.72 0.12 90);
}

:global(.oc-git-gutter-marker--del) {
  background: oklch(0.62 0.16 25);
}

:global(.oc-blame-block-marker) {
  --oc-blame-accent: var(--muted-foreground);
  width: 4px !important;
  height: 100% !important;
  margin-left: 1px;
  background: oklch(var(--oc-blame-accent) / 0.75);
  box-shadow: 0 0 0 1px oklch(var(--background) / 0.55);
  border-radius: 0;
}

:global(.dark .oc-blame-block-marker) {
  background: oklch(var(--oc-blame-accent) / 0.8);
  box-shadow: 0 0 0 1px oklch(var(--background) / 0.22);
}

/* Stable per-commit palette: blocks with the same commit share a color. */
:global(.oc-blame-commit-color--pending) {
  --oc-blame-accent: var(--primary);
}

:global(.oc-blame-commit-color-0) {
  --oc-blame-accent: 0.66 0.12 25;
}
:global(.oc-blame-commit-color-1) {
  --oc-blame-accent: 0.68 0.13 45;
}
:global(.oc-blame-commit-color-2) {
  --oc-blame-accent: 0.70 0.12 65;
}
:global(.oc-blame-commit-color-3) {
  --oc-blame-accent: 0.70 0.12 85;
}
:global(.oc-blame-commit-color-4) {
  --oc-blame-accent: 0.70 0.11 105;
}
:global(.oc-blame-commit-color-5) {
  --oc-blame-accent: 0.68 0.12 125;
}
:global(.oc-blame-commit-color-6) {
  --oc-blame-accent: 0.66 0.12 145;
}
:global(.oc-blame-commit-color-7) {
  --oc-blame-accent: 0.64 0.12 165;
}
:global(.oc-blame-commit-color-8) {
  --oc-blame-accent: 0.62 0.12 185;
}
:global(.oc-blame-commit-color-9) {
  --oc-blame-accent: 0.62 0.11 205;
}
:global(.oc-blame-commit-color-10) {
  --oc-blame-accent: 0.62 0.11 225;
}
:global(.oc-blame-commit-color-11) {
  --oc-blame-accent: 0.62 0.12 245;
}
:global(.oc-blame-commit-color-12) {
  --oc-blame-accent: 0.62 0.13 265;
}
:global(.oc-blame-commit-color-13) {
  --oc-blame-accent: 0.62 0.13 285;
}
:global(.oc-blame-commit-color-14) {
  --oc-blame-accent: 0.64 0.12 305;
}
:global(.oc-blame-commit-color-15) {
  --oc-blame-accent: 0.66 0.12 325;
}
:global(.oc-blame-commit-color-16) {
  --oc-blame-accent: 0.66 0.12 345;
}
:global(.oc-blame-commit-color-17) {
  --oc-blame-accent: 0.66 0.12 5;
}

:global(.oc-blame-block-marker:hover) {
  background: oklch(var(--oc-blame-accent) / 0.92);
}

:global(.dark .oc-blame-block-marker:hover) {
  background: oklch(var(--oc-blame-accent) / 0.95);
}

/* (pending color handled via --oc-blame-accent override) */

:global(.oc-blame-block-marker--start) {
  border-top-left-radius: 999px;
  border-top-right-radius: 999px;
  margin-top: 2px;
  height: calc(100% - 2px) !important;
}

:global(.oc-blame-block-marker--end) {
  border-bottom-left-radius: 999px;
  border-bottom-right-radius: 999px;
  margin-bottom: 2px;
  height: calc(100% - 2px) !important;
}

:global(.oc-blame-block-marker--single) {
  border-radius: 999px;
  margin-top: 2px;
  margin-bottom: 2px;
  height: calc(100% - 4px) !important;
}

/* Line-level block shading removed to avoid looking like existing guides. */

:global(.oc-diff-zone) {
  width: 100%;
  background-color: oklch(0.72 0.12 25 / 0.1);
}

:global(.oc-diff-zone-line) {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 19px; /* Approximation, should ideally match editor lineHeight */
  white-space: pre;
  color: oklch(var(--muted-foreground));
  padding-left: 4px;
}
</style>
