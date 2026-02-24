import { ApiError } from '@/lib/api'
import type { JsonObject, JsonValue } from '@/types/json'
import { i18n } from '@/i18n'
import type { ToastAction } from '@/stores/toasts'

type ToastKind = 'info' | 'success' | 'error'
type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number, action?: ToastAction) => void }

type PendingRemoteAction = 'fetch' | 'pull' | 'push'
type GitError = unknown

type GitAuthBody = {
  auth?: {
    username: string
    password: string
  }
}

type GitRemoteBody = GitAuthBody &
  JsonObject & {
    remote?: string
    prune?: boolean
    all?: boolean
    rebase?: boolean
    tags?: boolean
    force?: '' | 'force' | 'force-with-lease'
    followTags?: boolean
  }

type GitCreateGithubRepoAndPushBody = {
  name?: string
  remote?: string
  private?: boolean
}

type GitCreateGithubRepoAndPushResult = {
  success: boolean
  remote: string
  branch: string
  fullName: string
}

export function useGitRemoteOps(opts: {
  repoRoot: { value: string | null }
  allowForcePush: { value: boolean }
  preferredRemote: () => string
  isGithubRemote: () => boolean
  githubToken: { value: string }

  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: (err: GitError, op: string, retry: () => Promise<void>) => boolean
  handleGitSso: (err: GitError, action: PendingRemoteAction, retry: () => Promise<void>) => boolean
  load: () => Promise<void>

  isGitAuthError: (err: GitError) => err is ApiError
  openCredentialsDialog: (action: PendingRemoteAction, baseBody: GitRemoteBody, explain: string) => void
  openTerminalHelp: (title: string, explain: string, send: string) => void
  terminalCommandForRemoteAction: (action: PendingRemoteAction) => string
}) {
  const {
    repoRoot,
    allowForcePush,
    preferredRemote,
    isGithubRemote,
    githubToken,
    toasts,
    gitJson,
    withRepoBusy,
    handleGitBusy,
    handleGitSso,
    load,
    isGitAuthError,
    openCredentialsDialog,
    openTerminalHelp,
    terminalCommandForRemoteAction,
  } = opts

  function isProtectedBranchError(err: GitError): err is ApiError {
    return err instanceof ApiError && (err.code || '').trim() === 'git_branch_protected'
  }

  function handleProtectedBranchError(err: GitError): boolean {
    if (!isProtectedBranchError(err)) return false
    toasts.push('error', err.message)
    return true
  }

  function githubAuthBody(): GitAuthBody {
    const baseBody: GitAuthBody = {}
    if (isGithubRemote() && githubToken.value.trim()) {
      baseBody.auth = { username: 'x-access-token', password: githubToken.value.trim() }
    }
    return baseBody
  }

  function isNoRemoteOrUpstreamError(err: GitError): err is ApiError {
    if (!(err instanceof ApiError)) return false
    const code = (err.code || '').trim()
    return code === 'git_no_upstream' || code === 'git_remote_not_found'
  }

  async function createGithubRepoAndPush(body: GitCreateGithubRepoAndPushBody = {}): Promise<boolean> {
    const dir = repoRoot.value
    if (!dir) return false

    let succeeded = false
    await withRepoBusy('Create GitHub repo + push', async () => {
      try {
        const created = await gitJson<GitCreateGithubRepoAndPushResult>('create-github-repo-and-push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ private: true, remote: preferredRemote(), ...body }),
        })
        toasts.push('success', i18n.global.t('git.toasts.createdGithubRepoAndPushed', { fullName: created.fullName }))
        await load()
        succeeded = true
      } catch (err) {
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
    return succeeded
  }

  function maybeOfferCreateGithubRepo(err: GitError): boolean {
    if (!isNoRemoteOrUpstreamError(err)) return false
    toasts.push('error', i18n.global.t('git.toasts.pushNeedsRemoteSetup'), 9000, {
      label: i18n.global.t('git.toasts.createGithubRepoAction'),
      onClick: () => {
        void createGithubRepoAndPush()
      },
    })
    return true
  }

  async function fetchRemote(opts: { silent?: boolean } = {}) {
    const dir = repoRoot.value
    if (!dir) return
    const silent = Boolean(opts.silent)
    const baseBody: GitRemoteBody = { remote: preferredRemote(), ...githubAuthBody() }
    await withRepoBusy('Fetch', async () => {
      try {
        await gitJson('fetch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        if (!silent) toasts.push('success', i18n.global.t('git.toasts.fetched'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Fetch', () => fetchRemote(opts))) return
        if (handleGitSso(err, 'fetch', () => fetchRemote(opts))) return
        if (isGitAuthError(err)) {
          if (!silent) toasts.push('error', i18n.global.t('git.toasts.authenticationRequiredForAction', { action: 'fetch' }))
          if (!silent) openCredentialsDialog('fetch', baseBody, err.message)
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          if (!silent) {
            toasts.push('error', i18n.global.t('git.toasts.sshAuthenticationRequiredForAction', { action: 'fetch' }))
            openTerminalHelp('SSH authentication required', err.message, terminalCommandForRemoteAction('fetch'))
          }
          return
        }
        if (!silent) toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function fetchPrune() {
    const dir = repoRoot.value
    if (!dir) return
    const baseBody: GitRemoteBody = { remote: preferredRemote(), prune: true, ...githubAuthBody() }
    await withRepoBusy('Fetch prune', async () => {
      try {
        await gitJson('fetch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.fetchedPrune'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Fetch prune', fetchPrune)) return
        if (handleGitSso(err, 'fetch', fetchPrune)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('fetch', baseBody, err.message)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function fetchAll() {
    const dir = repoRoot.value
    if (!dir) return
    const baseBody: GitRemoteBody = { all: true, ...githubAuthBody() }
    await withRepoBusy('Fetch all', async () => {
      try {
        await gitJson('fetch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.fetchedAll'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Fetch all', fetchAll)) return
        if (handleGitSso(err, 'fetch', fetchAll)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('fetch', baseBody, err.message)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pull() {
    const dir = repoRoot.value
    if (!dir) return
    // Prefer upstream-based pull (VS Code parity). The server will handle defaults.
    const baseBody: GitRemoteBody = { ...githubAuthBody() }
    await withRepoBusy('Pull', async () => {
      try {
        await gitJson('pull', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pulled'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Pull', pull)) return
        if (handleGitSso(err, 'pull', pull)) return
        if (isGitAuthError(err)) {
          toasts.push('error', i18n.global.t('git.toasts.authenticationRequiredForAction', { action: 'pull' }))
          openCredentialsDialog('pull', baseBody, err.message)
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          toasts.push('error', i18n.global.t('git.toasts.sshAuthenticationRequiredForAction', { action: 'pull' }))
          openTerminalHelp('SSH authentication required', err.message, terminalCommandForRemoteAction('pull'))
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pullRebase() {
    const dir = repoRoot.value
    if (!dir) return
    const baseBody: GitRemoteBody = { rebase: true, ...githubAuthBody() }
    await withRepoBusy('Pull (rebase)', async () => {
      try {
        await gitJson('pull', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pulledRebase'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Pull (rebase)', pullRebase)) return
        if (handleGitSso(err, 'pull', pullRebase)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('pull', baseBody, err.message)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function push() {
    const dir = repoRoot.value
    if (!dir) return
    // Prefer upstream-based push (VS Code parity). If no upstream exists, the server will publish.
    const baseBody: GitRemoteBody = { ...githubAuthBody() }
    await withRepoBusy('Push', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pushed'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push', push)) return
        if (handleGitSso(err, 'push', push)) return
        if (isGitAuthError(err)) {
          toasts.push('error', i18n.global.t('git.toasts.authenticationRequiredForAction', { action: 'push' }))
          openCredentialsDialog('push', baseBody, err.message)
          return
        }
        if (maybeOfferCreateGithubRepo(err)) return
        if (handleProtectedBranchError(err)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          toasts.push('error', i18n.global.t('git.toasts.sshAuthenticationRequiredForAction', { action: 'push' }))
          openTerminalHelp('SSH authentication required', err.message, terminalCommandForRemoteAction('push'))
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pushTags(forceMode: '' | 'force' | 'force-with-lease' = '') {
    const dir = repoRoot.value
    if (!dir) return
    if (forceMode && !allowForcePush.value) {
      toasts.push('error', i18n.global.t('git.errors.forcePushDisabledByPolicy'))
      return
    }
    const baseBody: GitRemoteBody = { tags: true, force: forceMode || '', ...githubAuthBody() }
    await withRepoBusy('Push tags', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pushedTags'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push tags', () => pushTags(forceMode))) return
        if (handleGitSso(err, 'push', () => pushTags(forceMode))) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('push', baseBody, err.message)
          return
        }
        if (handleProtectedBranchError(err)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pushFollowTags() {
    const dir = repoRoot.value
    if (!dir) return
    const baseBody: GitRemoteBody = { followTags: true, ...githubAuthBody() }
    await withRepoBusy('Push (follow tags)', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pushedFollowTags'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push (follow tags)', pushFollowTags)) return
        if (handleGitSso(err, 'push', pushFollowTags)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('push', baseBody, err.message)
          return
        }
        if (handleProtectedBranchError(err)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pushForce() {
    const dir = repoRoot.value
    if (!dir) return
    if (!allowForcePush.value) {
      toasts.push('error', i18n.global.t('git.errors.forcePushDisabledByPolicy'))
      return
    }
    const baseBody: GitRemoteBody = { force: 'force', ...githubAuthBody() }
    await withRepoBusy('Push (force)', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pushedForce'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push (force)', pushForce)) return
        if (handleGitSso(err, 'push', pushForce)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('push', baseBody, err.message)
          return
        }
        if (handleProtectedBranchError(err)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pushForceWithLease() {
    const dir = repoRoot.value
    if (!dir) return
    if (!allowForcePush.value) {
      toasts.push('error', i18n.global.t('git.errors.forcePushDisabledByPolicy'))
      return
    }
    const baseBody: GitRemoteBody = { force: 'force-with-lease', ...githubAuthBody() }
    await withRepoBusy('Push (force-with-lease)', async () => {
      try {
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        toasts.push('success', i18n.global.t('git.toasts.pushedForceWithLease'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Push (force-with-lease)', pushForceWithLease)) return
        if (handleGitSso(err, 'push', pushForceWithLease)) return
        if (isGitAuthError(err)) {
          openCredentialsDialog('push', baseBody, err.message)
          return
        }
        if (handleProtectedBranchError(err)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function sync(opts: { silent?: boolean } = {}) {
    const dir = repoRoot.value
    if (!dir) return
    const silent = Boolean(opts.silent)
    const baseBody: GitRemoteBody = { ...githubAuthBody() }

    await withRepoBusy('Sync', async () => {
      try {
        await gitJson('pull', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        if (!silent) toasts.push('success', i18n.global.t('git.toasts.synced'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Sync', () => sync(opts))) return
        if (handleGitSso(err, 'pull', () => sync(opts))) return
        if (isGitAuthError(err)) {
          toasts.push('error', i18n.global.t('git.toasts.authenticationRequiredForAction', { action: 'sync' }))
          // First failing step requires credentials. After that, user can hit Sync again.
          if (!silent) openCredentialsDialog('pull', baseBody, err.message)
          return
        }
        if (!silent && maybeOfferCreateGithubRepo(err)) return
        if (handleProtectedBranchError(err)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          if (!silent) {
            toasts.push('error', i18n.global.t('git.toasts.sshAuthenticationRequiredForAction', { action: 'sync' }))
            openTerminalHelp('SSH authentication required', err.message, 'git pull && git push')
          }
          return
        }
        if (!silent) toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function syncRebase(opts: { silent?: boolean } = {}) {
    const dir = repoRoot.value
    if (!dir) return
    const silent = Boolean(opts.silent)
    const baseBody: GitRemoteBody = { ...githubAuthBody() }
    const pullBody: GitRemoteBody = { ...baseBody, rebase: true }

    await withRepoBusy('Sync (rebase)', async () => {
      try {
        await gitJson('pull', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pullBody),
        })
        await gitJson('push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
        if (!silent) toasts.push('success', i18n.global.t('git.toasts.syncedRebase'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Sync (rebase)', () => syncRebase(opts))) return
        if (handleGitSso(err, 'pull', () => syncRebase(opts))) return
        if (isGitAuthError(err)) {
          toasts.push('error', i18n.global.t('git.toasts.authenticationRequiredForAction', { action: 'sync' }))
          if (!silent) openCredentialsDialog('pull', pullBody, err.message)
          return
        }
        if (!silent && maybeOfferCreateGithubRepo(err)) return
        if (handleProtectedBranchError(err)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
          if (!silent) {
            toasts.push('error', i18n.global.t('git.toasts.sshAuthenticationRequiredForAction', { action: 'sync' }))
            openTerminalHelp('SSH authentication required', err.message, 'git pull --rebase && git push')
          }
          return
        }
        if (!silent) toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    fetchRemote,
    fetchPrune,
    fetchAll,
    pull,
    pullRebase,
    push,
    pushTags,
    pushFollowTags,
    pushForce,
    pushForceWithLease,
    sync,
    syncRebase,
  }
}
