import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, apiJson } from '../lib/api'
import { useDirectoryStore } from './directory'
import { postAppBroadcast } from '@/lib/appBroadcast'

export type Project = {
  id: string
  path: string
  label?: string
  addedAt?: number
  lastOpenedAt?: number
  worktreeDefaults?: {
    branchPrefix?: string
    baseBranch?: string
  }
}

export type Settings = {
  projects: Project[]
  // API compatibility alias; projects remains the persisted schema key.
  directories?: Project[]
  approvedDirectories?: string[]
  pinnedDirectories?: string[]
  securityScopedBookmarks?: string[]
  showReasoningTraces?: boolean
  showTextJustificationActivity?: boolean
  showChatTimestamps?: boolean
  chatActivityFilters?: string[]
  chatActivityToolFilters?: string[]
  chatActivityDefaultExpanded?: string[]
  chatActivityDefaultExpandedToolFilters?: string[]

  // Chat activity UX (local UI preferences)
  chatActivityAutoCollapseOnIdle?: boolean
  diffLayoutPreference?: 'dynamic' | 'inline' | 'side-by-side'
  diffViewMode?: 'single' | 'stacked'

  githubClientId?: string
  githubScopes?: string

  // UI / appearance
  useSystemTheme?: boolean
  themeVariant?: 'light' | 'dark'
  themeId?: string
  lightThemeId?: string
  darkThemeId?: string
  uiFont?: string
  monoFont?: string
  fontSize?: number
  padding?: number
  cornerRadius?: number
  inputBarOffset?: number
  typographySizes?: {
    markdown?: string
    code?: string
    uiHeader?: string
    uiLabel?: string
    meta?: string
    micro?: string
  }

  // Retention
  autoDeleteEnabled?: boolean
  autoDeleteAfterDays?: number

  // Performance
  memoryLimitHistorical?: number
  memoryLimitViewport?: number
  memoryLimitActiveSession?: number

  // Worktrees
  autoCreateWorktree?: boolean
  queueModeEnabled?: boolean

  // Git
  defaultGitIdentityId?: string
  gitmojiEnabled?: boolean
  gitAutoFetchEnabled?: boolean
  gitAutoFetchIntervalMinutes?: number
  gitAutoSyncEnabled?: boolean
  gitAutoSyncIntervalMinutes?: number
  gitAllowForcePush?: boolean
  gitAllowNoVerifyCommit?: boolean
  gitEnforceBranchProtection?: boolean
  gitStrictPatchValidation?: boolean
  gitBranchProtection?: string[]
  gitBranchProtectionPrompt?: 'alwaysCommit' | 'alwaysCommitToNewBranch' | 'alwaysPrompt'
  gitPostCommitCommand?: 'none' | 'push' | 'sync'

  // Skills
  skillCatalogs?: Array<{ id: string; label: string; source: string; subpath?: string; gitIdentityId?: string }>
}

export const useSettingsStore = defineStore('settings', () => {
  const directoryStore = useDirectoryStore()
  const data = ref<Settings | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function projectForPath(path: string | null | undefined): Project | null {
    const dir = typeof path === 'string' ? path.trim() : ''
    const s = data.value
    if (!dir || !s || s.projects.length === 0) return null
    return s.projects.find((p) => p.path === dir) || null
  }

  const activeProject = computed(() => projectForPath(directoryStore.currentDirectory))

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      data.value = await apiJson<Settings>('/api/config/settings')

      // On first load, seed currentDirectory from persisted lastDirectory.
      if (!directoryStore.currentDirectory) {
        directoryStore.hydrateFromStorage()
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      data.value = null
    } finally {
      loading.value = false
    }
  }

  async function save(partial: Partial<Settings>) {
    error.value = null
    try {
      const updated = await apiJson<Settings>('/api/config/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(partial),
      })
      data.value = updated
      // Notify other tabs to refresh settings + derived UI (projects list, labels, etc.).
      postAppBroadcast('settings.updated', { updatedAt: Date.now() })
    } catch (err) {
      if (err instanceof ApiError) {
        error.value = err.message || err.bodyText || null
      } else {
        error.value = err instanceof Error ? err.message : String(err)
      }
    }
  }

  async function addProject(path: string) {
    const trimmed = path.trim()
    if (!trimmed) return
    const s = data.value
    const now = Date.now()
    const projects = (s?.projects || []).slice()
    const existing = projects.find((p) => p.path === trimmed)
    if (existing) {
      existing.lastOpenedAt = now
      await save({ projects })
      return
    }
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${now}-${Math.random()}`
    projects.push({ id, path: trimmed, addedAt: now, lastOpenedAt: now })
    await save({ projects })
  }

  async function removeProject(projectId: string) {
    const id = (projectId || '').trim()
    if (!id) return
    const s = data.value
    if (!s) return
    const nextProjects = (s.projects || []).filter((p) => p.id !== id)
    await save({ projects: nextProjects })
  }

  async function reorderProjects(fromIndex: number, toIndex: number) {
    const s = data.value
    if (!s) return
    const projects = (s.projects || []).slice()
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= projects.length || toIndex >= projects.length) return
    if (fromIndex === toIndex) return
    const [moved] = projects.splice(fromIndex, 1)
    if (!moved) return
    projects.splice(toIndex, 0, moved)
    await save({ projects })
  }

  async function renameProject(projectId: string, label: string) {
    const s = data.value
    if (!s) return
    const id = (projectId || '').trim()
    const trimmed = (label || '').trim()
    if (!id) return
    const next = (s.projects || []).map((p) => (p.id === id ? { ...p, label: trimmed } : p))
    await save({ projects: next })
  }

  return {
    data,
    loading,
    error,
    activeProject,
    projectForPath,
    refresh,
    addProject,
    removeProject,
    reorderProjects,
    renameProject,
    save,
  }
})
