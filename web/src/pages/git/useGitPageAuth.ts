import { computed, ref, type Ref } from 'vue'
import type { Router } from 'vue-router'

import { ApiError } from '@/lib/api'
import { stageTrustedTerminalHandoff } from '@/lib/terminalHandoff'
import { useGitCredentialsDialogs } from '@/composables/git/useGitCredentialsDialogs'
import type { JsonValue } from '@/types/json'

type PendingRemoteAction = 'fetch' | 'pull' | 'push'

type ToastKind = 'info' | 'success' | 'error'
type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type GitError = unknown

type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

type StatusLike = { tracking?: string | null }
type RemoteEntry = { name?: string; host?: string | null }
type RemoteInfoLike = { remotes?: RemoteEntry[] }
type SigningInfoLike = { gpgFormat?: string | null }

const SAFE_GIT_TOKEN_RE = /^[A-Za-z0-9._/@:+={}~^-]+$/
const SAFE_COMMIT_HASH_RE = /^[0-9a-fA-F]{7,40}$/
const GIT_COMMIT_TERMINAL_CMD_RE =
  /^git commit(?: --no-verify)?(?: --signoff)?(?: --amend)?(?: --no-gpg-sign)? -m '(?:[^']|'"'"')*'$/

function isSafeGitToken(token: string): boolean {
  const t = (token || '').trim()
  return Boolean(t) && SAFE_GIT_TOKEN_RE.test(t)
}

function isWhitelistedGitTerminalCommand(raw: string): boolean {
  const cmd = (raw || '').trim()
  if (!cmd) return false

  if (cmd === 'git pull && git push') return true
  if (GIT_COMMIT_TERMINAL_CMD_RE.test(cmd)) return true

  if (/\r|\n|\t/.test(cmd)) return false

  const parts = cmd.split(/\s+/)
  if (parts.length < 2) return false
  if (parts[0] !== 'git') return false

  const op = parts[1]

  if ((op === 'fetch' || op === 'pull' || op === 'push') && parts.length === 2) {
    return true
  }

  if ((op === 'fetch' || op === 'pull' || op === 'push') && parts.length === 4) {
    const remote = parts[2] ?? ''
    const branch = parts[3] ?? ''
    return isSafeGitToken(remote) && isSafeGitToken(branch)
  }

  if ((op === 'merge' || op === 'rebase') && parts.length === 3) {
    const arg = parts[2] ?? ''
    return arg === '--continue' || isSafeGitToken(arg)
  }

  if ((op === 'cherry-pick' || op === 'revert') && parts.length === 3) {
    const arg = parts[2] ?? ''
    return arg === '--continue' || SAFE_COMMIT_HASH_RE.test(arg)
  }

  if (op === 'stash' && parts.length === 5 && parts[2] === 'branch') {
    const branch = parts[3] ?? ''
    const source = parts[4] ?? ''
    return isSafeGitToken(branch) && isSafeGitToken(source)
  }

  return false
}

export function useGitPageAuth(opts: {
  router: Router
  toasts: Toasts
  repoRoot: Ref<string | null>
  repoKey: (suffix: string) => string
  gitJson: GitJson
  status: Ref<StatusLike | null>
  remoteInfo: Ref<RemoteInfoLike | null>
  signingInfo: Ref<SigningInfoLike | null>
  // Optional: sync "committing" UI state owned by GitPage.
  committing?: Ref<boolean>
  // Optional: run page-owned side effects after a successful commit.
  onCommitSuccess?: (message: string) => void
  // Commit toggles influence terminal fallback commands.
  commitNoVerify: Ref<boolean>
  commitSignoff: Ref<boolean>
  commitAmend: Ref<boolean>
  commitNoGpgSign: Ref<boolean>
  // Called after successful auth / git ops.
  load: () => Promise<void>
}) {
  const {
    router,
    toasts,
    repoRoot,
    repoKey,
    gitJson,
    status,
    remoteInfo,
    signingInfo,
    committing,
    onCommitSuccess,
    commitNoVerify,
    commitSignoff,
    commitAmend,
    commitNoGpgSign,
    load,
  } = opts

  const {
    credDialogOpen,
    credAction,
    credBaseBody,
    credUsername,
    credPassword,
    credExplain,
    openCredentialsDialog: openCredentialsDialogBase,
  } = useGitCredentialsDialogs()

  // Default username aligns with GitHub PAT flows.
  credUsername.value = 'x-access-token'

  // Optional: store a GitHub token per repo for seamless auth (VS Code-like auth provider).
  const githubToken = ref('')
  const githubTokenRemember = ref(true)

  // Escape hatch: some git flows are inherently interactive (SSH passphrase, SSO flows, pinentry).
  const terminalHelpOpen = ref(false)
  const terminalHelpTitle = ref('')
  const terminalHelpExplain = ref('')
  const terminalHelpSend = ref('')

  const gpgDialogOpen = ref(false)
  const gpgPassphrase = ref('')
  const gpgExplain = ref<string>('')
  const pendingCommitMessage = ref<string>('')

  const gpgMissingDialogOpen = ref(false)
  const gpgMissingExplain = ref<string>('')
  const gpgSigningKeyInput = ref('')
  const gpgMissingBusy = ref(false)

  const gpgEnableDialogOpen = ref(false)
  const gpgEnableBusy = ref(false)
  const gpgEnableExplain = ref<string>('')

  function isGitAuthError(err: GitError): err is ApiError {
    return err instanceof ApiError && (err.code || '').trim() === 'git_auth_required'
  }

  function isGitSsoError(err: GitError): err is ApiError {
    return err instanceof ApiError && (err.code || '').trim() === 'git_auth_sso_required'
  }

  function isGpgPassphraseError(err: GitError): err is ApiError {
    if (!(err instanceof ApiError)) return false
    // If signing is configured as SSH, a GPG passphrase dialog is not helpful.
    const fmt = (signingInfo.value?.gpgFormat || 'openpgp').toLowerCase()
    if (fmt && fmt !== 'openpgp') return false
    const code = (err.code || '').trim()
    return code === 'gpg_pinentry' || code === 'gpg_sign_failed'
  }

  function isGpgNoKeyError(err: GitError): err is ApiError {
    if (!(err instanceof ApiError)) return false
    const code = (err.code || '').trim()
    return code === 'gpg_no_secret_key' || code === 'gpg_keys_unavailable'
  }

  function isGitBusyError(err: GitError): err is ApiError {
    return err instanceof ApiError && (err.code || '').trim() === 'git_busy'
  }

  const repoBusy = ref(false)
  const repoBusyOp = ref('')

  const gitBusyDialogOpen = ref(false)
  const gitBusyTitle = ref('Repository busy')
  const gitBusyExplain = ref('')
  let gitBusyRetry: (() => Promise<void>) | null = null

  const ssoDialogOpen = ref(false)
  const ssoExplain = ref('')
  const ssoAction = ref<PendingRemoteAction | null>(null)
  let ssoRetry: (() => Promise<void>) | null = null

  function openGitBusyDialog(op: string, err: GitError, retry: () => Promise<void>) {
    gitBusyTitle.value = `Repository busy (${op})`
    gitBusyExplain.value = err instanceof Error ? err.message : String(err)
    gitBusyRetry = retry
    gitBusyDialogOpen.value = true
  }

  function handleGitBusy(err: GitError, op: string, retry: () => Promise<void>): boolean {
    if (!isGitBusyError(err)) return false
    openGitBusyDialog(op, err, retry)
    return true
  }

  function openGitSsoDialog(action: PendingRemoteAction, err: GitError, retry: () => Promise<void>) {
    ssoAction.value = action
    ssoExplain.value = err instanceof Error ? err.message : String(err)
    ssoRetry = retry
    ssoDialogOpen.value = true
  }

  function handleGitSso(err: GitError, action: PendingRemoteAction, retry: () => Promise<void>): boolean {
    if (!isGitSsoError(err)) return false
    openGitSsoDialog(action, err, retry)
    return true
  }

  async function retryGitSso() {
    const fn = ssoRetry
    ssoRetry = null
    ssoDialogOpen.value = false
    ssoExplain.value = ''
    ssoAction.value = null
    if (fn) await fn()
  }

  function dismissGitSsoDialog() {
    ssoRetry = null
    ssoDialogOpen.value = false
    ssoExplain.value = ''
    ssoAction.value = null
  }

  async function retryGitBusy() {
    const fn = gitBusyRetry
    gitBusyRetry = null
    gitBusyDialogOpen.value = false
    gitBusyExplain.value = ''
    if (fn) await fn()
  }

  function dismissGitBusyDialog() {
    gitBusyRetry = null
    gitBusyDialogOpen.value = false
    gitBusyExplain.value = ''
  }

  async function withRepoBusy(op: string, fn: () => Promise<void>) {
    if (repoBusy.value) {
      const cur = (repoBusyOp.value || '').trim() || 'git operation'
      toasts.push('info', `Repository busy (${cur})`, 2000)
      return
    }
    repoBusy.value = true
    repoBusyOp.value = op
    try {
      await fn()
    } finally {
      repoBusyOp.value = ''
      repoBusy.value = false
    }
  }

  function preferredRemote(): string {
    const trk = status.value?.tracking
    if (typeof trk === 'string' && trk.includes('/')) {
      const parts = trk.split('/')
      const r = (parts[0] ?? '').trim()
      if (r) return r
    }
    const list = remoteInfo.value?.remotes || []
    if (list.some((r: RemoteEntry) => r.name === 'origin')) return 'origin'
    if (list[0]?.name) return list[0].name
    return 'origin'
  }

  function remoteHostForName(name: string): string {
    const r = (remoteInfo.value?.remotes || []).find((x: RemoteEntry) => x.name === name)
    const host = (r?.host || '').trim()
    return host
  }

  type AuthProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'generic'
  function guessAuthProvider(host: string): AuthProvider {
    const h = (host || '').toLowerCase()
    if (h.includes('github.com')) return 'github'
    if (h.includes('gitlab.com')) return 'gitlab'
    if (h.includes('bitbucket.org')) return 'bitbucket'
    if (h.includes('dev.azure.com') || h.includes('visualstudio.com')) return 'azure'
    return 'generic'
  }

  function isGithubRemote(): boolean {
    const host = remoteHostForName(preferredRemote())
    return guessAuthProvider(host) === 'github'
  }

  function defaultUsernameForHost(host: string): string {
    const p = guessAuthProvider(host)
    if (p === 'github') return 'x-access-token'
    if (p === 'gitlab') return 'oauth2'
    if (p === 'bitbucket') return 'x-token-auth'
    // Many providers accept an arbitrary non-empty username for PAT.
    return 'token'
  }

  const authHelpText = computed(() => {
    const host = remoteHostForName(preferredRemote())
    const p = guessAuthProvider(host)
    if (p === 'github') return "GitHub HTTPS: username 'x-access-token', password = a Personal Access Token (PAT)."
    if (p === 'gitlab') return "GitLab HTTPS: username 'oauth2', password = a Personal Access Token."
    if (p === 'bitbucket') return "Bitbucket HTTPS: username 'x-token-auth', password = an app password/token."
    if (p === 'azure') return 'Azure DevOps HTTPS: password = PAT. Username can be anything non-empty.'
    return 'HTTPS remotes typically require a username + token (PAT) instead of a password.'
  })

  function loadGithubTokenForRepo() {
    try {
      githubToken.value = localStorage.getItem(repoKey('githubToken')) || ''
    } catch {
      githubToken.value = ''
    }
  }

  function saveGithubTokenForRepo() {
    try {
      if (!githubTokenRemember.value) return
      if (!githubToken.value.trim()) {
        localStorage.removeItem(repoKey('githubToken'))
        return
      }
      localStorage.setItem(repoKey('githubToken'), githubToken.value)
    } catch {
      // ignore
    }
  }

  function openCredentialsDialog(action: PendingRemoteAction, baseBody: Record<string, JsonValue>, explain: string) {
    // Auto-suggest provider-specific username based on remote host.
    const host = remoteHostForName(preferredRemote())
    const suggested = defaultUsernameForHost(host)
    if (
      suggested &&
      (!credUsername.value || credUsername.value === 'x-access-token' || credUsername.value === 'token')
    ) {
      credUsername.value = suggested
    }
    if (guessAuthProvider(host) === 'github' && githubToken.value.trim()) {
      credUsername.value = 'x-access-token'
      credPassword.value = githubToken.value.trim()
    }
    openCredentialsDialogBase(action, baseBody, explain)
  }

  function openTerminalHelp(title: string, explain: string, send: string) {
    terminalHelpTitle.value = title
    terminalHelpExplain.value = explain
    terminalHelpSend.value = send
    terminalHelpOpen.value = true
  }

  function shellEscapeSingleQuotes(s: string): string {
    return s.replace(/'/g, `"'"'"'`)
  }

  function openGitTerminalWithCommand(repoDir: string, gitCmd: string) {
    const dir = (repoDir || '').trim()
    const cmd = (gitCmd || '').trim()
    if (!dir || !cmd) return
    if (/\r|\n/.test(dir)) {
      toasts.push('error', 'Blocked terminal command: unsupported repository path')
      return
    }
    if (!isWhitelistedGitTerminalCommand(cmd)) {
      toasts.push('error', 'Blocked terminal command outside trusted allowlist')
      return
    }

    const send = `cd '${shellEscapeSingleQuotes(dir)}'\n${cmd}`
    const sendToken = stageTrustedTerminalHandoff(send, { target: 'git' })
    if (!sendToken) {
      toasts.push('error', 'Failed to prepare terminal command handoff')
      return
    }

    void router.push({ path: '/terminal', query: { sendToken } })
  }

  function terminalCommandForRemoteAction(action: PendingRemoteAction): string {
    if (action === 'fetch') return `git fetch`
    if (action === 'pull') return `git pull`
    return `git push`
  }

  function terminalCommandForCommit(message: string): string {
    const msg = (message || '').trim()
    const quoted = `'${shellEscapeSingleQuotes(msg)}'`
    const args: string[] = ['git', 'commit']
    if (commitNoVerify.value) args.push('--no-verify')
    if (commitSignoff.value) args.push('--signoff')
    if (commitAmend.value) args.push('--amend')
    if (commitNoGpgSign.value) args.push('--no-gpg-sign')
    args.push('-m', quoted)
    return args.join(' ')
  }

  async function disableRepoGpgSigning() {
    const dir = repoRoot.value
    if (!dir) return
    gpgMissingBusy.value = true
    try {
      await gitJson('gpg/disable-signing', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      toasts.push('success', 'Disabled GPG signing for this repository')
      gpgMissingDialogOpen.value = false
      await load()
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      gpgMissingBusy.value = false
    }
  }

  async function setRepoSigningKey() {
    const dir = repoRoot.value
    const key = (gpgSigningKeyInput.value || '').trim()
    if (!dir || !key) return
    gpgMissingBusy.value = true
    try {
      await gitJson('gpg/set-signing-key', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signingKey: key }),
      })
      toasts.push('success', 'Updated user.signingkey (local)')
      await load()
      // After setting a key, bring back the passphrase dialog so the user can retry.
      gpgMissingDialogOpen.value = false
      gpgExplain.value = ''
      gpgDialogOpen.value = true
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      gpgMissingBusy.value = false
    }
  }

  async function submitCredentials() {
    const dir = repoRoot.value
    const action = credAction.value
    if (!dir || !action) return

    const username = (credUsername.value || '').trim()
    const password = (credPassword.value || '').trim()
    if (!username || !password) return

    credDialogOpen.value = false
    credExplain.value = ''

    await withRepoBusy(`Auth (${action})`, async () => {
      try {
        const base = credBaseBody.value || {}
        const body = JSON.stringify({ ...base, auth: { username, password } })
        if (action === 'fetch') {
          await gitJson('fetch', dir, undefined, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
          toasts.push('success', 'Fetched')
        } else if (action === 'pull') {
          await gitJson('pull', dir, undefined, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
          toasts.push('success', 'Pulled')
        } else if (action === 'push') {
          await gitJson('push', dir, undefined, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
          toasts.push('success', 'Pushed')
        }
        credPassword.value = ''
        credAction.value = null
        credBaseBody.value = null
        await load()
      } catch (err) {
        if (handleGitBusy(err, `Auth (${action})`, submitCredentials)) return
        const msg = err instanceof Error ? err.message : String(err)
        credExplain.value = msg
        credDialogOpen.value = true
      }
    })
  }

  async function submitGpgPassphrase() {
    const dir = repoRoot.value
    const msg = (pendingCommitMessage.value || '').trim()
    const pp = (gpgPassphrase.value || '').trim()
    if (!dir || !msg || !pp) return

    gpgDialogOpen.value = false
    gpgExplain.value = ''

    await withRepoBusy('Commit', async () => {
      if (committing) committing.value = true
      try {
        await gitJson('commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            addAll: false,
            files: [],
            gpgPassphrase: pp,
            noVerify: commitNoVerify.value,
            signoff: commitSignoff.value,
            amend: commitAmend.value,
            noGpgSign: commitNoGpgSign.value,
          }),
        })
        toasts.push('success', 'Committed')
        onCommitSuccess?.(msg)
        gpgPassphrase.value = ''
        pendingCommitMessage.value = ''
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Commit', submitGpgPassphrase)) return

        if (err instanceof ApiError && (err.code || '').trim() === 'gpg_preset_failed') {
          // Offer a user-confirmed toggle to enable presetting in gpg-agent.conf.
          gpgEnableExplain.value = err.message
          gpgEnableDialogOpen.value = true
          return
        }

        if (isGpgNoKeyError(err)) {
          // Stop looping the passphrase prompt when there is no usable signing key.
          gpgDialogOpen.value = false
          gpgExplain.value = ''
          gpgMissingExplain.value = err.message
          gpgMissingDialogOpen.value = true
          return
        }

        const msg = err instanceof Error ? err.message : String(err)
        toasts.push('error', msg)
        gpgExplain.value = msg
        gpgDialogOpen.value = true
      } finally {
        if (committing) committing.value = false
      }
    })
  }

  async function enableGpgPresetAndRetry() {
    const dir = repoRoot.value
    if (!dir) return
    gpgEnableBusy.value = true
    try {
      await gitJson('gpg/enable-preset-passphrase', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      gpgEnableDialogOpen.value = false
      toasts.push('success', 'Updated gpg-agent config')
      // Retry immediately with the same pending message + passphrase.
      gpgDialogOpen.value = false
      await submitGpgPassphrase()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toasts.push('error', msg)
      gpgEnableExplain.value = msg
      gpgEnableDialogOpen.value = true
    } finally {
      gpgEnableBusy.value = false
    }
  }

  return {
    // Credential dialogs
    credDialogOpen,
    credAction,
    credBaseBody,
    credUsername,
    credPassword,
    credExplain,
    openCredentialsDialog,
    submitCredentials,
    authHelpText,
    isGithubRemote,
    preferredRemote,
    githubToken,
    githubTokenRemember,
    loadGithubTokenForRepo,
    saveGithubTokenForRepo,

    // Terminal help
    terminalHelpOpen,
    terminalHelpTitle,
    terminalHelpExplain,
    terminalHelpSend,
    openTerminalHelp,
    openGitTerminalWithCommand,
    terminalCommandForRemoteAction,
    terminalCommandForCommit,

    // Busy
    repoBusy,
    repoBusyOp,
    withRepoBusy,
    handleGitBusy,
    gitBusyDialogOpen,
    gitBusyTitle,
    gitBusyExplain,
    retryGitBusy,
    dismissGitBusyDialog,

    // GPG
    gpgDialogOpen,
    gpgPassphrase,
    gpgExplain,
    pendingCommitMessage,
    submitGpgPassphrase,
    isGpgPassphraseError,
    isGpgNoKeyError,
    isGitAuthError,
    gpgMissingDialogOpen,
    gpgMissingExplain,
    gpgSigningKeyInput,
    gpgMissingBusy,
    disableRepoGpgSigning,
    setRepoSigningKey,
    gpgEnableDialogOpen,
    gpgEnableBusy,
    gpgEnableExplain,
    enableGpgPresetAndRetry,

    // SSO
    ssoDialogOpen,
    ssoExplain,
    ssoAction,
    handleGitSso,
    retryGitSso,
    dismissGitSsoDialog,
  }
}
