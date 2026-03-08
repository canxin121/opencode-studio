import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { apiJson } from '@/lib/api'
import { getLocalString, removeLocalKey, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'
import { fsPathEquals, fsPathStartsWith, normalizeFsPath, trimTrailingFsSlashes } from '@/lib/path'
import type { SseEvent } from '@/lib/sse'

const STORAGE_LAST_DIRECTORY = localStorageKeys.directory.lastDirectory

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
  const homeDirectory = ref<string | null>(null)
  const currentDirectory = ref<string | null>(null)
  const fsEventSeq = ref(0)
  const lastFsChangeEvent = ref<FsChangeEvent | null>(null)

  const displayDirectory = computed(() => {
    const cwd = trimTrailingFsSlashes(currentDirectory.value || '')
    const home = trimTrailingFsSlashes(homeDirectory.value || '')
    if (!cwd) return ''
    if (!home) return cwd
    if (fsPathEquals(cwd, home)) return '~'
    if (fsPathStartsWith(cwd, home)) return `~/${cwd.slice(home.length).replace(/^\/+/, '')}`
    return cwd
  })

  function persistCurrentDirectory(next: string | null) {
    if (next) {
      setLocalString(STORAGE_LAST_DIRECTORY, next)
    } else {
      removeLocalKey(STORAGE_LAST_DIRECTORY)
    }
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

  function setDirectory(path: string | null | undefined) {
    const normalized = typeof path === 'string' ? trimTrailingFsSlashes(path) : ''
    const next = normalized || null
    currentDirectory.value = next
    persistCurrentDirectory(next)
  }

  function applyGlobalEvent(evt: SseEvent) {
    const changed = parseFsChangedEvent(evt)
    if (!changed) return
    lastFsChangeEvent.value = changed
    fsEventSeq.value += 1
  }

  function hydrateFromStorage() {
    const raw = getLocalString(STORAGE_LAST_DIRECTORY).trim()
    if (raw) {
      currentDirectory.value = trimTrailingFsSlashes(normalizeFsPath(raw))
    }
  }

  // Keep localStorage in sync when currentDirectory changes elsewhere.
  watch(currentDirectory, (v) => {
    persistCurrentDirectory(v)
  })

  return {
    currentDirectory,
    displayDirectory,
    fsEventSeq,
    lastFsChangeEvent,
    refreshHome,
    setDirectory,
    applyGlobalEvent,
    hydrateFromStorage,
  }
})
