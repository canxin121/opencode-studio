import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { apiJson } from '@/lib/api'
import { getLocalJson, getLocalString, removeLocalKey, setLocalJson, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'
import { fsPathEquals, fsPathStartsWith, normalizeFsPath, trimTrailingFsSlashes } from '@/lib/path'
import type { SseEvent } from '@/lib/sse'
import { DEFAULT_WINDOW_SCOPE_ID, normalizeWindowScopeId, resolveWindowScopeId } from '@/app/windowScope'
import { useUiStore } from '@/stores/ui'

const STORAGE_LAST_DIRECTORY = localStorageKeys.directory.lastDirectory
const STORAGE_CURRENT_DIRECTORY_BY_WINDOW = localStorageKeys.directory.currentDirectoryByWindow

type FsHomeResponse = { home?: string; path?: string }

export type FsChangeEvent = {
  directory: string
  changeType: string
  paths: string[]
  oldPath: string | null
  newPath: string | null
  truncated: boolean
  receivedAt: number
}

function normalizeFsEventPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  return trimTrailingFsSlashes(normalizeFsPath(value))
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseFsChangedEvent(evt: SseEvent): FsChangeEvent | null {
  if (evt.type !== 'opencode-studio:fs-changed') return null
  const props = toRecord(evt.properties)
  if (!props) return null

  const directory = normalizeFsEventPath(props.directory)
  const changeType = typeof props.changeType === 'string' ? props.changeType.trim() : ''
  if (!directory || !changeType) return null

  const seen = new Set<string>()
  const paths: string[] = []
  const pushPath = (raw: unknown) => {
    const normalized = normalizeFsEventPath(raw)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    paths.push(normalized)
  }

  if (Array.isArray(props.paths)) {
    for (const path of props.paths) {
      pushPath(path)
    }
  }

  const oldPath = normalizeFsEventPath(props.oldPath)
  const newPath = normalizeFsEventPath(props.newPath)
  if (oldPath) pushPath(oldPath)
  if (newPath) pushPath(newPath)

  return {
    directory,
    changeType,
    paths,
    oldPath: oldPath || null,
    newPath: newPath || null,
    truncated: props.truncated === true,
    receivedAt: Date.now(),
  }
}

export const useDirectoryStore = defineStore('directory', () => {
  const ui = useUiStore()
  const homeDirectory = ref<string | null>(null)
  const currentDirectoryByWindow = ref<Record<string, string>>(
    (() => {
      const persisted = getLocalJson<unknown>(STORAGE_CURRENT_DIRECTORY_BY_WINDOW, {})
      if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
        const legacy = trimTrailingFsSlashes(normalizeFsPath(getLocalString(STORAGE_LAST_DIRECTORY).trim()))
        return legacy ? { [DEFAULT_WINDOW_SCOPE_ID]: legacy } : {}
      }

      const out: Record<string, string> = {}
      for (const [rawWindowId, rawPath] of Object.entries(persisted as Record<string, unknown>)) {
        const windowId = normalizeWindowScopeId(rawWindowId, '')
        if (!windowId) continue
        const normalized = typeof rawPath === 'string' ? trimTrailingFsSlashes(normalizeFsPath(rawPath)) : ''
        if (!normalized) continue
        out[windowId] = normalized
      }

      if (Object.keys(out).length > 0) return out
      const legacy = trimTrailingFsSlashes(normalizeFsPath(getLocalString(STORAGE_LAST_DIRECTORY).trim()))
      return legacy ? { [DEFAULT_WINDOW_SCOPE_ID]: legacy } : {}
    })(),
  )
  const fsEventSeq = ref(0)
  const lastFsChangeEvent = ref<FsChangeEvent | null>(null)

  const currentWindowScopeId = computed(() =>
    resolveWindowScopeId({
      fallback: ui.activeWorkspaceWindowId,
      defaultScope: DEFAULT_WINDOW_SCOPE_ID,
    }),
  )

  const currentDirectory = computed<string | null>({
    get() {
      const scopeId = normalizeWindowScopeId(currentWindowScopeId.value)
      const scoped = trimTrailingFsSlashes(String(currentDirectoryByWindow.value[scopeId] || '').trim())
      if (scoped) return scoped

      const fallback = trimTrailingFsSlashes(
        String(currentDirectoryByWindow.value[DEFAULT_WINDOW_SCOPE_ID] || '').trim(),
      )
      return fallback || null
    },
    set(value) {
      setDirectoryForWindow(currentWindowScopeId.value, value)
    },
  })

  const displayDirectory = computed(() => {
    const cwd = trimTrailingFsSlashes(currentDirectory.value || '')
    const home = trimTrailingFsSlashes(homeDirectory.value || '')
    if (!cwd) return ''
    if (!home) return cwd
    if (fsPathEquals(cwd, home)) return '~'
    if (fsPathStartsWith(cwd, home)) return `~/${cwd.slice(home.length).replace(/^\/+/, '')}`
    return cwd
  })

  function persistCurrentDirectoryMap(next: Record<string, string>) {
    setLocalJson(STORAGE_CURRENT_DIRECTORY_BY_WINDOW, next)
    const activeScope = normalizeWindowScopeId(currentWindowScopeId.value)
    const preferred = String(next[activeScope] || next[DEFAULT_WINDOW_SCOPE_ID] || '').trim()
    if (preferred) {
      setLocalString(STORAGE_LAST_DIRECTORY, preferred)
      return
    }
    removeLocalKey(STORAGE_LAST_DIRECTORY)
  }

  async function refreshHome() {
    try {
      const resp = await apiJson<FsHomeResponse>('/api/fs/home')
      const raw = typeof resp?.home === 'string' ? resp.home : resp?.path
      const path = typeof raw === 'string' ? trimTrailingFsSlashes(raw) : ''
      homeDirectory.value = path || null
    } catch {
      // ignore
    }
  }

  function getDirectoryForWindow(windowId: string | null | undefined): string | null {
    const scopeId = normalizeWindowScopeId(windowId, '')
    if (!scopeId) return null
    const normalized = trimTrailingFsSlashes(String(currentDirectoryByWindow.value[scopeId] || '').trim())
    return normalized || null
  }

  function setDirectoryForWindow(windowId: string | null | undefined, path: string | null | undefined) {
    const scopeId = normalizeWindowScopeId(windowId)
    const normalized = typeof path === 'string' ? trimTrailingFsSlashes(path) : ''
    const next = normalized || null

    const current = trimTrailingFsSlashes(String(currentDirectoryByWindow.value[scopeId] || '').trim()) || null
    if (current === next) return

    const map = { ...currentDirectoryByWindow.value }
    if (next) {
      map[scopeId] = next
    } else {
      delete map[scopeId]
    }
    currentDirectoryByWindow.value = map
    persistCurrentDirectoryMap(map)
  }

  function setDirectory(path: string | null | undefined) {
    setDirectoryForWindow(currentWindowScopeId.value, path)
  }

  function applyGlobalEvent(evt: SseEvent) {
    const changed = parseFsChangedEvent(evt)
    if (!changed) return
    lastFsChangeEvent.value = changed
    fsEventSeq.value += 1
  }

  function hydrateFromStorage() {
    const scopeId = normalizeWindowScopeId(currentWindowScopeId.value)
    const existing = trimTrailingFsSlashes(String(currentDirectoryByWindow.value[scopeId] || '').trim())
    if (existing) return

    const fromMap = trimTrailingFsSlashes(String(currentDirectoryByWindow.value[DEFAULT_WINDOW_SCOPE_ID] || '').trim())
    if (fromMap) {
      setDirectoryForWindow(scopeId, fromMap)
      return
    }

    const raw = getLocalString(STORAGE_LAST_DIRECTORY).trim()
    if (!raw) return

    const normalized = trimTrailingFsSlashes(normalizeFsPath(raw))
    if (normalized) {
      setDirectoryForWindow(scopeId, normalized)
    }
  }

  watch(currentDirectoryByWindow, (map) => {
    persistCurrentDirectoryMap(map)
  })

  return {
    currentDirectory,
    currentDirectoryByWindow,
    displayDirectory,
    fsEventSeq,
    lastFsChangeEvent,
    refreshHome,
    getDirectoryForWindow,
    setDirectoryForWindow,
    setDirectory,
    applyGlobalEvent,
    hydrateFromStorage,
  }
})
