// Vendored from @guolao/vue-monaco-editor@1.6.0 (MIT).
import type { MonacoEditor } from './types'

export function slotHelper<T>(slot: T | (() => T)) {
  return typeof slot === 'function' ? (slot as () => T)() : slot
}

export function isUndefined<T>(v: T | undefined): v is undefined {
  return v === undefined
}

export function getOrCreateModel(monaco: MonacoEditor, value: string, language?: string, path?: string) {
  return getModel(monaco, path || '') || createModel(monaco, value, language, path)
}

function getModel(monaco: MonacoEditor, path: string) {
  return monaco.editor.getModel(createModelUri(monaco, path))
}

function createModel(monaco: MonacoEditor, value: string, language?: string, path?: string) {
  return monaco.editor.createModel(value, language, path ? createModelUri(monaco, path) : undefined)
}

function createModelUri(monaco: MonacoEditor, path: string) {
  return monaco.Uri.parse(path)
}
