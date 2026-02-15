import { ref } from 'vue'

import type { GitLfsLockInfo, GitLfsLocksResponse, GitLfsStatusResponse } from '@/types/git'
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

export function useGitLfsOps(opts: {
  repoRoot: { value: string | null }
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
}) {
  const { repoRoot, gitJson, toasts, withRepoBusy, handleGitBusy } = opts

  const lfsOpen = ref(false)
  const lfsLoading = ref(false)
  const lfsError = ref<string | null>(null)
  const lfsInstalled = ref(false)
  const lfsVersion = ref<string | null>(null)
  const lfsTracked = ref<string[]>([])

  const lfsLocks = ref<GitLfsLockInfo[]>([])
  const lfsLocksLoading = ref(false)

  const lfsTrackPattern = ref('')
  const lfsLockPath = ref('')

  async function loadLfsStatus() {
    const dir = repoRoot.value
    if (!dir) return
    lfsLoading.value = true
    lfsError.value = null
    try {
      const resp = await gitJson<GitLfsStatusResponse>('lfs', dir)
      lfsInstalled.value = Boolean(resp?.installed)
      lfsVersion.value = resp?.version ?? null
      lfsTracked.value = Array.isArray(resp?.tracked) ? resp.tracked : []
    } catch (err) {
      lfsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      lfsLoading.value = false
    }
  }

  async function loadLfsLocks() {
    const dir = repoRoot.value
    if (!dir) return
    lfsLocksLoading.value = true
    try {
      const resp = await gitJson<GitLfsLocksResponse>('lfs/locks', dir)
      lfsLocks.value = Array.isArray(resp?.locks) ? resp.locks : []
    } catch (err) {
      lfsLocks.value = []
      lfsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      lfsLocksLoading.value = false
    }
  }

  async function refreshLfs() {
    await loadLfsStatus()
    await loadLfsLocks()
  }

  function openLfs() {
    lfsOpen.value = true
    void refreshLfs()
  }

  async function installLfs() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('LFS install', async () => {
      try {
        await gitJson('lfs/install', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force: false }),
        })
        toasts.push('success', 'Git LFS installed for repo')
        await loadLfsStatus()
      } catch (err) {
        if (handleGitBusy(err, 'LFS install', installLfs)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function trackLfsPattern() {
    const dir = repoRoot.value
    if (!dir) return
    const pattern = lfsTrackPattern.value.trim()
    if (!pattern) return
    await withRepoBusy('LFS track', async () => {
      try {
        await gitJson('lfs/track', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pattern }),
        })
        toasts.push('success', `Tracked ${pattern}`)
        lfsTrackPattern.value = ''
        await loadLfsStatus()
      } catch (err) {
        if (handleGitBusy(err, 'LFS track', trackLfsPattern)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function lockLfsPath() {
    const dir = repoRoot.value
    if (!dir) return
    const path = lfsLockPath.value.trim()
    if (!path) return
    await withRepoBusy('LFS lock', async () => {
      try {
        await gitJson('lfs/lock', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        toasts.push('success', `Locked ${path}`)
        lfsLockPath.value = ''
        await loadLfsLocks()
      } catch (err) {
        if (handleGitBusy(err, 'LFS lock', lockLfsPath)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function unlockLfsPath(path: string, force = false) {
    const dir = repoRoot.value
    if (!dir) return
    const p = (path || '').trim()
    if (!p) return
    await withRepoBusy('LFS unlock', async () => {
      try {
        await gitJson('lfs/unlock', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p, force }),
        })
        toasts.push('success', `Unlocked ${p}`)
        await loadLfsLocks()
      } catch (err) {
        if (handleGitBusy(err, 'LFS unlock', () => unlockLfsPath(p, force))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    lfsOpen,
    lfsLoading,
    lfsError,
    lfsInstalled,
    lfsVersion,
    lfsTracked,
    lfsLocks,
    lfsLocksLoading,
    lfsTrackPattern,
    lfsLockPath,
    openLfs,
    refreshLfs,
    installLfs,
    trackLfsPattern,
    lockLfsPath,
    unlockLfsPath,
  }
}
