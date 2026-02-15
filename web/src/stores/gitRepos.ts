import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JsonValue as JsonLike } from '@/types/json'

const STORAGE_KEY = 'oc2.git.selectedRepoByProject'
const CLOSED_STORAGE_KEY = 'oc2.git.closedReposByProject'

type Map = Record<string, string>

function isRecord(value: JsonLike): value is Record<string, JsonLike> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeParseRecord(raw: string): Record<string, JsonLike> {
  try {
    const v = JSON.parse(raw)
    return isRecord(v) ? v : {}
  } catch {
    return {}
  }
}

function toStringMap(raw: Record<string, JsonLike>): Map {
  const out: Map = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export const useGitReposStore = defineStore('gitRepos', () => {
  const selectedByProject = ref<Map>({})
  const closedByProject = ref<Record<string, string[]>>({})

  // Hydrate once on first use.
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').trim()
    if (raw) selectedByProject.value = toStringMap(safeParseRecord(raw))
  } catch {
    // ignore
  }

  try {
    const raw = (localStorage.getItem(CLOSED_STORAGE_KEY) || '').trim()
    if (raw) {
      const parsed = safeParseRecord(raw)
      const next: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          const list = v.map((item) => String(item || '').trim()).filter(Boolean)
          if (list.length) next[k] = Array.from(new Set(list))
        }
      }
      closedByProject.value = next
    }
  } catch {
    // ignore
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedByProject.value))
    } catch {
      // ignore
    }
  }

  function persistClosed() {
    try {
      localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify(closedByProject.value))
    } catch {
      // ignore
    }
  }

  function getSelectedRelative(projectRoot: string | null | undefined): string {
    const key = (projectRoot || '').trim()
    if (!key) return '.'
    const rel = (selectedByProject.value[key] || '').trim()
    return rel || '.'
  }

  function setSelectedRelative(projectRoot: string, relative: string) {
    const key = (projectRoot || '').trim()
    if (!key) return
    const rel = (relative || '').trim() || '.'
    selectedByProject.value = { ...selectedByProject.value, [key]: rel }
    persist()
  }

  function getClosedRelatives(projectRoot: string | null | undefined): string[] {
    const key = (projectRoot || '').trim()
    if (!key) return []
    return [...(closedByProject.value[key] || [])]
  }

  function closeRepo(projectRoot: string, relative: string) {
    const key = (projectRoot || '').trim()
    const rel = (relative || '').trim() || '.'
    if (!key || !rel) return
    const current = closedByProject.value[key] || []
    if (current.includes(rel)) return
    closedByProject.value = {
      ...closedByProject.value,
      [key]: [...current, rel],
    }
    persistClosed()
  }

  function reopenRepo(projectRoot: string, relative: string) {
    const key = (projectRoot || '').trim()
    const rel = (relative || '').trim() || '.'
    if (!key || !rel) return
    const current = closedByProject.value[key] || []
    const next = current.filter((item) => item !== rel)
    closedByProject.value = {
      ...closedByProject.value,
      [key]: next,
    }
    persistClosed()
  }

  return {
    getSelectedRelative,
    setSelectedRelative,
    getClosedRelatives,
    closeRepo,
    reopenRepo,
  }
})
