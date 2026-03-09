import { ref, type Ref } from 'vue'
import type * as Monaco from 'monaco-editor'

type SearchDirection = 1 | -1

export interface MonacoFindOptionRefs {
  query: Ref<string>
  caseSensitive: Ref<boolean>
  regex: Ref<boolean>
  wholeWord: Ref<boolean>
}

export interface MonacoFindRefreshOptions {
  revealCurrent?: boolean
  focusEditor?: boolean
}

export interface MonacoFindSession {
  readonly matchCount: Ref<number>
  readonly currentMatch: Ref<number>
  readonly invalidRegex: Ref<boolean>
  refresh: (options?: MonacoFindRefreshOptions) => void
  move: (direction: SearchDirection) => void
  replaceCurrent: (replaceValue: string, options?: MonacoFindRefreshOptions) => boolean
  replaceAll: (replaceValue: string, options?: MonacoFindRefreshOptions) => number
  seedQueryFromSelection: () => boolean
  clear: () => void
  focusEditor: () => void
  dispose: () => void
}

interface DecorationsState {
  all: Monaco.editor.IEditorDecorationsCollection | null
  current: Monaco.editor.IEditorDecorationsCollection | null
}

interface BuiltSearchInput {
  searchString: string
  isRegex: boolean
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rangeStartsAfter(a: Monaco.IRange, b: Monaco.IPosition): boolean {
  return a.startLineNumber > b.lineNumber || (a.startLineNumber === b.lineNumber && a.startColumn > b.column)
}

function rangeEqualsSelection(range: Monaco.IRange, selection: Monaco.Selection): boolean {
  return (
    range.startLineNumber === selection.startLineNumber &&
    range.startColumn === selection.startColumn &&
    range.endLineNumber === selection.endLineNumber &&
    range.endColumn === selection.endColumn
  )
}

export function useMonacoFindSession(
  getEditor: () => Monaco.editor.IStandaloneCodeEditor | null,
  options: MonacoFindOptionRefs,
): MonacoFindSession {
  const matchCount = ref(0)
  const currentMatch = ref(0)
  const invalidRegex = ref(false)

  const decorations: DecorationsState = {
    all: null,
    current: null,
  }

  let ranges: Monaco.editor.FindMatch[] = []

  function clearDecorations() {
    decorations.all?.set([])
    decorations.current?.set([])
  }

  function resetState() {
    ranges = []
    matchCount.value = 0
    currentMatch.value = 0
    invalidRegex.value = false
    clearDecorations()
  }

  function ensureDecorations(editor: Monaco.editor.IStandaloneCodeEditor) {
    if (!decorations.all) {
      decorations.all = editor.createDecorationsCollection()
    }
    if (!decorations.current) {
      decorations.current = editor.createDecorationsCollection()
    }
  }

  function updateDecorations() {
    const editor = getEditor()
    if (!editor) {
      resetState()
      return
    }
    ensureDecorations(editor)

    decorations.all?.set(
      ranges.map((item) => ({
        range: item.range,
        options: {
          className: 'oc-monaco-find-match',
        },
      })),
    )

    const activeIndex = Math.max(0, currentMatch.value - 1)
    const activeRange = ranges[activeIndex]?.range
    decorations.current?.set(
      activeRange
        ? [
            {
              range: activeRange,
              options: {
                className: 'oc-monaco-find-match-current',
              },
            },
          ]
        : [],
    )
  }

  function pickCurrentIndex(editor: Monaco.editor.IStandaloneCodeEditor): number {
    if (!ranges.length) return -1

    const selection = editor.getSelection()
    if (selection) {
      const exact = ranges.findIndex((item) => rangeEqualsSelection(item.range, selection))
      if (exact >= 0) return exact

      const after = ranges.findIndex((item) => rangeStartsAfter(item.range, selection.getStartPosition()))
      if (after >= 0) return after
    }

    return 0
  }

  function applyCurrentSelection(index: number, focusEditor: boolean) {
    const editor = getEditor()
    if (!editor) return
    const next = ranges[index]
    if (!next) return

    editor.setSelection(next.range)
    editor.revealRangeInCenterIfOutsideViewport(next.range)
    if (focusEditor) editor.focus()
  }

  function buildSearchInput(): BuiltSearchInput | null {
    const raw = options.query.value
    if (!raw) return null

    if (!options.wholeWord.value) {
      return {
        searchString: raw,
        isRegex: options.regex.value,
      }
    }

    const wrapped = options.regex.value ? `\\b(?:${raw})\\b` : `\\b${escapeRegex(raw)}\\b`
    return {
      searchString: wrapped,
      isRegex: true,
    }
  }

  function buildReplacementRegex(searchInput: BuiltSearchInput): RegExp | null {
    if (!searchInput.isRegex) return null
    try {
      const flags = options.caseSensitive.value ? 'u' : 'iu'
      return new RegExp(searchInput.searchString, flags)
    } catch {
      return null
    }
  }

  function refresh(refreshOptions: MonacoFindRefreshOptions = {}) {
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model) {
      resetState()
      return
    }

    const input = buildSearchInput()
    if (!input) {
      resetState()
      return
    }

    ensureDecorations(editor)

    try {
      ranges = model.findMatches(
        input.searchString,
        true,
        input.isRegex,
        options.caseSensitive.value,
        null,
        false,
        5000,
      )
      invalidRegex.value = false
    } catch {
      ranges = []
      invalidRegex.value = true
    }

    matchCount.value = ranges.length
    if (!ranges.length) {
      currentMatch.value = 0
      updateDecorations()
      return
    }

    const currentIndex = pickCurrentIndex(editor)
    currentMatch.value = currentIndex + 1
    updateDecorations()

    if (refreshOptions.revealCurrent) {
      applyCurrentSelection(currentIndex, Boolean(refreshOptions.focusEditor))
    }
  }

  function move(direction: SearchDirection) {
    if (!ranges.length) {
      refresh()
      if (!ranges.length) return
    }

    const total = ranges.length
    const startIndex = Math.max(0, currentMatch.value - 1)
    const nextIndex = (startIndex + direction + total) % total
    currentMatch.value = nextIndex + 1
    updateDecorations()
    applyCurrentSelection(nextIndex, true)
  }

  function replaceCurrent(replaceValue: string, refreshOptions: MonacoFindRefreshOptions = {}): boolean {
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model) return false

    const searchInput = buildSearchInput()
    if (!searchInput) return false

    if (!ranges.length) {
      refresh({ revealCurrent: true })
    }
    if (!ranges.length || invalidRegex.value) return false

    const replacementRegex = buildReplacementRegex(searchInput)
    if (searchInput.isRegex && !replacementRegex) {
      invalidRegex.value = true
      return false
    }

    const activeIndex = Math.min(Math.max(0, currentMatch.value - 1), ranges.length - 1)
    const active = ranges[activeIndex]
    if (!active) return false

    const sourceText = model.getValueInRange(active.range)
    const nextText = replacementRegex ? sourceText.replace(replacementRegex, replaceValue) : replaceValue

    editor.pushUndoStop()
    const applied = editor.executeEdits('oc-find-replace', [
      {
        range: active.range,
        text: nextText,
        forceMoveMarkers: true,
      },
    ])
    editor.pushUndoStop()

    if (!applied) return false

    const revealCurrent = refreshOptions.revealCurrent ?? true
    refresh({ revealCurrent, focusEditor: refreshOptions.focusEditor })
    return true
  }

  function replaceAll(replaceValue: string, refreshOptions: MonacoFindRefreshOptions = {}): number {
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model) return 0

    const searchInput = buildSearchInput()
    if (!searchInput) return 0

    if (!ranges.length) {
      refresh()
    }
    if (!ranges.length || invalidRegex.value) return 0

    const replacementRegex = buildReplacementRegex(searchInput)
    if (searchInput.isRegex && !replacementRegex) {
      invalidRegex.value = true
      return 0
    }

    const edits = [...ranges].reverse().map((entry) => {
      const sourceText = model.getValueInRange(entry.range)
      const nextText = replacementRegex ? sourceText.replace(replacementRegex, replaceValue) : replaceValue
      return {
        range: entry.range,
        text: nextText,
        forceMoveMarkers: true,
      }
    })

    if (!edits.length) return 0

    editor.pushUndoStop()
    const applied = editor.executeEdits('oc-find-replace-all', edits)
    editor.pushUndoStop()
    if (!applied) return 0

    const revealCurrent = refreshOptions.revealCurrent ?? true
    refresh({ revealCurrent, focusEditor: refreshOptions.focusEditor })
    return edits.length
  }

  function seedQueryFromSelection(): boolean {
    const editor = getEditor()
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection || selection.isEmpty()) return false

    const selectedText = model.getValueInRange(selection)
    if (!selectedText || selectedText.includes('\n') || selectedText.includes('\r')) return false

    options.query.value = selectedText
    return true
  }

  function clear() {
    resetState()
  }

  function focusEditor() {
    getEditor()?.focus()
  }

  function dispose() {
    clearDecorations()
    decorations.all = null
    decorations.current = null
    ranges = []
  }

  return {
    matchCount,
    currentMatch,
    invalidRegex,
    refresh,
    move,
    replaceCurrent,
    replaceAll,
    seedQueryFromSelection,
    clear,
    focusEditor,
    dispose,
  }
}
