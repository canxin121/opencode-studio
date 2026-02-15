import { ref } from 'vue'

import type { GitSubmoduleInfo, GitSubmoduleListResponse } from '@/types/git'
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

export function useGitSubmoduleOps(opts: {
  repoRoot: { value: string | null }
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
}) {
  const { repoRoot, gitJson, toasts, withRepoBusy, handleGitBusy } = opts

  const submodulesOpen = ref(false)
  const submodulesLoading = ref(false)
  const submodules = ref<GitSubmoduleInfo[]>([])
  const submodulesError = ref<string | null>(null)

  const newSubmoduleUrl = ref('')
  const newSubmodulePath = ref('')
  const newSubmoduleBranch = ref('')

  async function loadSubmodules() {
    const dir = repoRoot.value
    if (!dir) return
    submodulesLoading.value = true
    submodulesError.value = null
    try {
      const resp = await gitJson<GitSubmoduleListResponse>('submodules', dir)
      submodules.value = Array.isArray(resp?.submodules) ? resp.submodules : []
    } catch (err) {
      submodules.value = []
      submodulesError.value = err instanceof Error ? err.message : String(err)
    } finally {
      submodulesLoading.value = false
    }
  }

  function openSubmodules() {
    submodulesOpen.value = true
    void loadSubmodules()
  }

  async function addSubmodule() {
    const dir = repoRoot.value
    if (!dir) return
    const url = newSubmoduleUrl.value.trim()
    const path = newSubmodulePath.value.trim()
    const branch = newSubmoduleBranch.value.trim()
    if (!url || !path) return

    await withRepoBusy('Add submodule', async () => {
      try {
        await gitJson('submodules/add', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, path, branch: branch || null }),
        })
        toasts.push('success', `Added submodule ${path}`)
        newSubmoduleUrl.value = ''
        newSubmodulePath.value = ''
        newSubmoduleBranch.value = ''
        await loadSubmodules()
      } catch (err) {
        if (handleGitBusy(err, 'Add submodule', addSubmodule)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function initSubmodule(path: string) {
    const dir = repoRoot.value
    if (!dir) return
    const p = (path || '').trim()
    if (!p) return
    await withRepoBusy('Init submodule', async () => {
      try {
        await gitJson('submodules/init', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p }),
        })
        toasts.push('success', `Initialized ${p}`)
      } catch (err) {
        if (handleGitBusy(err, 'Init submodule', () => initSubmodule(p))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function updateSubmodule(path: string, recursive = false, init = false) {
    const dir = repoRoot.value
    if (!dir) return
    const p = (path || '').trim()
    await withRepoBusy('Update submodule', async () => {
      try {
        await gitJson('submodules/update', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p || null, recursive, init }),
        })
        toasts.push('success', p ? `Updated ${p}` : 'Updated submodules')
      } catch (err) {
        if (handleGitBusy(err, 'Update submodule', () => updateSubmodule(p, recursive, init))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    submodulesOpen,
    submodulesLoading,
    submodules,
    submodulesError,
    newSubmoduleUrl,
    newSubmodulePath,
    newSubmoduleBranch,
    openSubmodules,
    loadSubmodules,
    addSubmodule,
    initSubmodule,
    updateSubmodule,
  }
}
