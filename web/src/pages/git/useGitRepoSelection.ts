import { ref, type Ref } from 'vue'

import type { GitRepoEntry } from '@/types/git'
import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

type GitReposStoreLike = {
  setSelectedRelative: (projectRoot: string, relative: string) => void
  getClosedRelatives: (projectRoot: string | null | undefined) => string[]
  closeRepo: (projectRoot: string, relative: string) => void
  reopenRepo: (projectRoot: string, relative: string) => void
}

export function useGitRepoSelection(opts: {
  projectRoot: Ref<string | null>
  selectedRepoRelative: Ref<string | null>
  gitRepos: GitReposStoreLike
  toasts: Toasts
  gitJson: GitJson
  // Page-owned load functions; used after init.
  load: () => Promise<void>
  switchProjectRoot: (path: string) => Promise<void> | void
}) {
  const { projectRoot, selectedRepoRelative, gitRepos, toasts, gitJson, load, switchProjectRoot } = opts

  const repos = ref<GitRepoEntry[]>([])
  const closedRepos = ref<GitRepoEntry[]>([])
  const parentRepos = ref<string[]>([])
  const reposLoading = ref(false)
  const reposError = ref<string | null>(null)

  const repoPickerOpen = ref(false)

  const initRepoOpen = ref(false)
  const initRepoPath = ref('.')
  const initRepoDefaultBranch = ref('')
  const initRepoBusy = ref(false)

  const cloneRepoOpen = ref(false)
  const cloneRepoUrl = ref('')
  const cloneRepoPath = ref('')
  const cloneRepoRef = ref('')
  const cloneRepoRecursive = ref(false)
  const cloneRepoBusy = ref(false)

  async function loadRepos() {
    const dir = projectRoot.value
    if (!dir) return
    reposLoading.value = true
    reposError.value = null
    try {
      const resp = await gitJson<{ repos: GitRepoEntry[]; parentRepos?: string[] }>('repos', dir)
      const allRepos = Array.isArray(resp.repos) ? resp.repos : []
      const closed = new Set(gitRepos.getClosedRelatives(dir).map((x) => (x || '').trim() || '.'))
      repos.value = allRepos.filter((r) => !closed.has((r.relative || '.').trim() || '.'))
      closedRepos.value = allRepos.filter((r) => closed.has((r.relative || '.').trim() || '.'))
      parentRepos.value = Array.isArray(resp?.parentRepos)
        ? resp.parentRepos.map((x) => (x || '').trim()).filter(Boolean)
        : []

      // Ensure selection is valid.
      const rel = selectedRepoRelative.value
      const exists = repos.value.some((r) => (r.relative || '.').trim() === rel)
      if (!exists) {
        const fallback = repos.value[0]?.relative || '.'
        gitRepos.setSelectedRelative(dir, fallback)
      }
    } catch (err) {
      reposError.value = err instanceof Error ? err.message : String(err)
      repos.value = []
      closedRepos.value = []
      parentRepos.value = []
    } finally {
      reposLoading.value = false
    }
  }

  async function initRepo() {
    const dir = projectRoot.value
    if (!dir) return
    const rel = (initRepoPath.value || '').trim() || '.'
    const defaultBranch = (initRepoDefaultBranch.value || '').trim()
    initRepoBusy.value = true
    try {
      const resp = await gitJson<{ success: boolean; relative?: string }>('init', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: rel, defaultBranch: defaultBranch || undefined }),
      })
      if (resp?.success) {
        gitRepos.setSelectedRelative(dir, (resp.relative || rel).trim() || '.')
        initRepoOpen.value = false
        initRepoDefaultBranch.value = ''
        toasts.push('success', 'Initialized git repository')
        await loadRepos()
        await load()
      }
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      initRepoBusy.value = false
    }
  }

  async function cloneRepo() {
    const dir = projectRoot.value
    if (!dir) return
    const url = (cloneRepoUrl.value || '').trim()
    const rel = (cloneRepoPath.value || '').trim()
    const refName = (cloneRepoRef.value || '').trim()
    const recursive = cloneRepoRecursive.value
    if (!url) return
    cloneRepoBusy.value = true
    try {
      const resp = await gitJson<{ success: boolean; relative?: string }>('clone', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          path: rel || null,
          ref: refName || undefined,
          recursive,
        }),
      })
      if (resp?.success) {
        const relative = (resp.relative || rel).trim() || '.'
        gitRepos.setSelectedRelative(dir, relative)
        cloneRepoOpen.value = false
        cloneRepoUrl.value = ''
        cloneRepoPath.value = ''
        cloneRepoRef.value = ''
        cloneRepoRecursive.value = false
        toasts.push('success', 'Cloned repository')
        await loadRepos()
        await load()
      }
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      cloneRepoBusy.value = false
    }
  }

  function selectRepo(relative: string) {
    const base = projectRoot.value
    if (!base) return
    gitRepos.setSelectedRelative(base, (relative || '.').trim() || '.')
    repoPickerOpen.value = false
  }

  async function openParentRepo(path: string) {
    const target = (path || '').trim()
    if (!target) return
    repoPickerOpen.value = false
    await switchProjectRoot(target)
  }

  function closeRepo(relative: string) {
    const base = projectRoot.value
    if (!base) return
    const rel = (relative || '.').trim() || '.'
    gitRepos.closeRepo(base, rel)
    void loadRepos()
    if ((selectedRepoRelative.value || '.').trim() === rel) {
      const fallback = repos.value.find((r) => (r.relative || '.').trim() !== rel)?.relative || '.'
      gitRepos.setSelectedRelative(base, fallback)
      void load()
    }
    toasts.push('info', `Closed repository ${rel}`)
  }

  function reopenRepo(relative: string) {
    const base = projectRoot.value
    if (!base) return
    const rel = (relative || '.').trim() || '.'
    gitRepos.reopenRepo(base, rel)
    void loadRepos()
    toasts.push('success', `Reopened repository ${rel}`)
  }

  return {
    repos,
    closedRepos,
    parentRepos,
    reposLoading,
    reposError,
    repoPickerOpen,
    initRepoOpen,
    initRepoPath,
    initRepoDefaultBranch,
    initRepoBusy,
    cloneRepoOpen,
    cloneRepoUrl,
    cloneRepoPath,
    cloneRepoRef,
    cloneRepoRecursive,
    cloneRepoBusy,
    loadRepos,
    initRepo,
    cloneRepo,
    selectRepo,
    openParentRepo,
    closeRepo,
    reopenRepo,
  }
}
