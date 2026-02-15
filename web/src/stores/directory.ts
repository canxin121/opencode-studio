import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { apiJson } from '@/lib/api'
import { getLocalString, removeLocalKey, setLocalString } from '@/lib/persist'

const STORAGE_LAST_DIRECTORY = 'oc2.lastDirectory'

type FsHomeResponse = { path?: string }

export const useDirectoryStore = defineStore('directory', () => {
  const homeDirectory = ref<string | null>(null)
  const currentDirectory = ref<string | null>(null)

  const displayDirectory = computed(() => {
    const cwd = currentDirectory.value || ''
    const home = homeDirectory.value || ''
    if (!cwd) return ''
    if (!home) return cwd
    if (cwd === home) return '~'
    if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length)
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
      const path = typeof resp?.path === 'string' ? resp.path.trim() : ''
      homeDirectory.value = path || null
    } catch {
      // ignore
    }
  }

  function setDirectory(path: string | null | undefined) {
    const trimmed = typeof path === 'string' ? path.trim() : ''
    const next = trimmed || null
    currentDirectory.value = next
    persistCurrentDirectory(next)
  }

  function hydrateFromStorage() {
    const raw = getLocalString(STORAGE_LAST_DIRECTORY).trim()
    if (raw) {
      currentDirectory.value = raw
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
