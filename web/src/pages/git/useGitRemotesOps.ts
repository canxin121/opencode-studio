import { computed, ref, type Ref } from 'vue'

import type { GitRemoteInfoResponse } from '@/types/git'
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

export function useGitRemotesOps(opts: {
  repoRoot: Ref<string | null>
  remoteInfo: Ref<GitRemoteInfoResponse | null>
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
}) {
  const { repoRoot, remoteInfo, gitJson, toasts, withRepoBusy, handleGitBusy } = opts

  const remotesOpen = ref(false)
  const remotesLoading = ref(false)
  const remotesError = ref<string | null>(null)

  const newRemoteName = ref('')
  const newRemoteUrl = ref('')
  const selectedRemote = ref('')
  const renameRemoteTo = ref('')
  const setRemoteUrl = ref('')

  const remotesList = computed(() => remoteInfo.value?.remotes || [])

  async function loadRemotes() {
    const dir = repoRoot.value
    if (!dir) return
    remotesLoading.value = true
    remotesError.value = null
    try {
      const resp = await gitJson<GitRemoteInfoResponse>('remote-info', dir)
      remoteInfo.value = resp
      if (!selectedRemote.value) {
        selectedRemote.value = resp.remotes?.[0]?.name || ''
      }
    } catch (err) {
      remotesError.value = err instanceof Error ? err.message : String(err)
    } finally {
      remotesLoading.value = false
    }
  }

  function openRemotes() {
    remotesOpen.value = true
    void loadRemotes()
  }

  async function addRemote() {
    const dir = repoRoot.value
    if (!dir) return
    const name = newRemoteName.value.trim()
    const url = newRemoteUrl.value.trim()
    if (!name || !url) return

    await withRepoBusy('Add remote', async () => {
      try {
        await gitJson('remotes', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, url }),
        })
        toasts.push('success', `Added remote ${name}`)
        newRemoteName.value = ''
        newRemoteUrl.value = ''
        await loadRemotes()
      } catch (err) {
        if (handleGitBusy(err, 'Add remote', addRemote)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function renameRemote() {
    const dir = repoRoot.value
    if (!dir) return
    const name = selectedRemote.value.trim()
    const newName = renameRemoteTo.value.trim()
    if (!name || !newName) return

    await withRepoBusy('Rename remote', async () => {
      try {
        await gitJson('remotes', dir, undefined, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, newName }),
        })
        toasts.push('success', `Renamed ${name} -> ${newName}`)
        selectedRemote.value = newName
        renameRemoteTo.value = ''
        await loadRemotes()
      } catch (err) {
        if (handleGitBusy(err, 'Rename remote', renameRemote)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function updateRemoteUrl() {
    const dir = repoRoot.value
    if (!dir) return
    const name = selectedRemote.value.trim()
    const url = setRemoteUrl.value.trim()
    if (!name || !url) return

    await withRepoBusy('Update remote URL', async () => {
      try {
        await gitJson('remotes/set-url', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, url }),
        })
        toasts.push('success', `Updated ${name} URL`)
        setRemoteUrl.value = ''
        await loadRemotes()
      } catch (err) {
        if (handleGitBusy(err, 'Update remote URL', updateRemoteUrl)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function removeRemote(name: string) {
    const dir = repoRoot.value
    if (!dir) return
    const n = (name || '').trim()
    if (!n) return

    await withRepoBusy('Remove remote', async () => {
      try {
        await gitJson('remotes', dir, undefined, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: n }),
        })
        toasts.push('success', `Removed remote ${n}`)
        if (selectedRemote.value === n) selectedRemote.value = ''
        await loadRemotes()
      } catch (err) {
        if (handleGitBusy(err, 'Remove remote', () => removeRemote(name))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    remotesOpen,
    remotesLoading,
    remotesError,
    remotesList,
    newRemoteName,
    newRemoteUrl,
    selectedRemote,
    renameRemoteTo,
    setRemoteUrl,
    loadRemotes,
    openRemotes,
    addRemote,
    renameRemote,
    updateRemoteUrl,
    removeRemote,
  }
}
