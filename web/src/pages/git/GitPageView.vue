<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'radix-vue'
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiGitBranchLine,
  RiClipboardLine,
  RiMore2Line,
  RiRefreshLine,
} from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import MiniActionButton from '@/components/ui/MiniActionButton.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import SearchInput from '@/components/ui/SearchInput.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import GitCommitBox from '@/components/git/GitCommitBox.vue'
import GitDiffPane from '@/components/git/GitDiffPane.vue'
import GitMergeChangesSection from '@/components/git/GitMergeChangesSection.vue'
import GitStagedChangesSection from '@/components/git/GitStagedChangesSection.vue'
import GitChangesSection from '@/components/git/GitChangesSection.vue'
import GitUntrackedSection from '@/components/git/GitUntrackedSection.vue'
import GitCloneDialog from '@/components/git/GitCloneDialog.vue'
import GitInitRepoDialog from '@/components/git/GitInitRepoDialog.vue'
import GitBranchesDialog from '@/components/git/GitBranchesDialog.vue'
import GitBranchActionDialog from '@/components/git/GitBranchActionDialog.vue'
import GitRenameBranchDialog from '@/components/git/GitRenameBranchDialog.vue'
import GitCompareDialog from '@/components/git/GitCompareDialog.vue'
import GitSubmodulesDialog from '@/components/git/GitSubmodulesDialog.vue'
import GitLfsDialog from '@/components/git/GitLfsDialog.vue'
import GitAutoFetchDialog from '@/components/git/GitAutoFetchDialog.vue'
import GitRemotesDialog from '@/components/git/GitRemotesDialog.vue'
import GitTagsDialog from '@/components/git/GitTagsDialog.vue'
import GitWorktreesDialog from '@/components/git/GitWorktreesDialog.vue'
import GitCheckoutDetachedDialog from '@/components/git/GitCheckoutDetachedDialog.vue'
import GitCreateBranchFromDialog from '@/components/git/GitCreateBranchFromDialog.vue'
import GitRenameDialog from '@/components/git/GitRenameDialog.vue'
import GitStashPanel from '@/components/git/GitStashPanel.vue'
import GitStashViewDialog from '@/components/git/GitStashViewDialog.vue'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import { useUnifiedMultiSelect } from '@/composables/useUnifiedMultiSelect'

import GitAuthDialogs from './components/GitAuthDialogs.vue'
import GitRemoteTargetDialogs from './components/GitRemoteTargetDialogs.vue'
import GitPageMiscDialogs from './components/GitPageMiscDialogs.vue'
import { formatDateTimeYMDHM } from '@/i18n/intl'

const props = defineProps({
  ctx: {
    type: Object,
    required: true,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
})
const { startDesktopSidebarResize } = useDesktopSidebarResize()
const { t } = useI18n()

// NOTE: We deliberately destructure refs/functions from ctx so the template can remain
// close to the original GitPage.vue markup. Values are mostly refs (from parent)
// and v-model bindings work because Vue supports ref assignment in templates.

// Keep destructured names explicit so this template remains close to the original
// GitPage.vue markup and easier to split into smaller view chunks.
const {
  // Stores / misc
  ui,
  toasts,

  // High-level state
  root,
  repoRoot,
  projectRoot,
  gitReady,
  repoBusy,
  loading,
  error,
  status,
  headline,
  gitState,
  signingInfo,
  remoteInfo,
  selectedRepoLabel,
  selectedRepoRelative,

  // Repo list/picker
  repoPickerRepos,
  parentRepos,
  reposLoading,
  repoPickerLoading,
  reposError,
  repoPickerPage,
  repoPickerTotalPages,
  repoPickerTotal,
  initRepoOpen,
  initRepoPath,
  initRepoDefaultBranch,
  initRepoBusy,
  loadRepoPickerPage,
  initRepo,
  cloneRepoOpen,
  cloneRepoUrl,
  cloneRepoPath,
  cloneRepoRef,
  cloneRepoRecursive,
  cloneRepoBusy,
  cloneRepo,
  selectRepo,
  openParentRepo,

  // Unsafe repository trust flow
  unsafeRepoDetected,
  unsafeRepoPath,
  unsafeRepoHint,
  trustUnsafeRepo,
  unsafeRepoBusy,

  // SCM actions menu
  actionsOpen,
  autoFetchDialogOpen,
  autoFetchEnabled,
  autoFetchIntervalMinutes,
  autoSyncEnabled,
  autoSyncIntervalMinutes,
  gitPostCommitCommand,

  // Commit
  commitMessage,
  committing,
  commitNoVerify,
  commitSignoff,
  commitAmend,
  commitNoGpgSign,
  commitStaged,
  commitAll,
  commitEmpty,
  undoLastCommit,
  revertCommit,
  restoreCommitTemplate,
  discardCommitMessage,
  onCommitMessageKeydown,
  gitmojiEnabled,
  gitmojis,
  selectedGitmoji,
  insertGitmoji,

  // Sequencer ops
  abortMerge,
  abortRebase,
  cherryPickContinue,
  cherryPickSkip,
  cherryPickAbort,
  revertContinue,
  revertSkip,
  revertAbortSeq,
  rebaseContinue,
  rebaseSkip,

  // Stash
  isStashExpanded,
  stashList,
  stashLoading,
  loadStash,
  stashAction,
  stashBranchFrom,
  stashDropAll,
  stashView,
  stashViewOpen,
  stashViewTitle,
  stashViewDiff,
  stashViewLoading,
  stashViewError,

  // Sections / file lists
  isMergeExpanded,
  isStagedExpanded,
  isChangesExpanded,
  isUntrackedExpanded,
  mergeCount,
  stagedCount,
  changesCount,
  untrackedCount,
  mergeList,
  stagedList,
  changesList,
  untrackedList,
  conflictPaths,
  mergeListLoading,
  stagedListLoading,
  changesListLoading,
  untrackedListLoading,
  hasMoreMerge,
  hasMoreStaged,
  hasMoreUnstaged,
  hasMoreUntracked,
  showMoreMerge,
  showMoreStaged,
  showMoreChanges,
  showMoreUntracked,

  // Working tree ops
  stagePaths,
  unstagePaths,
  unstageAll,
  deletePath,
  openRenameDialog,
  revertFile,
  ignorePath,
  cleanUntracked,
  discardAllTracked,
  revertAllChanges,
  stageAll,
  stageAllTracked,
  stageAllUntracked,
  stageAllMerge,

  // Selection/diff
  diffPaneRef,
  selectedFile,
  diffSource,
  selectedIsConflict,
  selectFile,
  openFirstConflict,
  load,
  refreshRepository,
  copyCommitHash,
  copyRemoteUrl,
  copyWorktreePath,
  openWorktree,
  openFileInFiles,
  revealFileInFiles,
  stageHunk,
  unstageHunk,
  discardHunk,
  stageSelected,
  unstageSelected,
  discardSelected,

  // Merge/Rebase
  mergeDialogOpen,
  mergeTarget,
  mergeBusy,
  rebaseDialogOpen,
  rebaseTarget,
  rebaseBusy,
  openMergeDialog,
  openRebaseDialog,
  startMerge,
  startRebase,

  // Compare
  compareOpen,
  compareBase,
  compareHead,
  comparePath,
  compareDiff,
  compareLoading,
  compareError,
  openCompareDialog,
  closeCompareDialog,
  resetCompare,
  swapCompareRefs,
  runCompare,
  compareWithUpstream,

  // Submodules
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

  // LFS
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

  // Branches
  isBranchDialogOpen,
  branchesLoading,
  branches,
  branchPicker,
  branchPickerLoading,
  branchPickerPage,
  branchPickerTotalPages,
  newBranchName,
  renameBranchOpen,
  renameBranchFrom,
  renameBranchTo,
  createBranch,
  checkoutBranch,
  deleteBranch,
  deleteRemoteBranch,
  openRenameBranch,
  submitRenameBranch,
  loadBranches,
  loadBranchPicker,

  // Tags
  tagsOpen,
  tagsLoading,
  tagsList,
  newTagName,
  newTagRef,
  newTagMessage,
  tagRemote,
  openTags,
  loadTags,
  createTag,
  deleteTag,
  deleteRemoteTag,

  // Detached/branch-from
  detachedOpen,
  detachedRef,
  checkoutDetached,
  branchFromOpen,
  branchFromName,
  branchFromRef,
  branchFromCheckout,
  createBranchFromRef,

  // Rename
  renameDialogOpen,
  renameFrom,
  renameTo,
  submitRename,

  // Auth dialogs
  credDialogOpen,
  credAction,
  credUsername,
  credPassword,
  credExplain,
  authHelpText,
  isGithubRemote,
  githubToken,
  githubTokenRemember,
  saveGithubTokenForRepo,
  gitBusyDialogOpen,
  gitBusyTitle,
  gitBusyExplain,
  dismissGitBusyDialog,
  retryGitBusy,
  ssoDialogOpen,
  ssoAction,
  ssoExplain,
  retryGitSso,
  dismissGitSsoDialog,
  terminalHelpOpen,
  terminalHelpTitle,
  terminalHelpExplain,
  terminalHelpSend,
  openGitTerminalWithCommand,
  terminalCommandForRemoteAction,
  terminalCommandForCommit,
  submitCredentials,

  gpgDialogOpen,
  gpgPassphrase,
  gpgExplain,
  pendingCommitMessage,
  submitGpgPassphrase,
  gpgEnableDialogOpen,
  gpgEnableExplain,
  gpgEnableBusy,
  enableGpgPresetAndRetry,
  gpgMissingDialogOpen,
  gpgMissingExplain,
  gpgMissingBusy,
  gpgSigningKeyInput,
  setRepoSigningKey,
  disableRepoGpgSigning,

  // Remote target dialogs
  pushToOpen,
  pullFromOpen,
  targetRemote,
  targetBranch,
  targetRef,
  targetSetUpstream,
  branchPickVisible,
  branchPickIndex,
  remoteBranchLoading,
  filteredRemoteBranchOptions,
  hideBranchPickSoon,
  onBranchPickKeydown,
  openPullFrom,
  openPushTo,
  pullFromTarget,
  pushToTarget,
  stashDialogOpen,
  stashMessage,
  stashIncludeUntracked,
  stashKeepIndex,
  stashStaged,
  stashPush,
  fetchFromOpen,
  openFetchFrom,
  fetchFromTarget,

  // Remote ops
  fetchRemote,
  fetchPrune,
  fetchAll,
  pull,
  pullRebase,
  push,
  pushForce,
  pushTags,
  pushFollowTags,
  pushForceWithLease,
  sync,
  syncRebase,

  stashPushKeepIndexQuick,
  stashPushIncludeUntrackedQuick,
  stashPushStagedQuick,

  // Misc dialogs
  commitErrorOpen,
  commitErrorTitle,
  commitErrorOutput,
  postCommitOpen,
  postCommitTitle,
  postCommitExplain,
  postCommitRememberChoice,
  triggerPostCommitAction,
  dismissPostCommitPrompt,

  // History
  historyLoading,
  historyError,
  historyCommits,
  historyHasMore,
  historyCurrentPage,
  historyKnownLastPage,
  historyExactLastPage,
  historySelected,
  historyFiles,
  historyFilesLoading,
  historyFilesError,
  historyFileSelected,
  historyFilesCurrentPage,
  historyFilesKnownLastPage,
  historyFilesExactLastPage,
  historyFilterPath,
  historySearchDraft,
  openFileHistory,
  refreshHistory,
  clearHistoryFilter,
  applyHistoryFilters,
  loadHistoryPage,
  selectCommit,
  loadCommitFilesAtPage,
  selectCommitFile,
  clearSelectedFile,

  // Remotes
  remotesOpen,
  remotesLoading,
  remotesError,
  remotesList,
  newRemoteName,
  newRemoteUrl,
  selectedRemote,
  renameRemoteTo,
  setRemoteUrl,
  openRemotes,
  loadRemotes,
  addRemote,
  renameRemote,
  updateRemoteUrl,
  removeRemote,

  // Worktrees
  worktreesOpen,
  worktreesLoading,
  worktreesError,
  worktrees,
  newWorktreePath,
  newWorktreeBranch,
  newWorktreeStartPoint,
  newWorktreeCreateBranch,
  openWorktrees,
  loadWorktrees,
  addWorktree,
  removeWorktree,
  pruneWorktrees,
  migrateWorktreeChanges,
} = props.ctx

const rebaseActionMenuOpen = ref(false)
const rebaseActionMenuQuery = ref('')

const rebaseActionMenuGroups = computed<OptionMenuGroup[]>(() => {
  const items: OptionMenuItem[] = []

  if ((conflictPaths.value || []).length > 0) {
    items.push({ id: 'open-conflict', label: t('git.ui.sequencer.openConflict') })
  }

  items.push({ id: 'skip', label: t('git.ui.sequencer.skip') })
  items.push({ id: 'use-terminal', label: t('common.useTerminal') })

  return [{ id: 'rebase-actions', items }]
})

function openRebaseActionMenu() {
  const nextOpen = !rebaseActionMenuOpen.value
  rebaseActionMenuOpen.value = nextOpen
  if (nextOpen) rebaseActionMenuQuery.value = ''
}

function setRebaseActionMenuOpen(open: boolean) {
  rebaseActionMenuOpen.value = open
  if (!open) rebaseActionMenuQuery.value = ''
}

function onRebaseActionMenuSelect(item: OptionMenuItem) {
  if (item.id === 'open-conflict') {
    openFirstConflictAndShowDiff()
    return
  }
  if (item.id === 'skip') {
    rebaseSkip()
    return
  }
  if (item.id === 'use-terminal') {
    openGitTerminalWithCommand(repoRoot.value || '', 'git rebase --continue')
  }
}

const mergeActionMenuOpen = ref(false)
const mergeActionMenuQuery = ref('')

const mergeActionMenuGroups = computed<OptionMenuGroup[]>(() => {
  const items: OptionMenuItem[] = []
  if ((conflictPaths.value || []).length > 0) {
    items.push({ id: 'open-conflict', label: t('git.ui.sequencer.openConflict') })
  }
  items.push({ id: 'use-terminal', label: t('common.useTerminal') })
  return [{ id: 'merge-actions', items }]
})

function openMergeActionMenu() {
  const nextOpen = !mergeActionMenuOpen.value
  mergeActionMenuOpen.value = nextOpen
  if (nextOpen) mergeActionMenuQuery.value = ''
}

function setMergeActionMenuOpen(open: boolean) {
  mergeActionMenuOpen.value = open
  if (!open) mergeActionMenuQuery.value = ''
}

function onMergeActionMenuSelect(item: OptionMenuItem) {
  if (item.id === 'open-conflict') {
    openFirstConflictAndShowDiff()
    return
  }
  if (item.id === 'use-terminal') {
    openGitTerminalWithCommand(repoRoot.value || '', 'git merge --continue')
  }
}

const cherryPickActionMenuOpen = ref(false)
const cherryPickActionMenuQuery = ref('')

const cherryPickActionMenuGroups = computed<OptionMenuGroup[]>(() => {
  const items: OptionMenuItem[] = []

  if ((conflictPaths.value || []).length > 0) {
    items.push({ id: 'open-conflict', label: t('git.ui.sequencer.openConflict') })
  }

  items.push({ id: 'skip', label: t('git.ui.sequencer.skip') })
  items.push({ id: 'use-terminal', label: t('common.useTerminal') })

  return [{ id: 'cherry-pick-actions', items }]
})

function openCherryPickActionMenu() {
  const nextOpen = !cherryPickActionMenuOpen.value
  cherryPickActionMenuOpen.value = nextOpen
  if (nextOpen) cherryPickActionMenuQuery.value = ''
}

function setCherryPickActionMenuOpen(open: boolean) {
  cherryPickActionMenuOpen.value = open
  if (!open) cherryPickActionMenuQuery.value = ''
}

function onCherryPickActionMenuSelect(item: OptionMenuItem) {
  if (item.id === 'open-conflict') {
    openFirstConflictAndShowDiff()
    return
  }
  if (item.id === 'skip') {
    cherryPickSkip()
    return
  }
  if (item.id === 'use-terminal') {
    openGitTerminalWithCommand(repoRoot.value || '', 'git cherry-pick --continue')
  }
}

const revertActionMenuOpen = ref(false)
const revertActionMenuQuery = ref('')

const revertActionMenuGroups = computed<OptionMenuGroup[]>(() => {
  const items: OptionMenuItem[] = []

  if ((conflictPaths.value || []).length > 0) {
    items.push({ id: 'open-conflict', label: t('git.ui.sequencer.openConflict') })
  }

  items.push({ id: 'skip', label: t('git.ui.sequencer.skip') })
  items.push({ id: 'use-terminal', label: t('common.useTerminal') })

  return [{ id: 'revert-actions', items }]
})

function openRevertActionMenu() {
  const nextOpen = !revertActionMenuOpen.value
  revertActionMenuOpen.value = nextOpen
  if (nextOpen) revertActionMenuQuery.value = ''
}

function setRevertActionMenuOpen(open: boolean) {
  revertActionMenuOpen.value = open
  if (!open) revertActionMenuQuery.value = ''
}

function onRevertActionMenuSelect(item: OptionMenuItem) {
  if (item.id === 'open-conflict') {
    openFirstConflictAndShowDiff()
    return
  }
  if (item.id === 'skip') {
    revertSkip()
    return
  }
  if (item.id === 'use-terminal') {
    openGitTerminalWithCommand(repoRoot.value || '', 'git revert --continue')
  }
}

type SourceControlView = 'changes' | 'history' | 'historyCommit'

const sourceControlView = ref<SourceControlView>('changes')

const gitMultiSelect = useUnifiedMultiSelect()
const allGitSelectablePaths = computed(() => {
  const paths = new Set<string>()
  for (const entry of [...stagedList.value, ...changesList.value, ...untrackedList.value]) {
    const path = String(entry?.path || '').trim()
    if (path) paths.add(path)
  }
  return Array.from(paths)
})

const isHistoryListView = computed(() => sourceControlView.value === 'history')
const isHistoryCommitView = computed(() => sourceControlView.value === 'historyCommit')
const isHistoryView = computed(() => isHistoryListView.value || isHistoryCommitView.value)
const showSshSigningWarning = computed(() => {
  const info = signingInfo.value
  return Boolean(info?.commitGpgsign && (info.gpgFormat || '').toLowerCase() === 'ssh' && !info.sshSigningAvailable)
})

const historyPaginationTotalPages = computed(() => {
  if (historyExactLastPage.value !== null) {
    return Math.max(1, historyExactLastPage.value)
  }
  const known = Math.max(historyKnownLastPage.value, historyCurrentPage.value)
  return historyHasMore.value ? known + 1 : known
})

const historyFilesPaginationTotalPages = computed(() => {
  if (historyFilesExactLastPage.value !== null) {
    return Math.max(1, historyFilesExactLastPage.value)
  }
  const known = Math.max(historyFilesKnownLastPage.value, historyFilesCurrentPage.value)
  return known
})

const historySelectedMeta = computed(() => {
  const commit = historySelected.value
  if (!commit) return ''
  const date = commit.authorDate ? formatDateTimeYMDHM(commit.authorDate) : ''
  const author = (commit.authorName || '').trim() || t('common.unknown')
  return date ? `${author} · ${date}` : author
})

const historySelectedSummary = computed(() => {
  const files = Array.isArray(historyFiles.value) ? historyFiles.value : []
  let insertions = 0
  let deletions = 0
  for (const file of files) {
    insertions += Number(file.insertions || 0)
    deletions += Number(file.deletions || 0)
  }
  return {
    files: files.length,
    insertions,
    deletions,
  }
})

const historyParentCommitHash = computed(() => {
  const commit = historySelected.value
  if (!commit) return ''
  const parents = Array.isArray(commit.parents) ? commit.parents : []
  return String(parents[0] || '').trim()
})

function ensureHistoryLoaded() {
  if (!gitReady.value || !repoRoot.value) return
  if (historyLoading.value || historyCommits.value.length > 0) return
  void loadHistoryPage(1)
}

function openHistoryView() {
  sourceControlView.value = 'history'
  if (props.embedded) {
    embeddedView.value = 'list'
  }
  void loadBranches()
  void loadTags()
  ensureHistoryLoaded()
}

function openChangesView() {
  sourceControlView.value = 'changes'
  if (props.embedded && embeddedView.value === 'diff' && !selectedFile.value) {
    embeddedView.value = 'list'
  }
}

function toggleGitMultiSelectMode() {
  gitMultiSelect.toggleEnabled()
}

function onToggleGitPathSelection(path: string) {
  if (!gitMultiSelect.enabled.value) return
  gitMultiSelect.toggleSelected(path)
}

async function deleteSelectedGitPaths() {
  const targets = [...gitMultiSelect.selectedList.value]
  if (targets.length === 0) return
  for (const path of targets) {
    await deletePath(path, false)
  }
  gitMultiSelect.setEnabled(false)
}

function openHistoryWithRefs() {
  openHistoryView()
}

function openFileHistoryWithRefs(path: string) {
  openFileHistory(path)
  sourceControlView.value = 'history'
  if (props.embedded) {
    embeddedView.value = 'list'
  }
  void loadBranches()
  void loadTags()
}

function onSelectHistoryCommit(commit: Parameters<typeof selectCommit>[0]) {
  sourceControlView.value = 'historyCommit'
  if (props.embedded) {
    embeddedView.value = 'list'
  }
  void selectCommit(commit)
}

function onSelectHistoryCommitFile(file: Parameters<typeof selectCommitFile>[0]) {
  selectCommitFile(file)
  if (!props.embedded) return
  embeddedView.value = 'diff'
}

function onHistoryDiffSelectionUpdate(path: string | null) {
  if (path) return
  clearSelectedFile()
  if (!props.embedded) return
  embeddedView.value = 'list'
}

function backToHistoryList() {
  sourceControlView.value = 'history'
  if (props.embedded) {
    embeddedView.value = 'list'
  }
}

function setHistoryPage(page: number) {
  const next = Math.max(1, Math.floor(page))
  if (next === historyCurrentPage.value && historyCommits.value.length > 0) return
  void loadHistoryPage(next)
}

function setHistoryFilesPage(page: number) {
  const next = Math.max(1, Math.floor(page))
  if (next === historyFilesCurrentPage.value && historyFiles.value.length > 0) return
  void loadCommitFilesAtPage(next)
}

function onApplyHistoryFilters() {
  applyHistoryFilters()
  sourceControlView.value = 'history'
}

function onClearHistoryPathFilter() {
  clearHistoryFilter()
  sourceControlView.value = 'history'
}

watch(
  () => repoRoot.value,
  () => {
    sourceControlView.value = 'changes'
  },
)

watch(
  () => gitReady.value,
  (ready) => {
    if (ready) return
    sourceControlView.value = 'changes'
  },
)

function openMergeDialogWithBranches() {
  openMergeDialog()
  void loadBranches()
}

function openRebaseDialogWithBranches() {
  openRebaseDialog()
  void loadBranches()
}

const remoteNames = computed(() => {
  const list: Array<{ name?: string | null }> = Array.isArray(remoteInfo.value?.remotes) ? remoteInfo.value.remotes : []
  return list
    .map((remote) => (typeof remote?.name === 'string' ? remote.name.trim() : ''))
    .filter((name) => Boolean(name))
})

type HistoryCommitLike = { hash?: string }

function onHistoryCheckout(commit: HistoryCommitLike) {
  detachedRef.value = commit?.hash || ''
  detachedOpen.value = true
}

function onHistoryCreateBranch(commit: HistoryCommitLike) {
  branchFromRef.value = commit?.hash || ''
  branchFromOpen.value = true
}

function onHistoryRevert(commit: HistoryCommitLike) {
  revertCommit(commit?.hash || '')
}

const mergeRebaseBranchOptions = computed(() => {
  const map = (branches?.value?.branches ?? {}) as Record<string, { name?: string; current?: boolean }>
  const items = Object.values(map)
  const options: { label: string; value: string }[] = []
  const seen = new Set<string>()
  for (const b of items) {
    const raw = (b?.name || '').trim()
    if (!raw || b?.current) continue
    if (raw.startsWith('remotes/') && raw.endsWith('/HEAD')) continue
    const label = raw.startsWith('remotes/') ? raw.replace(/^remotes\//, '') : raw
    if (!label || seen.has(label)) continue
    seen.add(label)
    options.push({ label, value: label })
  }
  options.sort((a, b) => a.label.localeCompare(b.label))
  return options
})

const REPO_MENU_PAGE_SIZE = 30
const repoMenuOpen = ref(false)
const repoMenuQuery = ref('')
const repoMenuAnchorEl = ref<HTMLElement | null>(null)

const repoMenuGroups = computed<OptionMenuGroup[]>(() => {
  const selected = String(selectedRepoRelative.value || '.').trim() || '.'
  const repoItems: OptionMenuItem[] = (repoPickerRepos.value || []).map(
    (repo: { relative?: string; root?: string }) => {
      const relative = String(repo.relative || '.').trim() || '.'
      return {
        id: `repo:${relative}`,
        label: relative,
        description: repo.root,
        checked: relative === selected,
        monospace: true,
      }
    },
  )

  const groups: OptionMenuGroup[] = [
    {
      id: 'repos',
      title: t('git.ui.repository'),
      subtitle:
        repoPickerTotalPages.value > 1
          ? `${repoPickerPage.value}/${repoPickerTotalPages.value} · ${repoPickerTotal.value}`
          : undefined,
      items: repoItems,
    },
  ]

  const parentItems: OptionMenuItem[] = (parentRepos.value || []).map((rootPath: string) => ({
    id: `parent:${rootPath}`,
    label: rootPath,
    monospace: true,
  }))

  if (parentItems.length > 0) {
    groups.push({
      id: 'parent-repos',
      title: t('git.ui.dialogs.repoPicker.sections.parentRepos'),
      items: parentItems,
    })
  }

  return groups
})

async function requestRepoMenuPage(page: number, query = repoMenuQuery.value) {
  await loadRepoPickerPage({ page, pageSize: REPO_MENU_PAGE_SIZE, search: query })
}

function refreshRepoMenuOptions() {
  void requestRepoMenuPage(1, repoMenuQuery.value)
}

function toggleRepoMenu() {
  const nextOpen = !repoMenuOpen.value
  repoMenuOpen.value = nextOpen
  if (!nextOpen) {
    repoMenuQuery.value = ''
    return
  }
  void requestRepoMenuPage(1, repoMenuQuery.value)
}

function setRepoMenuOpen(open: boolean) {
  repoMenuOpen.value = open
  if (!open) {
    repoMenuQuery.value = ''
    return
  }
  void requestRepoMenuPage(1, repoMenuQuery.value)
}

function onRepoMenuQueryChange(value: string) {
  repoMenuQuery.value = value
  void requestRepoMenuPage(1, value)
}

function onRepoMenuSelect(item: OptionMenuItem) {
  const id = String(item.id || '')
  if (id.startsWith('parent:')) {
    void openParentRepo(id.slice('parent:'.length))
    repoMenuOpen.value = false
    return
  }
  if (id.startsWith('repo:')) {
    const target = id.slice('repo:'.length).trim() || '.'
    selectRepo(target)
    repoMenuOpen.value = false
  }
}

const branchMenuOpen = ref(false)
const branchMenuQuery = ref('')
const branchMenuAnchorEl = ref<HTMLElement | null>(null)

const branchSwitcherOptions = computed<OptionMenuItem[]>(() => {
  const map = (branchPicker.value?.branches ?? {}) as Record<string, { name?: string; current?: boolean }>
  const options: OptionMenuItem[] = []

  for (const branch of Object.values(map)) {
    const name = String(branch?.name || '').trim()
    if (!name || name.startsWith('remotes/') || name.endsWith('/HEAD')) continue
    options.push({
      id: name,
      label: name,
      checked: Boolean(branch?.current),
      monospace: true,
    })
  }

  if (options.length === 0) {
    const current = String(status.value?.current || '').trim()
    if (current) {
      options.push({
        id: current,
        label: current,
        checked: true,
        monospace: true,
      })
    }
  }

  options.sort((a, b) => {
    if (a.checked && !b.checked) return -1
    if (!a.checked && b.checked) return 1
    return a.label.localeCompare(b.label)
  })

  return options
})

const branchMenuGroups = computed<OptionMenuGroup[]>(() => {
  const groups: OptionMenuGroup[] = [
    {
      id: 'branches',
      title: t('git.ui.dialogs.branches.sections.branches'),
      subtitle:
        branchPickerTotalPages.value > 1 ? `${branchPickerPage.value}/${branchPickerTotalPages.value}` : undefined,
      items: branchSwitcherOptions.value,
    },
  ]

  return groups
})

async function requestBranchMenuPage(page: number, query = branchMenuQuery.value) {
  await loadBranchPicker({ page, pageSize: 40, search: query })
}

function refreshBranchMenuOptions() {
  void requestBranchMenuPage(1, branchMenuQuery.value)
}

function toggleBranchMenu() {
  const nextOpen = !branchMenuOpen.value
  branchMenuOpen.value = nextOpen
  if (!nextOpen) {
    branchMenuQuery.value = ''
    return
  }
  void requestBranchMenuPage(1, branchMenuQuery.value)
}

function setBranchMenuOpen(open: boolean) {
  branchMenuOpen.value = open
  if (!open) {
    branchMenuQuery.value = ''
    return
  }
  void requestBranchMenuPage(1, branchMenuQuery.value)
}

function onBranchMenuQueryChange(value: string) {
  branchMenuQuery.value = value
  void requestBranchMenuPage(1, value)
}

function onBranchMenuSelect(item: OptionMenuItem) {
  const id = String(item.id || '').trim()
  const target = id
  if (!target) return
  const current = String(status.value?.current || '').trim()
  if (current === target) return
  void checkoutBranch(target)
  branchMenuOpen.value = false
}

const actionsMenuAnchorEl = ref<HTMLElement | null>(null)

const embeddedView = ref<'list' | 'diff'>(props.embedded && selectedFile.value ? 'diff' : 'list')

watch(
  () => props.embedded,
  (embedded) => {
    if (!embedded) return
    if (sourceControlView.value === 'historyCommit') {
      embeddedView.value = historyFileSelected.value ? 'diff' : 'list'
      return
    }
    if (sourceControlView.value === 'history') {
      embeddedView.value = 'list'
      return
    }
    embeddedView.value = selectedFile.value ? 'diff' : 'list'
  },
  { immediate: true },
)

watch(
  () => selectedFile.value,
  (path) => {
    if (!props.embedded) return
    if (sourceControlView.value !== 'changes') return
    embeddedView.value = path ? 'diff' : 'list'
  },
)

watch(
  () => sourceControlView.value,
  (view) => {
    if (view !== 'changes') {
      gitMultiSelect.setEnabled(false)
    }
    if (!props.embedded) return
    if (view === 'changes') {
      embeddedView.value = selectedFile.value ? 'diff' : 'list'
      return
    }
    if (view === 'historyCommit') {
      embeddedView.value = historyFileSelected.value ? 'diff' : 'list'
      return
    }
    embeddedView.value = 'list'
  },
)

watch(
  () => allGitSelectablePaths.value,
  (paths) => {
    gitMultiSelect.retain(paths)
  },
  { immediate: true },
)

function showEmbeddedList() {
  if (!props.embedded) return
  embeddedView.value = 'list'
}

function selectFileFromSidebar(path: string, source: 'working' | 'staged') {
  if (gitMultiSelect.enabled.value) {
    gitMultiSelect.toggleSelected(path)
    return
  }
  selectFile(path, source)
  if (!props.embedded) return
  embeddedView.value = 'diff'
}

function openFirstConflictAndShowDiff() {
  openFirstConflict()
  if (!props.embedded) return
  if (!selectedFile.value) return
  embeddedView.value = 'diff'
}

const useShellSidebar = computed(() => {
  if (props.embedded) return embeddedView.value === 'list'
  return ui.isMobile ? ui.isSessionSwitcherOpen : ui.isSidebarOpen
})

const canResizeSidebar = computed(() => !ui.isMobile && !props.embedded)

const sidebarStyle = computed(() => {
  if (ui.isMobile) return undefined
  if (props.embedded) {
    return {
      width: '100%',
    }
  }
  return { width: `${ui.sidebarWidth}px` }
})

const showDiffPane = computed(() => {
  if (props.embedded) return embeddedView.value === 'diff'
  if (isHistoryView.value) return true
  return !ui.isMobile || !ui.isSessionSwitcherOpen
})

// Referenced only by template `ref=` and destructuring, silence noUnusedLocals.
// vue-tsc does not count template-only usage.
void diffPaneRef
</script>

<template>
  <div class="flex h-full bg-background text-foreground overflow-hidden">
    <!-- Left Sidebar (Source Control) -->
    <div
      v-if="useShellSidebar"
      class="oc-vscode-pane relative shrink-0"
      :class="ui.isMobile ? 'w-full' : 'border-r border-sidebar-border/60'"
      :style="sidebarStyle"
    >
      <div
        v-if="canResizeSidebar"
        class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
        @pointerdown="startDesktopSidebarResize"
      />
      <div class="oc-vscode-pane-header">
        <div class="oc-vscode-pane-title">{{ t('git.ui.sourceControl') }}</div>
        <div class="oc-vscode-toolbar">
          <SidebarIconButton
            :tooltip="t('git.actions.fetch')"
            :is-mobile-pointer="ui.isMobilePointer"
            :disabled="!gitReady || !root || repoBusy"
            @click="fetchRemote"
          >
            <RiRefreshLine class="h-3.5 w-3.5" :class="{ 'animate-spin': loading || repoBusy }" />
          </SidebarIconButton>
          <SidebarIconButton
            :tooltip="t('git.actions.pull')"
            :is-mobile-pointer="ui.isMobilePointer"
            :disabled="!gitReady || !root || repoBusy"
            @click="pull"
          >
            <RiArrowDownSLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton
            :tooltip="t('git.actions.push')"
            :is-mobile-pointer="ui.isMobilePointer"
            :disabled="!gitReady || !root || repoBusy"
            @click="push"
          >
            <RiArrowRightSLine class="h-3.5 w-3.5 -rotate-45" />
          </SidebarIconButton>
          <PopoverRoot v-if="showSshSigningWarning">
            <PopoverTrigger as-child>
              <SidebarIconButton
                :tooltip="t('git.ui.signing.sshMayFailTitle')"
                :is-mobile-pointer="ui.isMobilePointer"
                :disable-tooltip="true"
                class="text-amber-600 hover:text-amber-700 hover:bg-amber-500/15"
                :aria-label="t('git.ui.signing.sshMayFailTitle')"
              >
                <span aria-hidden="true" class="text-[12px] font-bold leading-none">!</span>
              </SidebarIconButton>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                class="z-[80] w-72 max-w-[calc(100vw-1rem)] rounded-sm border border-amber-500/40 bg-background/95 p-2 shadow-lg backdrop-blur outline-none"
                side="bottom"
                align="end"
                :side-offset="6"
                :collision-padding="8"
              >
                <div class="text-[11px] font-medium text-foreground">
                  {{ t('git.ui.signing.sshMayFailTitle') }}
                </div>
                <div class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {{ t('git.ui.signing.sshMayFailDescription') }}
                </div>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
          <div ref="actionsMenuAnchorEl" class="inline-flex">
            <SidebarIconButton
              :tooltip="t('git.ui.moreActions')"
              :is-mobile-pointer="ui.isMobilePointer"
              :disabled="!gitReady || !root || repoBusy"
              @mousedown.prevent
              @click.stop="actionsOpen = !actionsOpen"
            >
              <RiMore2Line class="h-3.5 w-3.5" />
            </SidebarIconButton>
          </div>
        </div>
      </div>

      <div class="border-b border-sidebar-border/50 px-2 py-1.5">
        <!-- Repository Selector -->
        <div class="relative">
          <button
            ref="repoMenuAnchorEl"
            type="button"
            class="w-full flex items-center gap-2 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-1.5 text-left transition"
            :class="projectRoot ? 'hover:bg-sidebar-accent/40' : 'opacity-70 cursor-not-allowed'"
            :disabled="!projectRoot"
            @mousedown.prevent
            @click.stop="toggleRepoMenu"
          >
            <span class="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{{
              t('git.ui.repository')
            }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" :title="selectedRepoLabel">{{
              selectedRepoLabel
            }}</span>
            <span v-if="repoPickerLoading || reposLoading" class="shrink-0 text-[10px] text-muted-foreground">{{
              t('common.scanning')
            }}</span>
            <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          <OptionMenu
            :open="repoMenuOpen"
            :query="repoMenuQuery"
            :groups="repoMenuGroups"
            :title="t('git.ui.dialogs.repoPicker.title')"
            :mobile-title="t('git.ui.dialogs.repoPicker.title')"
            :is-mobile-pointer="ui.isMobilePointer"
            :filter-mode="'external'"
            :close-on-select="false"
            :desktop-fixed="true"
            :desktop-anchor-el="repoMenuAnchorEl"
            :external-page="repoPickerPage"
            :external-page-count="repoPickerTotalPages"
            :external-pager-loading="repoPickerLoading"
            :loading="repoPickerLoading || reposLoading"
            :refreshable="true"
            :on-refresh="refreshRepoMenuOptions"
            desktop-placement="bottom-start"
            desktop-class="w-[26rem] max-w-[calc(100vw-1rem)]"
            @update:open="setRepoMenuOpen"
            @update:query="onRepoMenuQueryChange"
            @request-page="requestRepoMenuPage"
            @select="onRepoMenuSelect"
          />
        </div>

        <div v-if="reposError" class="mt-1.5 text-xs text-destructive/90">
          {{ reposError }}
        </div>

        <div v-else-if="error" class="mt-1.5 text-xs text-destructive/90 whitespace-pre-line">
          {{ error }}
        </div>

        <div v-if="gitReady" class="mt-1.5">
          <div class="relative">
            <button
              ref="branchMenuAnchorEl"
              type="button"
              class="w-full flex items-center gap-1.5 rounded-sm px-1 py-1 text-[11px] transition-colors hover:bg-sidebar-accent/40"
              :disabled="repoBusy"
              @mousedown.prevent
              @click.stop="toggleBranchMenu"
            >
              <RiGitBranchLine class="h-3.5 w-3.5 shrink-0 text-primary" />
              <span class="min-w-0 flex-1 truncate text-left font-mono text-foreground/90" :title="status?.current">{{
                headline
              }}</span>
              <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            <OptionMenu
              :open="branchMenuOpen"
              :query="branchMenuQuery"
              :groups="branchMenuGroups"
              :title="t('git.ui.dialogs.branches.title')"
              :mobile-title="t('git.ui.dialogs.branches.title')"
              :is-mobile-pointer="ui.isMobilePointer"
              :filter-mode="'external'"
              :close-on-select="false"
              :desktop-fixed="true"
              :desktop-anchor-el="branchMenuAnchorEl"
              :external-page="branchPickerPage"
              :external-page-count="branchPickerTotalPages"
              :external-pager-loading="branchPickerLoading"
              :loading="branchPickerLoading"
              :refreshable="true"
              :on-refresh="refreshBranchMenuOptions"
              desktop-placement="bottom-start"
              desktop-class="w-72"
              @update:open="setBranchMenuOpen"
              @update:query="onBranchMenuQueryChange"
              @request-page="requestBranchMenuPage"
              @select="onBranchMenuSelect"
            />
          </div>
        </div>

        <div v-if="gitReady" class="mt-1.5 flex items-center gap-1 rounded-sm border border-sidebar-border/60 p-0.5">
          <button
            type="button"
            class="flex-1 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              sourceControlView === 'changes'
                ? 'bg-sidebar-accent/60 text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/35 hover:text-foreground'
            "
            @click="openChangesView"
          >
            {{ t('git.ui.workingTree.sections.changes') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              sourceControlView !== 'changes'
                ? 'bg-sidebar-accent/60 text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/35 hover:text-foreground'
            "
            @click="openHistoryView"
          >
            {{ t('git.ui.dialogs.history.title') }}
          </button>
        </div>
      </div>

      <ScrollArea class="flex-1 min-h-0">
        <div v-if="sourceControlView === 'changes'" class="space-y-2 p-1.5">
          <div
            v-if="gitReady"
            class="flex items-center justify-between gap-2 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-1.5"
          >
            <div class="text-[11px] text-muted-foreground">
              {{
                gitMultiSelect.enabled
                  ? t('git.ui.workingTree.multiSelect.on')
                  : t('git.ui.workingTree.multiSelect.off')
              }}
              <span v-if="gitMultiSelect.enabled" class="ml-1"
                >({{
                  t('git.ui.workingTree.multiSelect.selectedCount', { count: gitMultiSelect.selectedCount })
                }})</span
              >
            </div>
            <div class="flex items-center gap-1">
              <MiniActionButton size="xs" @click="toggleGitMultiSelectMode">
                {{
                  gitMultiSelect.enabled
                    ? t('git.ui.workingTree.actions.exitMultiSelect')
                    : t('git.ui.workingTree.actions.enterMultiSelect')
                }}
              </MiniActionButton>
              <ConfirmPopover
                :title="t('git.ui.workingTree.confirmDeleteSelected.title')"
                :description="
                  t('git.ui.workingTree.confirmDeleteSelected.description', { count: gitMultiSelect.selectedCount })
                "
                :confirm-text="t('git.ui.workingTree.actions.deleteSelected')"
                :cancel-text="t('common.cancel')"
                variant="destructive"
                @confirm="deleteSelectedGitPaths"
              >
                <MiniActionButton
                  size="xs"
                  variant="destructive"
                  :disabled="!gitMultiSelect.enabled || gitMultiSelect.selectedCount === 0"
                  @click.stop
                >
                  <RiDeleteBinLine class="h-3.5 w-3.5 mr-1" />
                  {{ t('git.ui.workingTree.actions.deleteSelected') }}
                </MiniActionButton>
              </ConfirmPopover>
            </div>
          </div>

          <!-- Commit Section -->
          <div v-if="gitReady" class="space-y-2">
            <div
              v-if="gitState?.mergeInProgress"
              class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 p-2 text-[11px]"
            >
              <div class="font-medium">{{ t('git.ui.sequencer.mergeInProgressTitle') }}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">
                {{ t('git.ui.sequencer.mergeInProgressDescription') }}
              </div>
              <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                <MiniActionButton variant="destructive" @click="abortMerge">{{ t('common.abort') }}</MiniActionButton>

                <div class="relative">
                  <IconButton
                    size="sm"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="t('git.ui.sequencer.moreMergeActions')"
                    :aria-label="t('git.ui.sequencer.moreMergeActions')"
                    @click.stop="openMergeActionMenu"
                  >
                    <RiMore2Line class="h-4 w-4" />
                  </IconButton>

                  <OptionMenu
                    :open="mergeActionMenuOpen"
                    :query="mergeActionMenuQuery"
                    :groups="mergeActionMenuGroups"
                    :title="t('git.ui.sequencer.mergeActions')"
                    :mobile-title="t('git.ui.sequencer.mergeActions')"
                    :searchable="false"
                    :is-mobile-pointer="ui.isMobilePointer"
                    desktop-placement="bottom-end"
                    desktop-class="w-48"
                    @update:open="setMergeActionMenuOpen"
                    @update:query="(v) => (mergeActionMenuQuery = v)"
                    @select="onMergeActionMenuSelect"
                  />
                </div>
              </div>
            </div>

            <div
              v-else-if="gitState?.rebaseInProgress"
              class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 p-2 text-[11px]"
            >
              <div class="font-medium">{{ t('git.ui.sequencer.rebaseInProgressTitle') }}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">
                {{ t('git.ui.sequencer.rebaseInProgressDescription') }}
              </div>
              <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                <MiniActionButton @click="rebaseContinue">{{ t('common.continue') }}</MiniActionButton>
                <MiniActionButton variant="destructive" @click="abortRebase">{{ t('common.abort') }}</MiniActionButton>

                <div class="relative">
                  <IconButton
                    size="sm"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="t('git.ui.sequencer.moreRebaseActions')"
                    :aria-label="t('git.ui.sequencer.moreRebaseActions')"
                    @click.stop="openRebaseActionMenu"
                  >
                    <RiMore2Line class="h-4 w-4" />
                  </IconButton>

                  <OptionMenu
                    :open="rebaseActionMenuOpen"
                    :query="rebaseActionMenuQuery"
                    :groups="rebaseActionMenuGroups"
                    :title="t('git.ui.sequencer.rebaseActions')"
                    :mobile-title="t('git.ui.sequencer.rebaseActions')"
                    :searchable="false"
                    :is-mobile-pointer="ui.isMobilePointer"
                    desktop-placement="bottom-end"
                    desktop-class="w-48"
                    @update:open="setRebaseActionMenuOpen"
                    @update:query="(v) => (rebaseActionMenuQuery = v)"
                    @select="onRebaseActionMenuSelect"
                  />
                </div>
              </div>
            </div>

            <div
              v-else-if="gitState?.cherryPickInProgress"
              class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 p-2 text-[11px]"
            >
              <div class="font-medium">{{ t('git.ui.sequencer.cherryPickInProgressTitle') }}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">
                {{ t('git.ui.sequencer.cherryPickInProgressDescription') }}
              </div>
              <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                <MiniActionButton @click="cherryPickContinue">{{ t('common.continue') }}</MiniActionButton>
                <MiniActionButton variant="destructive" @click="cherryPickAbort">{{
                  t('common.abort')
                }}</MiniActionButton>

                <div class="relative">
                  <IconButton
                    size="sm"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="t('git.ui.sequencer.moreCherryPickActions')"
                    :aria-label="t('git.ui.sequencer.moreCherryPickActions')"
                    @click.stop="openCherryPickActionMenu"
                  >
                    <RiMore2Line class="h-4 w-4" />
                  </IconButton>

                  <OptionMenu
                    :open="cherryPickActionMenuOpen"
                    :query="cherryPickActionMenuQuery"
                    :groups="cherryPickActionMenuGroups"
                    :title="t('git.ui.sequencer.cherryPickActions')"
                    :mobile-title="t('git.ui.sequencer.cherryPickActions')"
                    :searchable="false"
                    :is-mobile-pointer="ui.isMobilePointer"
                    desktop-placement="bottom-end"
                    desktop-class="w-48"
                    @update:open="setCherryPickActionMenuOpen"
                    @update:query="(v) => (cherryPickActionMenuQuery = v)"
                    @select="onCherryPickActionMenuSelect"
                  />
                </div>
              </div>
            </div>

            <div
              v-else-if="gitState?.revertInProgress"
              class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 p-2 text-[11px]"
            >
              <div class="font-medium">{{ t('git.ui.sequencer.revertInProgressTitle') }}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">
                {{ t('git.ui.sequencer.revertInProgressDescription') }}
              </div>
              <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                <MiniActionButton @click="revertContinue">{{ t('common.continue') }}</MiniActionButton>
                <MiniActionButton variant="destructive" @click="revertAbortSeq">{{
                  t('common.abort')
                }}</MiniActionButton>

                <div class="relative">
                  <IconButton
                    size="sm"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="t('git.ui.sequencer.moreRevertActions')"
                    :aria-label="t('git.ui.sequencer.moreRevertActions')"
                    @click.stop="openRevertActionMenu"
                  >
                    <RiMore2Line class="h-4 w-4" />
                  </IconButton>

                  <OptionMenu
                    :open="revertActionMenuOpen"
                    :query="revertActionMenuQuery"
                    :groups="revertActionMenuGroups"
                    :title="t('git.ui.sequencer.revertActions')"
                    :mobile-title="t('git.ui.sequencer.revertActions')"
                    :searchable="false"
                    :is-mobile-pointer="ui.isMobilePointer"
                    desktop-placement="bottom-end"
                    desktop-class="w-48"
                    @update:open="setRevertActionMenuOpen"
                    @update:query="(v) => (revertActionMenuQuery = v)"
                    @select="onRevertActionMenuSelect"
                  />
                </div>
              </div>
            </div>

            <GitCommitBox
              v-model:message="commitMessage"
              :committing="committing"
              :gitmoji-enabled="gitmojiEnabled"
              :gitmojis="gitmojis"
              v-model:selectedGitmoji="selectedGitmoji"
              @insertGitmoji="insertGitmoji"
              @messageKeydown="onCommitMessageKeydown"
              @commit="commitStaged"
            />
          </div>

          <div
            v-if="!projectRoot"
            class="mx-1 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3 text-center"
          >
            <div class="text-sm font-medium">{{ t('git.ui.noProjectSelectedTitle') }}</div>
            <div class="text-xs text-muted-foreground mt-1">{{ t('git.ui.noProjectSelectedDescription') }}</div>
          </div>

          <div
            v-else-if="!gitReady && !loading"
            class="mx-1 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3 text-center"
          >
            <div class="text-sm font-medium">{{ t('git.ui.noGitRepositoryTitle') }}</div>
            <div class="text-xs text-muted-foreground mt-1">
              {{ t('git.ui.noGitRepositoryDescription') }}
            </div>
            <div
              v-if="unsafeRepoDetected"
              class="mt-3 rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-left"
            >
              <div class="text-xs font-medium">{{ t('git.ui.unsafeRepo.trustRequiredTitle') }}</div>
              <div class="mt-1 text-[11px] text-muted-foreground break-words">
                {{ unsafeRepoHint || t('git.ui.unsafeRepo.blockedDefaultHint') }}
              </div>
              <div class="mt-1 text-[11px] font-mono break-all" :title="unsafeRepoPath">{{ unsafeRepoPath }}</div>
              <div class="mt-2 flex justify-end">
                <MiniActionButton variant="default" :disabled="unsafeRepoBusy" @click="trustUnsafeRepo">
                  {{ t('git.ui.unsafeRepo.trustThisRepository') }}
                </MiniActionButton>
              </div>
            </div>
            <div class="mt-3 flex items-center justify-center gap-2">
              <MiniActionButton size="xs" @click="toggleRepoMenu">{{ t('git.ui.selectRepo') }}</MiniActionButton>
              <MiniActionButton variant="default" size="xs" @click="initRepoOpen = true">{{
                t('git.ui.initialize')
              }}</MiniActionButton>
            </div>
          </div>

          <div v-if="gitReady" class="space-y-0">
            <GitStashPanel
              v-model:expanded="isStashExpanded"
              :stashes="stashList"
              :loading="stashLoading"
              :can-operate="!!repoRoot"
              :is-mobile-pointer="ui.isMobilePointer"
              @openCreate="stashDialogOpen = true"
              @dropAll="stashDropAll"
              @view="stashView"
              @apply="(ref: string) => stashAction('apply', ref)"
              @pop="(ref: string) => stashAction('pop', ref)"
              @branch="stashBranchFrom"
              @drop="(ref: string) => stashAction('drop', ref)"
            />

            <GitMergeChangesSection
              v-if="mergeCount > 0"
              v-model:expanded="isMergeExpanded"
              :count="mergeCount"
              :files="mergeList"
              :selected-file="selectedFile"
              :diff-source="diffSource"
              :has-more="hasMoreMerge"
              :loading="mergeListLoading"
              :can-operate="!!root"
              :is-mobile-pointer="ui.isMobilePointer"
              @select="(p: string) => selectFileFromSidebar(p, 'working')"
              @unstage="(p: string) => unstagePaths([p])"
              @stage="(p: string) => stagePaths([p])"
              @rename="openRenameDialog"
              @history="(p: string) => openFileHistoryWithRefs(p)"
              @discard="(p: string) => revertFile(p)"
              @delete="(p: string) => deletePath(p, false)"
              @deleteForce="(p: string) => deletePath(p, true)"
              @showMore="showMoreMerge"
            />

            <GitStagedChangesSection
              v-model:expanded="isStagedExpanded"
              :count="stagedCount"
              :files="stagedList"
              :selected-file="selectedFile"
              :diff-source="diffSource"
              :has-more="hasMoreStaged"
              :loading="stagedListLoading"
              :can-operate="!!root"
              :is-mobile-pointer="ui.isMobilePointer"
              :multi-select-mode="gitMultiSelect.enabled"
              :selected-paths="gitMultiSelect.selectedList"
              @select="(p: string) => selectFileFromSidebar(p, 'staged')"
              @toggleSelect="onToggleGitPathSelection"
              @unstageAll="unstageAll"
              @unstage="(p: string) => unstagePaths([p])"
              @rename="openRenameDialog"
              @history="(p: string) => openFileHistoryWithRefs(p)"
              @discard="(p: string) => revertFile(p)"
              @delete="(p: string) => deletePath(p, false)"
              @deleteForce="(p: string) => deletePath(p, true)"
              @showMore="showMoreStaged"
            />

            <GitChangesSection
              v-model:expanded="isChangesExpanded"
              :count="changesCount"
              :files="changesList"
              :selected-file="selectedFile"
              :diff-source="diffSource"
              :has-more="hasMoreUnstaged"
              :loading="changesListLoading"
              :can-operate="!!root"
              :is-mobile-pointer="ui.isMobilePointer"
              :multi-select-mode="gitMultiSelect.enabled"
              :selected-paths="gitMultiSelect.selectedList"
              @select="(p: string) => selectFileFromSidebar(p, 'working')"
              @toggleSelect="onToggleGitPathSelection"
              @stageAll="stageAllTracked"
              @discardAll="discardAllTracked"
              @stage="(p: string) => stagePaths([p])"
              @rename="openRenameDialog"
              @history="(p: string) => openFileHistoryWithRefs(p)"
              @discard="(p: string) => revertFile(p)"
              @delete="(p: string) => deletePath(p, false)"
              @deleteForce="(p: string) => deletePath(p, true)"
              @showMore="showMoreChanges"
            />

            <GitUntrackedSection
              v-model:expanded="isUntrackedExpanded"
              :count="untrackedCount"
              :files="untrackedList"
              :selected-file="selectedFile"
              :diff-source="diffSource"
              :has-more="hasMoreUntracked"
              :loading="untrackedListLoading"
              :can-operate="!!root"
              :is-mobile-pointer="ui.isMobilePointer"
              :multi-select-mode="gitMultiSelect.enabled"
              :selected-paths="gitMultiSelect.selectedList"
              @select="(p: string) => selectFileFromSidebar(p, 'working')"
              @toggleSelect="onToggleGitPathSelection"
              @stageAll="stageAllUntracked"
              @discardAll="() => cleanUntracked(false)"
              @stage="(p: string) => stagePaths([p])"
              @rename="openRenameDialog"
              @discard="(p: string) => revertFile(p)"
              @ignore="(p: string) => ignorePath(p)"
              @showMore="showMoreUntracked"
            />
          </div>
        </div>

        <div v-else-if="sourceControlView === 'history'" class="space-y-2 p-1.5">
          <div
            v-if="!projectRoot"
            class="mx-1 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3 text-center"
          >
            <div class="text-sm font-medium">{{ t('git.ui.noProjectSelectedTitle') }}</div>
            <div class="text-xs text-muted-foreground mt-1">{{ t('git.ui.noProjectSelectedDescription') }}</div>
          </div>

          <div
            v-else-if="!gitReady && !loading"
            class="mx-1 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3 text-center"
          >
            <div class="text-sm font-medium">{{ t('git.ui.noGitRepositoryTitle') }}</div>
            <div class="text-xs text-muted-foreground mt-1">{{ t('git.ui.noGitRepositoryDescription') }}</div>
          </div>

          <template v-else>
            <div class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <div class="text-[11px] font-medium text-muted-foreground">{{ t('common.search') }}</div>
              </div>

              <div v-if="historyFilterPath" class="mb-2 flex items-center justify-between gap-2">
                <div class="truncate text-[10px] text-muted-foreground font-mono" :title="historyFilterPath">
                  {{ historyFilterPath }}
                </div>
                <IconButton
                  size="xs"
                  :tooltip="t('common.clear')"
                  :aria-label="t('common.clear')"
                  @click="onClearHistoryPathFilter"
                >
                  <RiCloseLine class="h-3.5 w-3.5" />
                </IconButton>
              </div>

              <div class="grid gap-2">
                <SearchInput
                  v-model="historySearchDraft"
                  class="flex-1 text-xs"
                  input-class="h-8 font-mono text-xs"
                  :placeholder="t('git.ui.dialogs.history.placeholders.commitMetaContains')"
                  :input-aria-label="t('common.search')"
                  :input-title="t('common.search')"
                  :search-aria-label="t('common.search')"
                  :search-title="t('common.search')"
                  :clear-aria-label="t('common.clear')"
                  :clear-title="t('common.clear')"
                  :is-mobile-pointer="ui.isMobilePointer"
                  @search="onApplyHistoryFilters"
                />
              </div>
            </div>

            <div class="rounded-sm border border-sidebar-border/60 overflow-hidden">
              <div class="border-b border-sidebar-border/50 px-2 py-1">
                <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div aria-hidden="true" />
                  <PaginationControls
                    class="justify-center"
                    :page="historyCurrentPage"
                    :total-pages="historyPaginationTotalPages"
                    :disabled="historyLoading"
                    :prev-label="t('common.previousPage')"
                    :next-label="t('common.nextPage')"
                    :page-input-label="t('common.currentPage')"
                    @update:page="setHistoryPage"
                  />
                  <div class="flex justify-end">
                    <IconButton
                      size="xs"
                      :tooltip="t('common.refresh')"
                      :aria-label="t('common.refresh')"
                      :disabled="historyLoading"
                      @click="refreshHistory"
                    >
                      <RiRefreshLine class="h-3.5 w-3.5" :class="historyLoading ? 'animate-spin' : ''" />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div v-if="historyError" class="px-2 py-2 text-xs text-destructive">
                {{ historyError }}
              </div>
              <div v-else-if="historyLoading && !historyCommits.length" class="px-2 py-2 text-xs text-muted-foreground">
                {{ t('common.loading') }}
              </div>
              <div v-else-if="!historyCommits.length" class="px-2 py-2 text-xs text-muted-foreground">
                {{ t('git.ui.dialogs.history.emptyCommits') }}
              </div>
              <div v-else class="divide-y divide-sidebar-border/50">
                <button
                  v-for="commit in historyCommits"
                  :key="commit.hash"
                  type="button"
                  class="w-full px-2 py-1.5 text-left hover:bg-sidebar-accent/35"
                  @click="onSelectHistoryCommit(commit)"
                >
                  <div class="truncate text-[11px] font-medium text-foreground">
                    {{ commit.subject || t('git.ui.dialogs.history.noMessage') }}
                  </div>
                  <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span class="font-mono">{{ commit.shortHash }}</span>
                    <span class="truncate">{{ commit.authorName || t('common.unknown') }}</span>
                    <span v-if="commit.authorDate">{{ formatDateTimeYMDHM(commit.authorDate) }}</span>
                  </div>
                </button>
              </div>
            </div>

            <div class="px-1 py-0.5">
              <PaginationControls
                class="w-full justify-center"
                :page="historyCurrentPage"
                :total-pages="historyPaginationTotalPages"
                :disabled="historyLoading"
                :prev-label="t('common.previousPage')"
                :next-label="t('common.nextPage')"
                :page-input-label="t('common.currentPage')"
                @update:page="setHistoryPage"
              />
            </div>
          </template>
        </div>

        <div v-else class="space-y-2 p-1.5">
          <div class="flex items-center justify-between gap-2 rounded-sm border border-sidebar-border/60 px-2 py-1.5">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              @click="backToHistoryList"
            >
              <RiArrowLeftSLine class="h-3.5 w-3.5" />
              {{ t('git.ui.dialogs.history.title') }}
            </button>
          </div>

          <div
            v-if="!historySelected"
            class="rounded-sm border border-sidebar-border/60 px-2 py-2 text-xs text-muted-foreground"
          >
            {{ t('git.ui.dialogs.history.selectCommitToViewDiff') }}
          </div>

          <template v-else>
            <div class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-2">
              <div class="truncate text-xs font-medium text-foreground" :title="historySelected.subject || ''">
                {{ historySelected.subject || t('git.ui.dialogs.history.noMessage') }}
              </div>
              <div class="mt-1 text-[10px] text-muted-foreground">{{ historySelectedMeta }}</div>
              <div class="mt-0.5 flex items-center gap-1">
                <div class="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                  {{ historySelected.hash }}
                </div>
                <IconButton
                  size="sm"
                  :tooltip="t('git.ui.dialogs.history.actions.copyHash')"
                  :aria-label="t('git.ui.dialogs.history.actions.copyHash')"
                  @click="copyCommitHash(historySelected.hash)"
                >
                  <RiClipboardLine class="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <div class="mt-1 text-[10px] text-muted-foreground">
                {{ t('common.files') }}: {{ historySelectedSummary.files }} · +{{
                  historySelectedSummary.insertions
                }}
                -{{ historySelectedSummary.deletions }}
              </div>

              <div class="mt-2 flex flex-wrap gap-1">
                <MiniActionButton size="xs" @click="onHistoryCheckout(historySelected)">{{
                  t('git.ui.dialogs.history.actions.checkout')
                }}</MiniActionButton>
                <MiniActionButton size="xs" @click="onHistoryCreateBranch(historySelected)">{{
                  t('git.ui.dialogs.history.actions.createBranch')
                }}</MiniActionButton>
                <MiniActionButton size="xs" variant="destructive" @click="onHistoryRevert(historySelected)">{{
                  t('git.ui.dialogs.history.actions.revert')
                }}</MiniActionButton>
              </div>
            </div>

            <div class="rounded-sm border border-sidebar-border/60 overflow-hidden">
              <div class="border-b border-sidebar-border/50 px-2 py-1">
                <div class="text-[11px] font-medium text-muted-foreground">
                  {{ t('git.ui.dialogs.history.sections.files') }}
                </div>
              </div>
              <div v-if="historyFilesError" class="px-2 py-2 text-xs text-destructive">{{ historyFilesError }}</div>
              <div v-else-if="historyFilesLoading" class="px-2 py-2 text-xs text-muted-foreground">
                {{ t('git.ui.dialogs.history.loadingFiles') }}
              </div>
              <div v-else-if="!historyFiles.length" class="px-2 py-2 text-xs text-muted-foreground">
                {{ t('git.ui.dialogs.history.emptyFiles') }}
              </div>
              <div v-else class="divide-y divide-sidebar-border/50">
                <button
                  v-for="file in historyFiles"
                  :key="`${file.status}:${file.path}`"
                  type="button"
                  class="w-full px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent/35"
                  :class="historyFileSelected?.path === file.path ? 'bg-sidebar-accent/45' : ''"
                  @click="onSelectHistoryCommitFile(file)"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="w-4 text-[10px] font-mono text-muted-foreground">{{ file.status }}</span>
                    <span class="flex-1 truncate font-mono">{{ file.path }}</span>
                    <span v-if="file.insertions > 0" class="text-[10px] font-mono text-emerald-500"
                      >+{{ file.insertions }}</span
                    >
                    <span v-if="file.deletions > 0" class="text-[10px] font-mono text-rose-500"
                      >-{{ file.deletions }}</span
                    >
                  </div>
                </button>
              </div>
              <div
                v-if="historySelected && historyFilesPaginationTotalPages > 1"
                class="border-t border-sidebar-border/50 px-1 py-0.5"
              >
                <PaginationControls
                  class="w-full justify-center"
                  :page="historyFilesCurrentPage"
                  :total-pages="historyFilesPaginationTotalPages"
                  :disabled="historyFilesLoading"
                  :prev-label="t('common.previousPage')"
                  :next-label="t('common.nextPage')"
                  :page-input-label="t('common.currentPage')"
                  @update:page="setHistoryFilesPage"
                />
              </div>
            </div>
          </template>
        </div>
      </ScrollArea>
    </div>

    <div class="min-w-0 flex flex-1 flex-col overflow-hidden" v-show="showDiffPane">
      <div v-if="props.embedded" class="flex items-center gap-2 border-b border-sidebar-border/50 px-2 py-1.5">
        <IconButton
          size="sm"
          :tooltip="t('git.ui.sourceControl')"
          :aria-label="t('git.ui.sourceControl')"
          @click="showEmbeddedList"
        >
          <RiArrowLeftSLine class="h-4 w-4" />
        </IconButton>
        <div class="truncate text-xs text-muted-foreground">{{ t('git.ui.sourceControl') }}</div>
      </div>

      <div
        v-if="sourceControlView === 'history'"
        class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground"
      >
        {{ t('git.ui.dialogs.history.selectCommitToViewDiff') }}
      </div>

      <div v-else-if="sourceControlView === 'historyCommit'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <GitDiffPane
          :directory="root || ''"
          :selected-file="historyFileSelected?.path || null"
          :diff-source="'working'"
          :commit="historySelected?.hash || ''"
          :parent-commit="historyParentCommitHash"
          :is-mobile="ui.isMobile"
          :selected-is-conflict="false"
          :open-file="openFileInFiles"
          :reveal-file="revealFileInFiles"
          @update:selectedFile="onHistoryDiffSelectionUpdate"
        />
      </div>

      <template v-else>
        <MobileSidebarEmptyState
          v-if="ui.isMobile && !selectedFile"
          :title="t('git.ui.dialogs.selectChangedFileTitle')"
          :description="t('git.ui.dialogs.selectChangedFileDescription')"
          :action-label="t('git.ui.dialogs.openSourceControlPanel')"
          :show-action="true"
          @action="ui.setSessionSwitcherOpen(true)"
        />

        <GitDiffPane
          v-else
          ref="diffPaneRef"
          :directory="root || ''"
          v-model:selectedFile="selectedFile"
          :diff-source="diffSource"
          :is-mobile="ui.isMobile"
          :selected-is-conflict="selectedIsConflict"
          :conflict-paths="conflictPaths"
          :stage-hunk="stageHunk"
          :unstage-hunk="unstageHunk"
          :discard-hunk="discardHunk"
          :stage-selected="stageSelected"
          :unstage-selected="unstageSelected"
          :discard-selected="discardSelected"
          :open-file="openFileInFiles"
          :reveal-file="revealFileInFiles"
          @resolved="load"
        />
      </template>
    </div>

    <GitBranchesDialog
      :open="isBranchDialogOpen"
      :branches-loading="branchesLoading"
      :branches="branches"
      v-model:newBranchName="newBranchName"
      @update:open="isBranchDialogOpen = $event"
      @create="createBranch"
      @checkout="checkoutBranch"
      @delete="deleteBranch"
      @deleteRemote="deleteRemoteBranch"
      @rename="openRenameBranch"
    />

    <GitRenameBranchDialog
      :open="renameBranchOpen"
      v-model:from="renameBranchFrom"
      v-model:to="renameBranchTo"
      @update:open="renameBranchOpen = $event"
      @submit="submitRenameBranch"
    />

    <GitBranchActionDialog
      :open="mergeDialogOpen"
      :title="t('git.ui.dialogs.mergeBranchTitle')"
      :description="t('git.ui.dialogs.mergeBranchDescription')"
      :action-label="t('git.actions.merge')"
      v-model:branch="mergeTarget"
      :branches="mergeRebaseBranchOptions"
      :busy="mergeBusy"
      @update:open="mergeDialogOpen = $event"
      @submit="startMerge"
    />

    <GitBranchActionDialog
      :open="rebaseDialogOpen"
      :title="t('git.ui.dialogs.rebaseBranchTitle')"
      :description="t('git.ui.dialogs.rebaseBranchDescription')"
      :action-label="t('git.actions.rebase')"
      v-model:branch="rebaseTarget"
      :branches="mergeRebaseBranchOptions"
      :busy="rebaseBusy"
      @update:open="rebaseDialogOpen = $event"
      @submit="startRebase"
    />

    <GitCompareDialog
      :open="compareOpen"
      v-model:base="compareBase"
      v-model:head="compareHead"
      v-model:path="comparePath"
      :diff="compareDiff"
      :loading="compareLoading"
      :error="compareError"
      @update:open="
        (v: boolean) => {
          if (v) {
            openCompareDialog()
          } else {
            closeCompareDialog()
            resetCompare()
          }
        }
      "
      @swap="swapCompareRefs"
      @compare="runCompare"
    />

    <GitSubmodulesDialog
      :open="submodulesOpen"
      :loading="submodulesLoading"
      :error="submodulesError"
      :submodules="submodules"
      v-model:newUrl="newSubmoduleUrl"
      v-model:newPath="newSubmodulePath"
      v-model:newBranch="newSubmoduleBranch"
      @update:open="(v: boolean) => (submodulesOpen = v)"
      @refresh="loadSubmodules"
      @add="addSubmodule"
      @init="initSubmodule"
      @update="
        (payload: { path: string; recursive: boolean; init: boolean }) =>
          updateSubmodule(payload.path, payload.recursive, payload.init)
      "
    />

    <GitLfsDialog
      :open="lfsOpen"
      :loading="lfsLoading"
      :error="lfsError"
      :installed="lfsInstalled"
      :version="lfsVersion"
      :tracked="lfsTracked"
      v-model:trackPattern="lfsTrackPattern"
      v-model:lockPath="lfsLockPath"
      :locks="lfsLocks"
      :locks-loading="lfsLocksLoading"
      @update:open="(v: boolean) => (v ? openLfs() : (lfsOpen = false))"
      @refresh="refreshLfs"
      @install="installLfs"
      @track="trackLfsPattern"
      @lock="lockLfsPath"
      @unlock="(payload: { path: string; force: boolean }) => unlockLfsPath(payload.path, payload.force)"
    />

    <GitAutoFetchDialog
      :open="autoFetchDialogOpen"
      :auto-fetch-enabled="autoFetchEnabled"
      :auto-fetch-interval="autoFetchIntervalMinutes"
      :auto-sync-enabled="autoSyncEnabled"
      :auto-sync-interval="autoSyncIntervalMinutes"
      :post-commit-command="gitPostCommitCommand"
      @update:open="(v: boolean) => (autoFetchDialogOpen = v)"
      @update:autoFetchEnabled="(v: boolean) => (autoFetchEnabled = v)"
      @update:autoFetchInterval="(v: number) => (autoFetchIntervalMinutes = v)"
      @update:autoSyncEnabled="(v: boolean) => (autoSyncEnabled = v)"
      @update:autoSyncInterval="(v: number) => (autoSyncIntervalMinutes = v)"
      @update:postCommitCommand="(v: 'none' | 'push' | 'sync') => (gitPostCommitCommand = v)"
    />

    <GitCloneDialog
      :open="cloneRepoOpen"
      :project-root="projectRoot || ''"
      v-model:url="cloneRepoUrl"
      v-model:path="cloneRepoPath"
      v-model:cloneRef="cloneRepoRef"
      v-model:recursive="cloneRepoRecursive"
      :busy="cloneRepoBusy"
      @update:open="
        (v: boolean) => {
          cloneRepoOpen = v
        }
      "
      @clone="cloneRepo"
    />

    <GitInitRepoDialog
      :open="initRepoOpen"
      :project-root="projectRoot || ''"
      v-model:path="initRepoPath"
      v-model:defaultBranch="initRepoDefaultBranch"
      :busy="initRepoBusy"
      @update:open="
        (v: boolean) => {
          initRepoOpen = v
        }
      "
      @initialize="initRepo"
    />

    <GitRenameDialog
      :open="renameDialogOpen"
      v-model:from="renameFrom"
      v-model:to="renameTo"
      @update:open="
        (v: boolean) => {
          renameDialogOpen = v
        }
      "
      @submit="submitRename"
    />

    <GitPageMiscDialogs
      v-model:actionsOpen="actionsOpen"
      v-model:commitErrorOpen="commitErrorOpen"
      v-model:commitErrorTitle="commitErrorTitle"
      v-model:commitErrorOutput="commitErrorOutput"
      v-model:postCommitOpen="postCommitOpen"
      v-model:postCommitTitle="postCommitTitle"
      v-model:postCommitExplain="postCommitExplain"
      v-model:postCommitRememberChoice="postCommitRememberChoice"
      :repoRoot="repoRoot"
      :is-mobile-pointer="ui.isMobilePointer"
      :actions-anchor-el="actionsMenuAnchorEl"
      :committing="committing"
      :commitNoVerify="commitNoVerify"
      :commitSignoff="commitSignoff"
      :commitAmend="commitAmend"
      :commitNoGpgSign="commitNoGpgSign"
      :setCommitNoVerify="(v: boolean) => (commitNoVerify = v)"
      :setCommitSignoff="(v: boolean) => (commitSignoff = v)"
      :setCommitAmend="(v: boolean) => (commitAmend = v)"
      :setCommitNoGpgSign="(v: boolean) => (commitNoGpgSign = v)"
      :commitMessage="commitMessage"
      :restoreCommitTemplate="restoreCommitTemplate"
      :discardCommitMessage="discardCommitMessage"
      :undoLastCommit="undoLastCommit"
      :commitAll="commitAll"
      :commitEmpty="commitEmpty"
      :postCommitCommand="gitPostCommitCommand"
      :triggerPostCommitAction="triggerPostCommitAction"
      :dismissPostCommitPrompt="dismissPostCommitPrompt"
      :stageAll="stageAll"
      :stageAllTracked="stageAllTracked"
      :stageAllUntracked="stageAllUntracked"
      :stageAllMerge="stageAllMerge"
      :fetchRemote="fetchRemote"
      :refreshRepository="refreshRepository"
      :fetchPrune="fetchPrune"
      :fetchAll="fetchAll"
      :openFetchFrom="openFetchFrom"
      :pull="pull"
      :pullRebase="pullRebase"
      :openPullFrom="openPullFrom"
      :push="push"
      :pushForce="pushForce"
      :pushForceWithLease="pushForceWithLease"
      :pushTags="pushTags"
      :pushFollowTags="pushFollowTags"
      :openPushTo="openPushTo"
      :sync="sync"
      :syncRebase="syncRebase"
      :openBranchesDialog="
        () => {
          isBranchDialogOpen = true
          void loadBranches()
        }
      "
      :openRemotesDialog="openRemotes"
      :openWorktreesDialog="openWorktrees"
      :openHistoryDialog="openHistoryWithRefs"
      :openCompareDialog="openCompareDialog"
      :compareWithUpstream="compareWithUpstream"
      :openMergeDialog="openMergeDialogWithBranches"
      :openRebaseDialog="openRebaseDialogWithBranches"
      :openSubmodulesDialog="openSubmodules"
      :openLfsDialog="openLfs"
      :openAutoFetchDialog="
        () => {
          autoFetchDialogOpen = true
        }
      "
      :openBranchFromDialog="
        () => {
          branchFromOpen = true
        }
      "
      :openDetachedDialog="
        () => {
          detachedOpen = true
        }
      "
      :openTagsDialog="openTags"
      :openStashPanel="
        () => {
          isStashExpanded = true
          if (repoRoot) loadStash(repoRoot)
        }
      "
      :stashDropAll="stashDropAll"
      :stashPushKeepIndexQuick="stashPushKeepIndexQuick"
      :stashPushIncludeUntrackedQuick="stashPushIncludeUntrackedQuick"
      :stashPushStagedQuick="stashPushStagedQuick"
      :cleanUntracked="cleanUntracked"
      :discardAllTracked="discardAllTracked"
      :revertAllChanges="revertAllChanges"
      :openGitTerminalWithCommand="openGitTerminalWithCommand"
      :terminalCommandForCommit="terminalCommandForCommit"
    />

    <GitTagsDialog
      :open="tagsOpen"
      :tags-loading="tagsLoading"
      :tags-list="tagsList"
      :remote-names="remoteNames"
      v-model:newTagName="newTagName"
      v-model:newTagRef="newTagRef"
      v-model:newTagMessage="newTagMessage"
      v-model:tagRemote="tagRemote"
      @update:open="
        (v: boolean) => {
          tagsOpen = v
        }
      "
      @createTag="createTag"
      @refresh="loadTags"
      @deleteLocal="deleteTag"
      @deleteRemote="deleteRemoteTag"
    />

    <GitRemotesDialog
      :open="remotesOpen"
      :remotes-loading="remotesLoading"
      :remotes-error="remotesError"
      :remotes="remotesList"
      v-model:newRemoteName="newRemoteName"
      v-model:newRemoteUrl="newRemoteUrl"
      v-model:selectedRemote="selectedRemote"
      v-model:renameRemoteTo="renameRemoteTo"
      v-model:setRemoteUrl="setRemoteUrl"
      @update:open="(v: boolean) => (v ? openRemotes() : (remotesOpen = false))"
      @refresh="loadRemotes"
      @add="addRemote"
      @rename="renameRemote"
      @setUrl="updateRemoteUrl"
      @remove="removeRemote"
      @copyUrl="copyRemoteUrl"
    />

    <GitWorktreesDialog
      :open="worktreesOpen"
      :worktrees-loading="worktreesLoading"
      :worktrees-error="worktreesError"
      :worktrees="worktrees"
      :repo-root="repoRoot"
      :project-root="projectRoot"
      v-model:newWorktreePath="newWorktreePath"
      v-model:newWorktreeBranch="newWorktreeBranch"
      v-model:newWorktreeStartPoint="newWorktreeStartPoint"
      v-model:newWorktreeCreateBranch="newWorktreeCreateBranch"
      @update:open="(v: boolean) => (v ? openWorktrees() : (worktreesOpen = false))"
      @refresh="loadWorktrees"
      @add="addWorktree"
      @remove="removeWorktree"
      @prune="pruneWorktrees"
      @migrate="migrateWorktreeChanges"
      @openWorktree="openWorktree"
      @copyPath="copyWorktreePath"
    />

    <GitCheckoutDetachedDialog
      :open="detachedOpen"
      v-model:detachedRef="detachedRef"
      @update:open="
        (v: boolean) => {
          detachedOpen = v
        }
      "
      @checkout="checkoutDetached"
    />

    <GitCreateBranchFromDialog
      :open="branchFromOpen"
      v-model:branchName="branchFromName"
      v-model:startPoint="branchFromRef"
      v-model:checkoutAfterCreate="branchFromCheckout"
      @update:open="
        (v: boolean) => {
          branchFromOpen = v
        }
      "
      @create="createBranchFromRef"
    />

    <GitAuthDialogs
      v-model:credDialogOpen="credDialogOpen"
      v-model:credAction="credAction"
      v-model:credUsername="credUsername"
      v-model:credPassword="credPassword"
      v-model:credExplain="credExplain"
      v-model:githubToken="githubToken"
      v-model:githubTokenRemember="githubTokenRemember"
      v-model:gitBusyDialogOpen="gitBusyDialogOpen"
      v-model:ssoDialogOpen="ssoDialogOpen"
      v-model:ssoAction="ssoAction"
      v-model:ssoExplain="ssoExplain"
      v-model:terminalHelpOpen="terminalHelpOpen"
      v-model:gpgDialogOpen="gpgDialogOpen"
      v-model:gpgPassphrase="gpgPassphrase"
      v-model:pendingCommitMessage="pendingCommitMessage"
      v-model:gpgEnableDialogOpen="gpgEnableDialogOpen"
      v-model:gpgMissingDialogOpen="gpgMissingDialogOpen"
      v-model:gpgSigningKeyInput="gpgSigningKeyInput"
      :repoRoot="repoRoot"
      :toasts="toasts"
      :authHelpText="authHelpText"
      :githubRemote="isGithubRemote()"
      :commitMessage="commitMessage"
      :committing="committing"
      :gitBusyTitle="gitBusyTitle"
      :gitBusyExplain="gitBusyExplain"
      :retryGitSso="retryGitSso"
      :dismissGitSsoDialog="dismissGitSsoDialog"
      :terminalHelpTitle="terminalHelpTitle"
      :terminalHelpExplain="terminalHelpExplain"
      :terminalHelpSend="terminalHelpSend"
      :gpgExplain="gpgExplain"
      :gpgEnableExplain="gpgEnableExplain"
      :gpgEnableBusy="gpgEnableBusy"
      :gpgMissingExplain="gpgMissingExplain"
      :gpgMissingBusy="gpgMissingBusy"
      :saveGithubTokenForRepo="saveGithubTokenForRepo"
      :openGitTerminalWithCommand="openGitTerminalWithCommand"
      :terminalCommandForRemoteAction="terminalCommandForRemoteAction"
      :terminalCommandForCommit="terminalCommandForCommit"
      :submitCredentials="submitCredentials"
      :dismissGitBusyDialog="dismissGitBusyDialog"
      :retryGitBusy="retryGitBusy"
      :submitGpgPassphrase="submitGpgPassphrase"
      :enableGpgPresetAndRetry="enableGpgPresetAndRetry"
      :setRepoSigningKey="setRepoSigningKey"
      :disableRepoGpgSigning="disableRepoGpgSigning"
    />

    <GitRemoteTargetDialogs
      v-model:pushToOpen="pushToOpen"
      v-model:pullFromOpen="pullFromOpen"
      v-model:fetchFromOpen="fetchFromOpen"
      v-model:targetRemote="targetRemote"
      v-model:targetBranch="targetBranch"
      v-model:targetRef="targetRef"
      v-model:targetSetUpstream="targetSetUpstream"
      v-model:branchPickVisible="branchPickVisible"
      v-model:branchPickIndex="branchPickIndex"
      v-model:stashDialogOpen="stashDialogOpen"
      v-model:stashMessage="stashMessage"
      v-model:stashIncludeUntracked="stashIncludeUntracked"
      v-model:stashKeepIndex="stashKeepIndex"
      v-model:stashStaged="stashStaged"
      :remoteInfo="remoteInfo"
      :remoteBranchLoading="remoteBranchLoading"
      :filteredRemoteBranchOptions="filteredRemoteBranchOptions"
      :hideBranchPickSoon="hideBranchPickSoon"
      :onBranchPickKeydown="onBranchPickKeydown"
      :pushToTarget="pushToTarget"
      :pullFromTarget="pullFromTarget"
      :fetchFromTarget="fetchFromTarget"
      :stashPush="stashPush"
    />

    <GitStashViewDialog
      :open="stashViewOpen"
      :title="stashViewTitle"
      :diff="stashViewDiff"
      :loading="stashViewLoading"
      :error="stashViewError"
      @update:open="(v: boolean) => (stashViewOpen = v)"
    />
  </div>
</template>
