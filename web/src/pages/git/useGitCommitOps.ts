import { apiErrorBodyRecord, ApiError } from '@/lib/api'
import { i18n } from '@/i18n'

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

type GitStatusLike = {
  current?: string | null
  tracking?: string | null
  ahead?: number
}

type BranchProtectionPrompt = 'alwaysCommit' | 'alwaysCommitToNewBranch' | 'alwaysPrompt'
type PostCommitCommand = 'none' | 'push' | 'sync'
type PostCommitAction = 'push' | 'sync'

export function useGitCommitOps(opts: {
  repoRoot: { value: string | null }
  repoKey: (suffix: string) => string
  status: { value: GitStatusLike | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: (err: GitError, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>

  commitMessage: { value: string }
  committing: { value: boolean }
  commitNoVerify: { value: boolean }
  commitSignoff: { value: boolean }
  commitAmend: { value: boolean }
  commitNoGpgSign: { value: boolean }
  allowNoVerifyCommit: { value: boolean }
  branchProtectionRules: { value: string[] }
  branchProtectionPrompt: { value: BranchProtectionPrompt }
  postCommitCommand: { value: PostCommitCommand }
  postCommitRememberChoice: { value: boolean }
  runPostCommitPush: () => Promise<void>
  runPostCommitSync: () => Promise<void>
  applyGitmoji: (message: string) => string

  commitErrorOpen: { value: boolean }
  commitErrorTitle: { value: string }
  commitErrorOutput: { value: string }

  postCommitOpen: { value: boolean }
  postCommitTitle: { value: string }
  postCommitExplain: { value: string }

  // GPG / terminal escape hatch (used by commitStaged)
  isGpgNoKeyError: (err: GitError) => err is ApiError
  isGpgPassphraseError: (err: GitError) => err is ApiError
  gpgDialogOpen: { value: boolean }
  gpgExplain: { value: string }
  pendingCommitMessage: { value: string }
  gpgMissingDialogOpen: { value: boolean }
  gpgMissingExplain: { value: string }
  openTerminalHelp: (title: string, explain: string, send: string) => void
  terminalCommandForCommit: (message: string) => string

  onCommitSuccess: (message: string) => void
}) {
  const {
    repoRoot,
    repoKey,
    status,
    toasts,
    gitJson,
    withRepoBusy,
    handleGitBusy,
    load,
    commitMessage,
    committing,
    commitNoVerify,
    commitSignoff,
    commitAmend,
    commitNoGpgSign,
    allowNoVerifyCommit,
    branchProtectionRules,
    branchProtectionPrompt,
    postCommitCommand,
    postCommitRememberChoice,
    runPostCommitPush,
    runPostCommitSync,
    applyGitmoji,
    commitErrorOpen,
    commitErrorTitle,
    commitErrorOutput,
    postCommitOpen,
    postCommitTitle,
    postCommitExplain,
    isGpgNoKeyError,
    isGpgPassphraseError,
    gpgDialogOpen,
    gpgExplain,
    pendingCommitMessage,
    gpgMissingDialogOpen,
    gpgMissingExplain,
    openTerminalHelp,
    terminalCommandForCommit,
    onCommitSuccess,
  } = opts

  function showCommitOutputDialogIfPresent(err: GitError): boolean {
    if (!(err instanceof ApiError)) return false
    const body = apiErrorBodyRecord(err)
    const out = typeof body?.stdout === 'string' ? body.stdout : ''
    const e = typeof body?.stderr === 'string' ? body.stderr : ''
    if (!out && !e) return false
    commitErrorTitle.value = err.code === 'git_hook_failed' ? 'Git hook failed' : 'Commit failed'
    commitErrorOutput.value = [e, out].filter(Boolean).join('\n\n').trim()
    commitErrorOpen.value = true
    return true
  }

  function normalizePostCommitCommand(value: GitValue): PostCommitCommand | null {
    const command = typeof value === 'string' ? value.trim() : ''
    if (command === 'none' || command === 'push' || command === 'sync') return command
    return null
  }

  function repoPostCommitCommandKey(): string {
    return repoKey('postCommitCommand')
  }

  function readRepoPostCommitCommand(): PostCommitCommand | null {
    try {
      const raw = localStorage.getItem(repoPostCommitCommandKey())
      return normalizePostCommitCommand(raw)
    } catch {
      return null
    }
  }

  function writeRepoPostCommitCommand(command: PostCommitCommand): void {
    try {
      localStorage.setItem(repoPostCommitCommandKey(), command)
    } catch {
      // ignore
    }
  }

  function effectivePostCommitCommand(): PostCommitCommand {
    return readRepoPostCommitCommand() ?? normalizePostCommitCommand(postCommitCommand.value) ?? 'none'
  }

  async function triggerPostCommitAction(action: PostCommitAction) {
    const remember = Boolean(postCommitRememberChoice.value)
    postCommitRememberChoice.value = false
    postCommitOpen.value = false
    if (remember) writeRepoPostCommitCommand(action)
    if (action === 'push') {
      await runPostCommitPush()
      return
    }
    await runPostCommitSync()
  }

  function dismissPostCommitPrompt() {
    const remember = Boolean(postCommitRememberChoice.value)
    postCommitRememberChoice.value = false
    postCommitOpen.value = false
    if (remember) writeRepoPostCommitCommand('none')
  }

  async function maybeOpenPostCommitPrompt() {
    // VS Code-like nudge: if we're ahead and have a tracking branch, offer push/sync.
    if (!((status.value?.tracking || '').trim() && (status.value?.ahead || 0) > 0)) {
      return
    }

    const ahead = status.value?.ahead || 0
    const effectiveCommand = effectivePostCommitCommand()
    if (effectiveCommand === 'push') {
      await runPostCommitPush()
      return
    }
    if (effectiveCommand === 'sync') {
      await runPostCommitSync()
      return
    }

    postCommitTitle.value = 'Commit created'
    postCommitExplain.value = `You are ahead by ${ahead}. Push or Sync?`
    postCommitRememberChoice.value = false
    postCommitOpen.value = true
  }

  function wildcardToRegex(rule: string): RegExp | null {
    const value = (rule || '').trim()
    if (!value) return null
    const escaped = value
      .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    try {
      return new RegExp(`^${escaped}$`)
    } catch {
      return null
    }
  }

  function isProtectedBranch(branch: string): boolean {
    const current = (branch || '').trim()
    if (!current) return false
    const rules = Array.isArray(branchProtectionRules.value) ? branchProtectionRules.value : []
    for (const rule of rules) {
      const rx = wildcardToRegex(rule)
      if (rx && rx.test(current)) return true
    }
    return false
  }

  function assertNoVerifyPolicy(): boolean {
    if (!commitNoVerify.value || allowNoVerifyCommit.value) return true
    toasts.push('error', i18n.global.t('git.errors.commitsWithoutVerificationDisabledByPolicy'))
    commitNoVerify.value = false
    return false
  }

  function suggestProtectedBranchName(branch: string): string {
    const suggestedBase = branch
      .replace(/[^A-Za-z0-9._/-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `${suggestedBase || 'branch'}/changes`
  }

  async function switchToNewBranchForProtected(baseBranch: string): Promise<boolean> {
    const dir = repoRoot.value
    if (!dir) return false

    const nextBranch = (
      window.prompt(
        `Branch "${baseBranch}" is protected. Enter a new branch name for this commit:`,
        suggestProtectedBranchName(baseBranch),
      ) || ''
    ).trim()
    if (!nextBranch) return false

    try {
      await gitJson('branches/create-from', dir, undefined, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nextBranch, startPoint: 'HEAD', checkout: true }),
      })
      await load()
      toasts.push('success', i18n.global.t('git.toasts.switchedToBranch', { branch: nextBranch }))
      return true
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  async function handleProtectedBranchCommitError(err: GitError): Promise<boolean> {
    if (!(err instanceof ApiError) || (err.code || '').trim() !== 'git_branch_protected') return false
    const body = apiErrorBodyRecord(err)
    const promptMode = typeof body?.promptMode === 'string' ? body.promptMode.trim() : ''
    const branchFromError = typeof body?.branch === 'string' ? body.branch.trim() : ''
    const branch = branchFromError || (status.value?.current || '').trim()
    if (!branch) {
      toasts.push('error', err.message)
      return true
    }

    if (promptMode !== 'alwaysCommitToNewBranch') {
      toasts.push('error', err.message)
      return true
    }

    const switched = await switchToNewBranchForProtected(branch)
    if (switched) {
      toasts.push('info', i18n.global.t('git.errors.nowOnNewBranchCommitAgain'), 2500)
    }
    return true
  }

  async function handleCommitFailure(
    err: GitError,
    opLabel: string,
    messageForRetry: string,
    retry: () => Promise<void>,
  ): Promise<boolean> {
    if (handleGitBusy(err, opLabel, retry)) return true
    if (showCommitOutputDialogIfPresent(err)) return true

    if (await handleProtectedBranchCommitError(err)) return true

    if (err instanceof ApiError && (err.code || '').trim() === 'git_no_verify_not_allowed') {
      commitNoVerify.value = false
      toasts.push('error', err.message)
      return true
    }

    if (isGpgNoKeyError(err)) {
      gpgDialogOpen.value = false
      gpgExplain.value = ''
      gpgMissingExplain.value = err.message
      gpgMissingDialogOpen.value = true
      return true
    }

    if (isGpgPassphraseError(err)) {
      gpgExplain.value = err.message
      pendingCommitMessage.value = messageForRetry
      gpgDialogOpen.value = true
      return true
    }

    if (err instanceof ApiError && (err.code || '').trim() === 'git_signing_interactive_required') {
      openTerminalHelp('Signing requires a terminal', err.message, terminalCommandForCommit(messageForRetry))
      return true
    }

    if (err instanceof ApiError && (err.code || '').trim() === 'git_ssh_auth_failed') {
      openTerminalHelp('SSH authentication required', err.message, terminalCommandForCommit(messageForRetry))
      return true
    }

    if (err instanceof ApiError && (err.code || '').trim() === 'git_timeout') {
      openTerminalHelp('Git command timed out', err.message, terminalCommandForCommit(messageForRetry))
      return true
    }

    return false
  }

  async function ensureProtectedBranchPolicyBeforeCommit(): Promise<boolean> {
    const branch = (status.value?.current || '').trim()
    if (!branch || !isProtectedBranch(branch)) return true

    const promptMode = branchProtectionPrompt.value
    if (promptMode === 'alwaysCommit') return true

    if (promptMode === 'alwaysPrompt') {
      return window.confirm(`Branch "${branch}" is protected. Commit anyway?`)
    }
    return await switchToNewBranchForProtected(branch)
  }

  async function commitStaged() {
    const dir = repoRoot.value
    const msg = applyGitmoji(commitMessage.value)
    if (!dir || !msg) return
    if (!assertNoVerifyPolicy()) return

    await withRepoBusy('Commit', async () => {
      if (!(await ensureProtectedBranchPolicyBeforeCommit())) return
      committing.value = true
      try {
        await gitJson('commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            addAll: false,
            files: [],
            noVerify: commitNoVerify.value,
            signoff: commitSignoff.value,
            amend: commitAmend.value,
            noGpgSign: commitNoGpgSign.value,
          }),
        })
        toasts.push('success', i18n.global.t('git.toasts.committed'))
        onCommitSuccess(msg)
        await load()
        await maybeOpenPostCommitPrompt()
      } catch (err) {
        if (await handleCommitFailure(err, 'Commit', msg, commitStaged)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      } finally {
        committing.value = false
      }
    })
  }

  async function commitAll() {
    const dir = repoRoot.value
    const msg = applyGitmoji(commitMessage.value)
    if (!dir || !msg) return
    if (!assertNoVerifyPolicy()) return

    await withRepoBusy('Commit (all)', async () => {
      if (!(await ensureProtectedBranchPolicyBeforeCommit())) return
      committing.value = true
      try {
        await gitJson('commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            addAll: true,
            files: [],
            noVerify: commitNoVerify.value,
            signoff: commitSignoff.value,
            amend: commitAmend.value,
            allowEmpty: false,
            noGpgSign: commitNoGpgSign.value,
          }),
        })
        toasts.push('success', i18n.global.t('git.toasts.committedAll'))
        onCommitSuccess(msg)
        await load()
        await maybeOpenPostCommitPrompt()
      } catch (err) {
        if (await handleCommitFailure(err, 'Commit (all)', msg, commitAll)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      } finally {
        committing.value = false
      }
    })
  }

  async function commitEmpty() {
    const dir = repoRoot.value
    const msg = applyGitmoji(commitMessage.value)
    if (!dir || !msg) return
    if (!assertNoVerifyPolicy()) return

    await withRepoBusy('Commit (empty)', async () => {
      if (!(await ensureProtectedBranchPolicyBeforeCommit())) return
      committing.value = true
      try {
        await gitJson('commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            addAll: false,
            files: [],
            noVerify: commitNoVerify.value,
            signoff: commitSignoff.value,
            amend: commitAmend.value,
            allowEmpty: true,
            noGpgSign: commitNoGpgSign.value,
          }),
        })
        toasts.push('success', i18n.global.t('git.toasts.committedEmpty'))
        onCommitSuccess(msg)
        await load()
        await maybeOpenPostCommitPrompt()
      } catch (err) {
        if (await handleCommitFailure(err, 'Commit (empty)', msg, commitEmpty)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      } finally {
        committing.value = false
      }
    })
  }

  return {
    commitStaged,
    commitAll,
    commitEmpty,
    triggerPostCommitAction,
    dismissPostCommitPrompt,
  }
}
