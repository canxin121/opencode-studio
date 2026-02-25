import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { apiJson } from '@/lib/api'
import { getLocalString, removeLocalKey, setLocalString } from '@/lib/persist'
import { fsPathEquals, fsPathStartsWith, normalizeFsPath, trimTrailingFsSlashes } from '@/lib/path'

const STORAGE_LAST_DIRECTORY = 'oc2.lastDirectory'

type FsHomeResponse = { home?: string; path?: string }

export const useDirectoryStore = defineStore('directory', () => {
  const homeDirectory = ref<string | null>(null)
  const currentDirectory = ref<string | null>(null)

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
    refreshHome,
    setDirectory,
    hydrateFromStorage,
  }
})
