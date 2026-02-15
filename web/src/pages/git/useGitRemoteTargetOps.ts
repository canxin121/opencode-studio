import { ApiError } from '@/lib/api'
import type { Ref } from 'vue'
import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined
type GitValue = unknown
type GitError = unknown

type GitJson = <T = GitValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

type PendingRemoteAction = 'fetch' | 'pull' | 'push'

export function useGitRemoteTargetOps(opts: {
  repoRoot: { value: string | null }
  status: { value: { current?: string | null } | null }
  preferredRemote: () => string

  pushToOpen: Ref<boolean>
  pullFromOpen: Ref<boolean>
  fetchFromOpen: Ref<boolean>
  targetRemote: Ref<string>
  targetBranch: Ref<string>
  targetRef: Ref<string>
  targetSetUpstream: Ref<boolean>

  clearRemoteBranchOptions: () => void
  prefetchRemoteBranches: (remote: string) => void

  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: (err: GitError, op: string, retry: () => Promise<void>) => boolean
  handleGitSso: (err: GitError, action: PendingRemoteAction, retry: () => Promise<void>) => boolean
  load: () => Promise<void>

  isGitAuthError: (err: GitError) => err is ApiError
  openCredentialsDialog: (action: PendingRemoteAction, baseBody: Record<string, JsonValue>, explain: string) => void
  openTerminalHelp: (title: string, explain: string, send: string) => void
}) {
  const {
    repoRoot,
    status,
    preferredRemote,
    pushToOpen,
    pullFromOpen,
    fetchFromOpen,
    targetRemote,
    targetBranch,
    targetRef,
    targetSetUpstream,
    clearRemoteBranchOptions,
    prefetchRemoteBranches,
    toasts,
    gitJson,
    withRepoBusy,
    handleGitBusy,
    handleGitSso,
    load,
    isGitAuthError,
    openCredentialsDialog,
    openTerminalHelp,
  } = opts

  function isProtectedBranchError(err: GitError): err is ApiError {
    return err instanceof ApiError && (err.code || '').trim() === 'git_branch_protected'
  }

  function openPushTo() {
    const rem = preferredRemote()
    targetRemote.value = rem
    targetBranch.value = (status.value?.current || '').trim()
    targetRef.value = ''
    targetSetUpstream.value = false
    clearRemoteBranchOptions()
    prefetchRemoteBranches(rem)
    pushToOpen.value = true
  }

  async function pushToTarget() {
    const dir = repoRoot.value
    const remote = (targetRemote.value || '').trim()
    const branch = (targetBranch.value || '').trim()
    const refspec = (targetRef.value || '').trim()
    if (!dir || !remote || (!branch && !refspec)) return

    const payload: Record<string, unknown> = {
      remote,
      setUpstream: targetSetUpstream.value,
    }
    if (refspec) payload.ref = refspec
    else payload.branch = branch
    const targetLabel = refspec || branch

    await withRepoBusy('Push to', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        toasts.push('success', `Pushed to ${remote}/${targetLabel}`)
        pushToOpen.value = false
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push to', pushToTarget)) return
        if (handleGitSso(err, 'push', pushToTarget)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('push', payload as Record<string, JsonValue>, err.message)
          return
        }
        if (isProtectedBranchError(err)) {
          toasts.push('error', err.message)
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          openTerminalHelp('SSH authentication required', err.message, `git push ${remote} ${targetLabel}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  function openPullFrom() {
    const rem = preferredRemote()
    targetRemote.value = rem
    targetBranch.value = (status.value?.current || '').trim()
    targetRef.value = ''
    clearRemoteBranchOptions()
    prefetchRemoteBranches(rem)
    pullFromOpen.value = true
  }

  function openFetchFrom() {
    const rem = preferredRemote()
    targetRemote.value = rem
    targetBranch.value = (status.value?.current || '').trim()
    targetRef.value = ''
    clearRemoteBranchOptions()
    prefetchRemoteBranches(rem)
    fetchFromOpen.value = true
  }

  async function fetchFromTarget() {
    const dir = repoRoot.value
    const remote = (targetRemote.value || '').trim()
    const branch = (targetBranch.value || '').trim()
    const refspec = (targetRef.value || '').trim()
    if (!dir || !remote || (!branch && !refspec)) return

    const payload: Record<string, unknown> = { remote }
    if (refspec) payload.ref = refspec
    else payload.branch = branch
    const targetLabel = refspec || branch

    await withRepoBusy('Fetch from', async () => {
      try {
        await gitJson('fetch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        toasts.push('success', `Fetched ${remote}/${targetLabel}`)
        fetchFromOpen.value = false
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Fetch from', fetchFromTarget)) return
        if (handleGitSso(err, 'fetch', fetchFromTarget)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('fetch', payload as Record<string, JsonValue>, err.message)
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          openTerminalHelp('SSH authentication required', err.message, `git fetch ${remote} ${targetLabel}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pullFromTarget() {
    const dir = repoRoot.value
    const remote = (targetRemote.value || '').trim()
    const branch = (targetBranch.value || '').trim()
    const refspec = (targetRef.value || '').trim()
    if (!dir || !remote || (!branch && !refspec)) return

    const payload: Record<string, unknown> = { remote }
    if (refspec) payload.ref = refspec
    else payload.branch = branch
    const targetLabel = refspec || branch

    await withRepoBusy('Pull from', async () => {
      try {
        await gitJson('pull', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        toasts.push('success', `Pulled from ${remote}/${targetLabel}`)
        pullFromOpen.value = false
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Pull from', pullFromTarget)) return
        if (handleGitSso(err, 'pull', pullFromTarget)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('pull', payload as Record<string, JsonValue>, err.message)
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          openTerminalHelp('SSH authentication required', err.message, `git pull ${remote} ${targetLabel}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    openPushTo,
    pushToTarget,
    openPullFrom,
    pullFromTarget,
    openFetchFrom,
    fetchFromTarget,
  }
}
