<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { apiErrorBodyRecord, ApiError } from '@/lib/api'
import { gitJson, gitWatchUrl } from '@/lib/gitApi'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useGitDiffSelection } from '@/composables/git/useGitDiffSelection'
import { useGitStatusPaged } from '@/composables/git/useGitStatusPaged'
import { useGitWatchSse } from '@/composables/git/useGitWatchSse'
import { useGitPageAuth } from './git/useGitPageAuth'
import { useGitCommitState } from './git/useGitCommitState'
import { useGitCommitOps } from './git/useGitCommitOps'
import { useGitRemoteOps } from './git/useGitRemoteOps'
import { useGitRemoteBranchPicker } from './git/useGitRemoteBranchPicker'
import { useGitRemoteTargetOps } from './git/useGitRemoteTargetOps'
import { useGitRemoteTargetState } from './git/useGitRemoteTargetState'
import { useGitRepoSelection } from './git/useGitRepoSelection'
import { useGitBranches } from './git/useGitBranches'
import { useGitCheckoutOps } from './git/useGitCheckoutOps'
import { useGitPathOps } from './git/useGitPathOps'
import { useGitHistoryOps } from './git/useGitHistoryOps'
import { useGitHistoryLog } from './git/useGitHistoryLog'
import { useGitMergeRebaseOps } from './git/useGitMergeRebaseOps'
import { useGitCompareOps } from './git/useGitCompareOps'
import { useGitSubmoduleOps } from './git/useGitSubmoduleOps'
import { useGitLfsOps } from './git/useGitLfsOps'
import { useGitAutoFetch } from './git/useGitAutoFetch'
import { useGitRemotesOps } from './git/useGitRemotesOps'
import { useGitSequencerOps } from './git/useGitSequencerOps'
import { useGitStashOps } from './git/useGitStashOps'
import { useGitTags } from './git/useGitTags'
import { useGitWorkingTreeOps } from './git/useGitWorkingTreeOps'
import { useGitWorktrees } from './git/useGitWorktrees'
import { useGitPatchOps } from './git/useGitPatchOps'
import GitPageView from './git/GitPageView.vue'
import { composeGitPageViewContext } from './git/composeGitPageViewContext'
import { createEmptyStatusSummary, joinFs } from './git/gitPageUtils'
import type {
  GitLogCommit,
  GitRemoteInfoResponse,
  GitSigningInfoResponse,
  GitStateResponse,
  GitStatusResponse,
  GitWatchStatusPayload,
} from '@/types/git'
import { useDirectoryStore } from '@/stores/directory'
import { useGitReposStore } from '@/stores/gitRepos'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useToastsStore } from '@/stores/toasts'

// Stores & State
const settings = useSettingsStore()
const toasts = useToastsStore()
const directoryStore = useDirectoryStore()
const gitRepos = useGitReposStore()
const ui = useUiStore()
const router = useRouter()

const projectRoot = computed(() => directoryStore.currentDirectory)

// Unified SCM actions menu.
const actionsOpen = ref(false)
const autoFetchDialogOpen = ref(false)

const autoFetchEnabled = computed<boolean>({
  get() {
    return Boolean(settings.data?.gitAutoFetchEnabled)
  },
  set(value) {
    void settings.save({ gitAutoFetchEnabled: Boolean(value) })
  },
})

const autoFetchIntervalMinutes = computed<number>({
  get() {
    const raw = settings.data?.gitAutoFetchIntervalMinutes
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 10
    return Math.max(1, n)
  },
  set(value) {
    const n = Math.max(1, Number(value) || 1)
    void settings.save({ gitAutoFetchIntervalMinutes: n })
  },
})

const autoSyncEnabled = computed<boolean>({
  get() {
    return Boolean(settings.data?.gitAutoSyncEnabled)
  },
  set(value) {
    void settings.save({ gitAutoSyncEnabled: Boolean(value) })
  },
})

const autoSyncIntervalMinutes = computed<number>({
  get() {
    const raw = settings.data?.gitAutoSyncIntervalMinutes
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 30
    return Math.max(1, n)
  },
  set(value) {
    const n = Math.max(1, Number(value) || 1)
    void settings.save({ gitAutoSyncIntervalMinutes: n })
  },
})

type BranchProtectionPrompt = 'alwaysCommit' | 'alwaysCommitToNewBranch' | 'alwaysPrompt'
type PostCommitCommand = 'none' | 'push' | 'sync'

const gitAllowForcePush = computed<boolean>(() => Boolean(settings.data?.gitAllowForcePush))
const gitAllowNoVerifyCommit = computed<boolean>(() => Boolean(settings.data?.gitAllowNoVerifyCommit))
const gitBranchProtection = computed<string[]>(() => {
  const raw = settings.data?.gitBranchProtection
  if (!Array.isArray(raw)) return []
  return raw.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => !!item)
})
const gitBranchProtectionPrompt = computed<BranchProtectionPrompt>(() => {
  const raw = settings.data?.gitBranchProtectionPrompt
  const mode = typeof raw === 'string' ? raw.trim() : ''
  if (mode === 'alwaysCommit' || mode === 'alwaysCommitToNewBranch' || mode === 'alwaysPrompt') {
    return mode
  }
  return 'alwaysPrompt'
})
const gitPostCommitCommand = computed<PostCommitCommand>({
  get() {
    const raw = settings.data?.gitPostCommitCommand
    const command = typeof raw === 'string' ? raw.trim() : ''
    if (command === 'push' || command === 'sync' || command === 'none') return command
    return 'none'
  },
  set(value) {
    const command: PostCommitCommand = value === 'push' || value === 'sync' ? value : 'none'
    void settings.save({ gitPostCommitCommand: command })
  },
})

const selectedRepoRelative = computed(() => {
  const base = (projectRoot.value || '').trim()
  if (!base) return null
  return gitRepos.getSelectedRelative(base)
})

const selectedRepoLabel = computed(() => {
  if (!projectRoot.value) return '(no project)'
  return selectedRepoRelative.value || '(none)'
})

async function switchProjectRoot(path: string) {
  const target = (path || '').trim()
  if (!target) return
  const existing = settings.data?.projects || []
  if (!existing.some((project) => project.path.trim() === target)) {
    await settings.addProject(target)
  }
  directoryStore.setDirectory(target)
}

const repoSelection = useGitRepoSelection({
  projectRoot,
  selectedRepoRelative,
  gitRepos,
  toasts,
  gitJson,
  load,
  switchProjectRoot,
})

const repoRoot = computed(() => {
  const base = projectRoot.value || ''
  const rel = selectedRepoRelative.value || '.'
  const out = joinFs(base, rel)
  return out || null
})

const root = repoRoot

const status = ref<GitStatusResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const gitCheckLoading = ref(false)
const isGitRepository = ref<boolean | null>(null)
const gitReady = computed(() => isGitRepository.value === true)
const unsafeRepoPath = ref('')
const unsafeRepoHint = ref('')
const unsafeRepoBusy = ref(false)
const unsafeRepoDetected = computed(() => !!unsafeRepoPath.value)

const remoteInfo = ref<GitRemoteInfoResponse | null>(null)
const signingInfo = ref<GitSigningInfoResponse | null>(null)
const gitState = ref<GitStateResponse | null>(null)
const hasRemotes = computed(() => (remoteInfo.value?.remotes || []).length > 0)

// Stash panel logic extracted to ./git/useGitStashOps

// Push/Pull target selection state (VS Code-like "... to...")
const remoteTargetState = useGitRemoteTargetState()
const { pushToOpen, pullFromOpen, fetchFromOpen, targetRemote, targetBranch, targetRef, targetSetUpstream } =
  remoteTargetState

// Tags logic extracted to ./git/useGitTags

// Detached checkout / branch-from-ref, rename/delete, and history/template helpers are extracted below.

const remoteBranchPicker = useGitRemoteBranchPicker({
  gitJson,
  repoRoot,
  pushToOpen,
  pullFromOpen,
  fetchFromOpen,
  targetRemote,
  targetBranch,
})

// VS Code Style Sections
const isMergeExpanded = ref(true)
const isStagedExpanded = ref(true)
const isChangesExpanded = ref(true)
const isUntrackedExpanded = ref(true)

// File list paging (large repos can have thousands of changed files).
// This is backed by server pagination to keep both network + UI responsive.
const FILE_LIST_PAGE_SIZE = 200
const conflictPaths = ref<string[]>([])

const {
  mergeList,
  stagedList,
  changesList,
  untrackedList,
  mergeListLoading,
  stagedListLoading,
  changesListLoading,
  untrackedListLoading,
  mergeCount,
  stagedCount,
  changesCount,
  untrackedCount,
  hasMoreMerge,
  hasMoreStaged,
  hasMoreUnstaged,
  hasMoreUntracked,
  loadMore,
  reloadFirstPages,
} = useGitStatusPaged({
  gitReady,
  status,
  pageSize: FILE_LIST_PAGE_SIZE,
  loadStatusPage: async ({ directory, scope, offset, limit }) => {
    return await gitJson<GitStatusResponse>('status', directory, { scope, offset, limit, includeDiffStats: true })
  },
})

async function loadMoreMerge(directory: string) {
  await loadMore(directory, 'merge')
}

async function loadMoreStaged(directory: string) {
  await loadMore(directory, 'staged')
}

async function loadMoreChanges(directory: string) {
  await loadMore(directory, 'unstaged')
}

async function loadMoreUntracked(directory: string) {
  await loadMore(directory, 'untracked')
}

// Selection + Diff
const diffPaneRef = ref<{ refreshDiff: () => void } | null>(null)
function refreshDiff() {
  diffPaneRef.value?.refreshDiff?.()
}
const { selectedFile, diffSource, selectedIsConflict, selectFile } = useGitDiffSelection({
  conflictPaths,
  refresh: refreshDiff,
})

function repoKey(suffix: string): string {
  const dir = (repoRoot.value || '').trim()
  return `oc2.git.${suffix}:${dir || 'none'}`
}

const commitState = useGitCommitState({ repoRoot, repoKey })

const {
  commitMessage,
  committing,
  commitNoVerify,
  commitSignoff,
  commitAmend,
  commitNoGpgSign,
  commitErrorOpen,
  commitErrorTitle,
  commitErrorOutput,
  postCommitOpen,
  postCommitTitle,
  postCommitExplain,
  postCommitRememberChoice,
  pushCommitHistory,
} = commitState

function onCommitSuccess(msg: string) {
  pushCommitHistory(msg)
  commitMessage.value = ''
}

// Credentials / passphrase dialogs.
const auth = useGitPageAuth({
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
})

// Auth/credentials/GPG helpers extracted to './git/useGitPageAuth'.

const remoteTargetOps = useGitRemoteTargetOps({
  repoRoot,
  status,
  preferredRemote: auth.preferredRemote,
  pushToOpen,
  pullFromOpen,
  fetchFromOpen,
  targetRemote,
  targetBranch,
  targetRef,
  targetSetUpstream,
  clearRemoteBranchOptions: remoteBranchPicker.clearRemoteBranchOptions,
  prefetchRemoteBranches: remoteBranchPicker.prefetchRemoteBranches,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  handleGitSso: auth.handleGitSso,
  load,
  isGitAuthError: auth.isGitAuthError,
  openCredentialsDialog: auth.openCredentialsDialog,
  openTerminalHelp: auth.openTerminalHelp,
})

const remoteOps = useGitRemoteOps({
  repoRoot,
  allowForcePush: gitAllowForcePush,
  preferredRemote: auth.preferredRemote,
  isGithubRemote: auth.isGithubRemote,
  githubToken: auth.githubToken,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  handleGitSso: auth.handleGitSso,
  load,
  isGitAuthError: auth.isGitAuthError,
  openCredentialsDialog: auth.openCredentialsDialog,
  openTerminalHelp: auth.openTerminalHelp,
  terminalCommandForRemoteAction: auth.terminalCommandForRemoteAction,
})

const commitOps = useGitCommitOps({
  repoRoot,
  repoKey,
  status,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  commitMessage,
  committing,
  commitNoVerify,
  commitSignoff,
  commitAmend,
  commitNoGpgSign,
  allowNoVerifyCommit: gitAllowNoVerifyCommit,
  branchProtectionRules: gitBranchProtection,
  branchProtectionPrompt: gitBranchProtectionPrompt,
  postCommitCommand: gitPostCommitCommand,
  postCommitRememberChoice,
  runPostCommitPush: remoteOps.push,
  runPostCommitSync: remoteOps.sync,
  applyGitmoji,
  commitErrorOpen,
  commitErrorTitle,
  commitErrorOutput,
  postCommitOpen,
  postCommitTitle,
  postCommitExplain,
  isGpgNoKeyError: auth.isGpgNoKeyError,
  isGpgPassphraseError: auth.isGpgPassphraseError,
  gpgDialogOpen: auth.gpgDialogOpen,
  gpgExplain: auth.gpgExplain,
  pendingCommitMessage: auth.pendingCommitMessage,
  gpgMissingDialogOpen: auth.gpgMissingDialogOpen,
  gpgMissingExplain: auth.gpgMissingExplain,
  openTerminalHelp: auth.openTerminalHelp,
  terminalCommandForCommit: auth.terminalCommandForCommit,
  onCommitSuccess,
})

useGitAutoFetch({
  repoRoot,
  gitReady,
  repoBusy: auth.repoBusy,
  hasRemotes,
  autoFetchEnabled,
  autoFetchIntervalMinutes,
  autoSyncEnabled,
  autoSyncIntervalMinutes,
  fetchRemote: remoteOps.fetchRemote,
  sync: remoteOps.sync,
})

const sequencerOps = useGitSequencerOps({
  repoRoot,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  openTerminalHelp: auth.openTerminalHelp,
})

const tags = useGitTags({
  repoRoot,
  preferredRemote: auth.preferredRemote,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
})

const workingTreeOps = useGitWorkingTreeOps({
  root,
  selectedFile,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  refreshAfterStageOp: refreshAfterWorkingTreeChange,
  refreshDiff,
})

const branchesOps = useGitBranches({
  root,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
})

const { branches, loadBranches } = branchesOps

const historyBranchOptions = computed(() => {
  const list = Object.values(branches.value?.branches ?? {})
    .map((b) => (b?.name || '').trim())
    .filter((name) => !!name && !name.startsWith('remotes/') && !name.endsWith('/HEAD'))
  list.sort((a, b) => a.localeCompare(b))
  return list
})

const historyTagOptions = computed(() => {
  const list = (tags.tagsList.value || []).map((t) => (t?.name || '').trim()).filter(Boolean)
  list.sort((a, b) => a.localeCompare(b))
  return list
})

const checkoutOps = useGitCheckoutOps({
  repoRoot,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  loadBranches,
})

const pathOps = useGitPathOps({
  root,
  selectedFile,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  refreshDiff,
})

const stashOps = useGitStashOps({
  repoRoot,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  loadBranches,
  openTerminalHelp: auth.openTerminalHelp,
})

const { stashList, loadStash } = stashOps

const historyOps = useGitHistoryOps({
  repoRoot,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  openTerminalHelp: auth.openTerminalHelp,
  commitMessage,
  commitErrorOpen,
  commitErrorTitle,
  commitErrorOutput,
})

const historyLog = useGitHistoryLog({
  repoRoot,
  gitJson,
})

const remotesOps = useGitRemotesOps({
  repoRoot,
  remoteInfo,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
})

const worktreesOps = useGitWorktrees({
  repoRoot,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
})

const mergeRebaseOps = useGitMergeRebaseOps({
  repoRoot,
  toasts,
  gitJson,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  openTerminalHelp: auth.openTerminalHelp,
})

const compareOps = useGitCompareOps({
  repoRoot,
  gitJson,
  toasts,
})

const historyCompareHash = ref('')

function selectHistoryCompareCommit(commit: GitLogCommit) {
  const hash = (commit?.hash || '').trim()
  if (!hash) return
  historyCompareHash.value = hash
  toasts.push('info', `Selected ${hash.slice(0, 7)} for compare`, 1500)
}

function clearHistoryCompareCommit() {
  historyCompareHash.value = ''
}

async function compareHistoryWithParent(commit: GitLogCommit) {
  const head = (commit?.hash || '').trim()
  const parent = (commit?.parents?.[0] || '').trim()
  if (!head || !parent) {
    toasts.push('info', 'Selected commit has no parent to compare')
    return
  }
  const path = (historyLog.historyFilterPath.value || '').trim()
  await compareOps.compareCommitWithParent(head, parent, path)
}

async function compareHistoryWithSelected(commit: GitLogCommit) {
  const base = (historyCompareHash.value || '').trim()
  const head = (commit?.hash || '').trim()
  if (!base || !head || base === head) return
  const path = (historyLog.historyFilterPath.value || '').trim()
  compareOps.compareBase.value = base
  compareOps.compareHead.value = head
  compareOps.comparePath.value = path
  compareOps.compareOpen.value = true
  await compareOps.runCompare()
}

async function compareWithUpstream() {
  const current = (status.value?.current || '').trim()
  const upstream = (status.value?.tracking || '').trim()
  if (!current || !upstream) {
    toasts.push('info', 'No upstream tracking branch')
    return
  }
  compareOps.compareBase.value = upstream
  compareOps.compareHead.value = current
  compareOps.comparePath.value = ''
  compareOps.compareOpen.value = true
  await compareOps.runCompare()
}

const submoduleOps = useGitSubmoduleOps({
  repoRoot,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
})

const lfsOps = useGitLfsOps({
  repoRoot,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
})

const patchOps = useGitPatchOps({
  repoRoot,
  gitJson,
  toasts,
  withRepoBusy: auth.withRepoBusy,
  handleGitBusy: auth.handleGitBusy,
  load,
  refreshAfterPatchOp: refreshAfterWorkingTreeChange,
  refreshDiff,
})

const gitmojiEnabled = computed(() => Boolean(settings.data?.gitmojiEnabled))
const selectedGitmoji = ref(localStorage.getItem('oc2.git.gitmoji') || '')
watch(selectedGitmoji, (v) => localStorage.setItem('oc2.git.gitmoji', v))

const gitmojis = [
  { emoji: '✨', label: 'feat' },
  { emoji: '🐛', label: 'fix' },
  { emoji: '📝', label: 'docs' },
  { emoji: '♻️', label: 'refactor' },
  { emoji: '✅', label: 'test' },
  { emoji: '⚡️', label: 'perf' },
  { emoji: '🔧', label: 'chore' },
  { emoji: '🚀', label: 'deploy' },
]

// Methods
function applyGitmoji(message: string): string {
  const base = (message || '').trim()
  if (!gitmojiEnabled.value) return base
  const e = (selectedGitmoji.value || '').trim()
  if (!e) return base

  const known = gitmojis.map((g) => g.emoji)
  for (const k of known) {
    if (base.startsWith(`${k} `)) {
      return `${e} ${base.slice((k + ' ').length).trim()}`
    }
  }
  return `${e} ${base}`
}

function insertGitmoji() {
  if (!gitmojiEnabled.value) return
  const e = (selectedGitmoji.value || '').trim()
  if (!e) return
  commitMessage.value = applyGitmoji(commitMessage.value)
}

let loadSeq = 0

// Live status watch (SSE). This keeps the SCM panel "fresh" while files change.
async function refreshListsFromWatch(directory: string) {
  await Promise.all([
    loadConflicts(directory).catch(() => (conflictPaths.value = [])),
    reloadFirstPages(directory),
  ])
}

async function refreshAfterWorkingTreeChange() {
  const directory = root.value
  if (!directory || !gitReady.value) return
  await Promise.all([
    loadStatusSummary(directory),
    loadGitState(directory).catch(() => (gitState.value = null)),
    loadConflicts(directory).catch(() => (conflictPaths.value = [])),
    reloadFirstPages(directory),
  ])
}

const {
  watchRefreshTimer,
  startWatch: startWatchInner,
  stopWatch,
} = useGitWatchSse<GitWatchStatusPayload>({
  buildUrl: (directory) => gitWatchUrl(directory, 1500),
  onPayload: (payload, prev) => {
    // Update the summary immediately.
    const baseStatus = status.value ?? createEmptyStatusSummary()
    status.value = {
      ...baseStatus,
      current: payload.current,
      tracking: payload.tracking ?? null,
      ahead: payload.ahead,
      behind: payload.behind,
      stagedCount: payload.stagedCount,
      unstagedCount: payload.unstagedCount,
      untrackedCount: payload.untrackedCount,
      mergeCount: payload.mergeCount,
    }

    if (payload.isClean) {
      // If the repo is clean, clear selection + lists to match VS Code behavior.
      selectedFile.value = null
    }

    // Debounce list refreshes; avoid thrashing on rapid edits.
    const changedCounts =
      !prev ||
      prev.current !== payload.current ||
      prev.ahead !== payload.ahead ||
      prev.behind !== payload.behind ||
      prev.stagedCount !== payload.stagedCount ||
      prev.unstagedCount !== payload.unstagedCount ||
      prev.untrackedCount !== payload.untrackedCount ||
      prev.mergeCount !== payload.mergeCount ||
      prev.isClean !== payload.isClean

    if (changedCounts && !loading.value) {
      if (watchRefreshTimer.value) window.clearTimeout(watchRefreshTimer.value)
      watchRefreshTimer.value = window.setTimeout(() => {
        const dir = root.value
        if (!dir || !gitReady.value) return
        void refreshListsFromWatch(dir)
      }, 250)
    }
  },
})

function startWatch(directory: string) {
  startWatchInner(
    directory,
    () => {
      const dir = root.value
      return Boolean(dir && gitReady.value)
    },
    () => {
      const dir = root.value
      if (!dir || !gitReady.value) return
      startWatch(dir)
    },
  )
}

async function loadStatusSummary(directory: string) {
  // summary=true keeps the payload small even for huge repos.
  status.value = await gitJson<GitStatusResponse>('status', directory, { summary: true })
}

async function loadRemoteInfo(directory: string) {
  remoteInfo.value = await gitJson<GitRemoteInfoResponse>('remote-info', directory)
}

async function loadSigningInfo(directory: string) {
  signingInfo.value = await gitJson<GitSigningInfoResponse>('signing-info', directory)
}

async function loadGitState(directory: string) {
  gitState.value = await gitJson<GitStateResponse>('state', directory)
}

async function loadConflicts(directory: string) {
  // Safe even if no conflicts; endpoint returns []
  const resp = await gitJson<{ files: string[] }>('conflicts', directory)
  conflictPaths.value = Array.isArray(resp?.files) ? resp.files : []
}

function openFirstConflict() {
  const first = (conflictPaths.value || [])[0]
  if (!first) {
    toasts.push('error', 'No conflicts found')
    return
  }
  isMergeExpanded.value = true
  selectFile(first, 'working')
}

function resetRepoState() {
  status.value = null
  selectedFile.value = null
  mergeList.value = []
  stagedList.value = []
  changesList.value = []
  untrackedList.value = []
  remoteInfo.value = null
  signingInfo.value = null
  gitState.value = null
  stashList.value = []
  conflictPaths.value = []
}

function clearUnsafeRepo() {
  unsafeRepoPath.value = ''
  unsafeRepoHint.value = ''
}

async function trustUnsafeRepo() {
  const target = (unsafeRepoPath.value || repoRoot.value || '').trim()
  if (!target) return
  unsafeRepoBusy.value = true
  try {
    await gitJson<{ success: boolean; path: string; alreadyPresent?: boolean }>('safe-directory', target, undefined, {
      method: 'POST',
    })
    clearUnsafeRepo()
    toasts.push('success', 'Repository marked as safe')
    await repoSelection.loadRepos()
    await load()
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    unsafeRepoBusy.value = false
  }
}

async function load() {
  const seq = ++loadSeq
  const dir = root.value
  error.value = null
  loading.value = true
  try {
    await settings.refresh()
    if (seq !== loadSeq) return

    if (!dir) {
      resetRepoState()
      clearUnsafeRepo()
      return
    }

    gitCheckLoading.value = true
    try {
      const chk = await gitJson<{ isGitRepository: boolean }>('check', dir)
      if (seq !== loadSeq) return
      isGitRepository.value = Boolean(chk?.isGitRepository)
    } finally {
      gitCheckLoading.value = false
    }

    if (!isGitRepository.value) {
      resetRepoState()
      return
    }

    // Reset paged lists then load summary + first pages.
    mergeList.value = []
    stagedList.value = []
    changesList.value = []
    untrackedList.value = []
    await Promise.all([
      loadStatusSummary(dir),
      loadRemoteInfo(dir).catch(() => (remoteInfo.value = { remotes: [] })),
      loadSigningInfo(dir).catch(() => (signingInfo.value = null)),
      loadGitState(dir).catch(() => (gitState.value = null)),
      loadConflicts(dir).catch(() => (conflictPaths.value = [])),
      loadStash(dir).catch(() => (stashList.value = [])),
      loadMoreMerge(dir),
      loadMoreStaged(dir),
      loadMoreChanges(dir),
      loadMoreUntracked(dir),
    ])
    clearUnsafeRepo()
  } catch (err) {
    if (err instanceof ApiError && err.code === 'git_unsafe_repository') {
      const body = apiErrorBodyRecord(err)
      const unsafePath = typeof body?.path === 'string' ? body.path.trim() : ''
      unsafeRepoPath.value = unsafePath || (root.value || '').trim()
      unsafeRepoHint.value = (err.hint || '').trim()
      isGitRepository.value = false
      resetRepoState()
      error.value = null
      return
    }
    if (err instanceof ApiError && err.status === 409) {
      isGitRepository.value = false
      resetRepoState()
      error.value = null
      return
    }
    error.value = err instanceof Error ? err.message : String(err)
    status.value = null
    isGitRepository.value = null
  } finally {
    loading.value = false
  }
}

async function copyCommitHash(hash: string) {
  const value = (hash || '').trim()
  if (!value) return
  const ok = await copyTextToClipboard(value)
  if (ok) {
    toasts.push('success', 'Copied commit hash')
  } else {
    toasts.push('error', 'Failed to copy to clipboard')
  }
}

async function copyRemoteUrl(url: string) {
  const value = (url || '').trim()
  if (!value) return
  const ok = await copyTextToClipboard(value)
  if (ok) {
    toasts.push('success', 'Copied remote URL')
  } else {
    toasts.push('error', 'Failed to copy to clipboard')
  }
}

async function copyWorktreePath(path: string) {
  const value = (path || '').trim()
  if (!value) return
  const ok = await copyTextToClipboard(value)
  if (ok) {
    toasts.push('success', 'Copied worktree path')
  } else {
    toasts.push('error', 'Failed to copy to clipboard')
  }
}

function resolveRepoFilePath(path: string): string | null {
  const repo = (repoRoot.value || '').trim().replace(/\/+$/g, '')
  if (!repo) return null
  const rel = (path || '').trim().replace(/^\/+/, '')
  if (!rel) return null
  return `${repo}/${rel}`
}

function openFileInFiles(path: string) {
  const abs = resolveRepoFilePath(path)
  if (!abs) return
  void router.push({ path: '/files' })
}

function revealFileInFiles(path: string) {
  const abs = resolveRepoFilePath(path)
  if (!abs) return
  void router.push({ path: '/files' })
}

function openWorktree(path: string) {
  const base = (projectRoot.value || '').trim().replace(/\/+$/g, '')
  const p = (path || '').trim()
  if (!base || !p) return
  if (!p.startsWith(base)) {
    toasts.push('error', 'Worktree is outside the project root')
    return
  }
  const rel = p.slice(base.length).replace(/^\/+/, '') || '.'
  gitRepos.setSelectedRelative(base, rel)
}

watch(
  () => projectRoot.value,
  (next, prev) => {
    const n = (next || '').trim()
    const p = (prev || '').trim()
    if (n === p) return
    status.value = null
    selectedFile.value = null
    branches.value = null
    mergeList.value = []
    stagedList.value = []
    changesList.value = []
    untrackedList.value = []
    repoSelection.repos.value = []
    repoSelection.reposError.value = null
    void repoSelection.loadRepos().then(() => load())
  },
)

watch(
  () => selectedRepoRelative.value,
  (next, prev) => {
    const n = (next || '').trim()
    const p = (prev || '').trim()
    if (n === p) return
    status.value = null
    selectedFile.value = null
    branches.value = null
    mergeList.value = []
    stagedList.value = []
    changesList.value = []
    untrackedList.value = []
    void load()
  },
)

watch(
  () => [root.value, gitReady.value] as const,
  (next, old) => {
    const [dir, ready] = next
    const [prevDir, prevReady] = old ?? [null, false]
    const nextDir = (dir || '').trim()
    const prevDirTrimmed = (prevDir || '').trim()
    if (nextDir === prevDirTrimmed && ready === prevReady) return

    if (!ready || !nextDir) {
      stopWatch()
      return
    }

    startWatch(nextDir)
  },
  { immediate: true },
)

watch(
  () => repoRoot.value,
  (next, prev) => {
    const n = (next || '').trim()
    const p = (prev || '').trim()
    if (n === p) return
    historyCompareHash.value = ''
    auth.loadGithubTokenForRepo()
  },
  { immediate: true },
)

async function showMoreStaged() {
  const dir = root.value
  if (!dir) return
  await loadMoreStaged(dir)
}

async function showMoreChanges() {
  const dir = root.value
  if (!dir) return
  await loadMoreChanges(dir)
}

async function showMoreMerge() {
  const dir = root.value
  if (!dir) return
  await loadMoreMerge(dir)
}

async function showMoreUntracked() {
  const dir = root.value
  if (!dir) return
  await loadMoreUntracked(dir)
}

const headline = computed(() => {
  if (!status.value) return 'No repository'
  const parts = [status.value.current || '(detached)']
  if (status.value.ahead) parts.push(`↑ ${status.value.ahead}`)
  if (status.value.behind) parts.push(`↓ ${status.value.behind}`)
  return parts.join('  ')
})

// Template is rendered by ./git/GitPageView.vue. Keep this file under 1000 LOC by
// passing a context bag (refs + handlers) to the view.
const viewCtx = composeGitPageViewContext([
  {
    label: 'core',
    values: {
      ui,
      toasts,
      projectRoot,
      selectedRepoRelative,
      selectedRepoLabel,
      repoRoot,
      root,
      gitReady,
      status,
      loading,
      error,
      headline,
      gitState,
      signingInfo,
      remoteInfo,

      // Local UI state/handlers used in the view.
      actionsOpen,
      autoFetchDialogOpen,
      autoFetchEnabled,
      autoFetchIntervalMinutes,
      autoSyncEnabled,
      autoSyncIntervalMinutes,
      gitPostCommitCommand,
      gitmojiEnabled,
      gitmojis,
      selectedGitmoji,
      insertGitmoji,

      isMergeExpanded,
      isStagedExpanded,
      isChangesExpanded,
      isUntrackedExpanded,

      mergeList,
      stagedList,
      changesList,
      untrackedList,
      mergeListLoading,
      stagedListLoading,
      changesListLoading,
      untrackedListLoading,
      mergeCount,
      stagedCount,
      changesCount,
      untrackedCount,
      hasMoreMerge,
      hasMoreStaged,
      hasMoreUnstaged,
      hasMoreUntracked,
      showMoreMerge,
      showMoreStaged,
      showMoreChanges,
      showMoreUntracked,
      conflictPaths,

      diffPaneRef,
      selectedFile,
      diffSource,
      selectedIsConflict,
      selectFile,
      openFirstConflict,
      load,
      copyCommitHash,
      copyRemoteUrl,
      copyWorktreePath,
      openWorktree,
      openFileInFiles,
      revealFileInFiles,
      historyBranchOptions,
      historyTagOptions,
      historyCompareHash,
      selectHistoryCompareCommit,
      clearHistoryCompareCommit,
      compareHistoryWithParent,
      compareHistoryWithSelected,
      compareWithUpstream,
      unsafeRepoDetected,
      unsafeRepoPath,
      unsafeRepoHint,
      trustUnsafeRepo,
      unsafeRepoBusy,
    },
  },
  { label: 'repoSelection', values: repoSelection },
  { label: 'remoteTargetState', values: remoteTargetState },
  { label: 'remoteBranchPicker', values: remoteBranchPicker },
  { label: 'remoteTargetOps', values: remoteTargetOps },
  { label: 'commitState', values: commitState },
  { label: 'auth', values: auth },
  { label: 'commitOps', values: commitOps },
  { label: 'historyOps', values: historyOps },
  { label: 'historyLog', values: historyLog },
  { label: 'mergeRebaseOps', values: mergeRebaseOps },
  { label: 'compareOps', values: compareOps },
  { label: 'submoduleOps', values: submoduleOps },
  { label: 'lfsOps', values: lfsOps },
  { label: 'remotesOps', values: remotesOps },
  { label: 'worktreesOps', values: worktreesOps },
  { label: 'patchOps', values: patchOps },
  { label: 'remoteOps', values: remoteOps },
  { label: 'sequencerOps', values: sequencerOps },
  { label: 'tags', values: tags },
  { label: 'workingTreeOps', values: workingTreeOps },
  { label: 'checkoutOps', values: checkoutOps },
  { label: 'branchesOps', values: branchesOps },
  { label: 'pathOps', values: pathOps },
  { label: 'stashOps', values: stashOps },
] as const)

onMounted(() => {
  void repoSelection.loadRepos().then(() => load())
})

onBeforeUnmount(() => {
  stopWatch()
})
</script>

<template>
  <GitPageView :ctx="viewCtx" />
</template>
