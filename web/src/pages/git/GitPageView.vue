<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiArrowDownSLine, RiArrowRightSLine, RiGitBranchLine, RiMore2Line, RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import MiniActionButton from '@/components/ui/MiniActionButton.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import GitCommitBox from '@/components/git/GitCommitBox.vue'
import GitDiffPane from '@/components/git/GitDiffPane.vue'
import GitMergeChangesSection from '@/components/git/GitMergeChangesSection.vue'
import GitStagedChangesSection from '@/components/git/GitStagedChangesSection.vue'
import GitChangesSection from '@/components/git/GitChangesSection.vue'
import GitUntrackedSection from '@/components/git/GitUntrackedSection.vue'
import GitRepoPickerDialog from '@/components/git/GitRepoPickerDialog.vue'
import GitCloneDialog from '@/components/git/GitCloneDialog.vue'
import GitInitRepoDialog from '@/components/git/GitInitRepoDialog.vue'
import GitBranchesDialog from '@/components/git/GitBranchesDialog.vue'
import GitBranchActionDialog from '@/components/git/GitBranchActionDialog.vue'
import GitRenameBranchDialog from '@/components/git/GitRenameBranchDialog.vue'
import GitCompareDialog from '@/components/git/GitCompareDialog.vue'
import GitSubmodulesDialog from '@/components/git/GitSubmodulesDialog.vue'
import GitLfsDialog from '@/components/git/GitLfsDialog.vue'
import GitAutoFetchDialog from '@/components/git/GitAutoFetchDialog.vue'
import GitHistoryDialog from '@/components/git/GitHistoryDialog.vue'
import GitRemotesDialog from '@/components/git/GitRemotesDialog.vue'
import GitTagsDialog from '@/components/git/GitTagsDialog.vue'
import GitWorktreesDialog from '@/components/git/GitWorktreesDialog.vue'
import GitCheckoutDetachedDialog from '@/components/git/GitCheckoutDetachedDialog.vue'
import GitCreateBranchFromDialog from '@/components/git/GitCreateBranchFromDialog.vue'
import GitRenameDialog from '@/components/git/GitRenameDialog.vue'
import GitStashPanel from '@/components/git/GitStashPanel.vue'
import GitStashViewDialog from '@/components/git/GitStashViewDialog.vue'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'

import GitAuthDialogs from './components/GitAuthDialogs.vue'
import GitRemoteTargetDialogs from './components/GitRemoteTargetDialogs.vue'
import GitPageMiscDialogs from './components/GitPageMiscDialogs.vue'

const props = defineProps({
  ctx: {
    type: Object,
    required: true,
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
  status,
  headline,
  gitState,
  signingInfo,
  remoteInfo,
  selectedRepoLabel,
  selectedRepoRelative,

  // Repo list/picker
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
  loadRepos,
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
  closeRepo,
  reopenRepo,

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
  cherryPickCommit,
  revertCommit,
  resetCommit,
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
  historyBranchOptions,
  historyTagOptions,

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
  historyOpen,
  historyLoading,
  historyError,
  historyCommits,
  historyHasMore,
  historySelected,
  historyDiff,
  historyDiffLoading,
  historyDiffError,
  historyFiles,
  historyFilesLoading,
  historyFilesError,
  historyFileSelected,
  historyFileDiff,
  historyFileDiffLoading,
  historyFileDiffError,
  historyFilterPath,
  historyFilterAuthor,
  historyFilterMessage,
  historyFilterRef,
  historyFilterRefType,
  openHistoryDialog,
  openFileHistory,
  closeHistoryDialog,
  refreshHistory,
  clearHistoryFilter,
  applyHistoryFilters,
  clearHistoryFilters,
  loadMoreHistory,
  selectCommit,
  selectCommitFile,
  clearSelectedFile,
  historyCompareHash,
  selectHistoryCompareCommit,
  clearHistoryCompareCommit,
  compareHistoryWithParent,
  compareHistoryWithSelected,

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
    openFirstConflict()
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
    openFirstConflict()
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
    openFirstConflict()
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
    openFirstConflict()
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

function openHistoryWithRefs() {
  openHistoryDialog()
  void loadBranches()
  void loadTags()
}

function openFileHistoryWithRefs(path: string) {
  openFileHistory(path)
  void loadBranches()
  void loadTags()
}

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

function onHistoryCherryPick(commit: HistoryCommitLike) {
  cherryPickCommit(commit?.hash || '')
}

function onHistoryRevert(commit: HistoryCommitLike) {
  revertCommit(commit?.hash || '')
}

function onHistoryReset(payload: { commit: HistoryCommitLike; mode: 'soft' | 'mixed' | 'hard' }) {
  resetCommit(payload.commit?.hash || '', payload.mode)
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

const actionsMenuAnchorEl = ref<HTMLElement | null>(null)

const useShellSidebar = computed(() => (ui.isMobile ? ui.isSessionSwitcherOpen : ui.isSidebarOpen))

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
      :style="ui.isMobile ? undefined : { width: `${ui.sidebarWidth}px` }"
    >
      <div
        v-if="!ui.isMobile"
        class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
        @pointerdown="startDesktopSidebarResize"
      />
      <div class="oc-vscode-pane-header">
        <div class="oc-vscode-pane-title">{{ t('git.ui.sourceControl') }}</div>
        <div class="oc-vscode-toolbar">
          <SidebarIconButton
            :title="t('git.actions.fetch')"
            :disabled="!gitReady || !root || repoBusy"
            @click="fetchRemote"
          >
            <RiRefreshLine class="h-3.5 w-3.5" :class="{ 'animate-spin': loading || repoBusy }" />
          </SidebarIconButton>
          <SidebarIconButton :title="t('git.actions.pull')" :disabled="!gitReady || !root || repoBusy" @click="pull">
            <RiArrowDownSLine class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <SidebarIconButton :title="t('git.actions.push')" :disabled="!gitReady || !root || repoBusy" @click="push">
            <RiArrowRightSLine class="h-3.5 w-3.5 -rotate-45" />
          </SidebarIconButton>
          <div ref="actionsMenuAnchorEl" class="inline-flex">
            <SidebarIconButton
              :title="t('git.ui.moreActions')"
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
        <button
          type="button"
          class="w-full flex items-center justify-between gap-2 rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-1.5 transition"
          :class="projectRoot ? 'hover:bg-sidebar-accent/40' : 'opacity-70 cursor-not-allowed'"
          :disabled="!projectRoot"
          @click="repoPickerOpen = true"
        >
          <div class="min-w-0 text-left">
            <div class="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {{ t('git.ui.repository') }}
            </div>
            <div class="truncate font-mono text-[11px] text-foreground" :title="selectedRepoLabel">
              {{ selectedRepoLabel }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div v-if="reposLoading" class="text-[10px] text-muted-foreground">{{ t('common.scanning') }}</div>
            <RiArrowDownSLine class="h-4 w-4 text-muted-foreground" />
          </div>
        </button>

        <div v-if="reposError" class="mt-1.5 text-xs text-destructive/90">
          {{ reposError }}
        </div>

        <div v-if="gitReady" class="mt-1.5 flex items-center gap-1.5 px-0.5 text-[11px]">
          <RiGitBranchLine class="h-3.5 w-3.5 shrink-0 text-primary" />
          <span class="min-w-0 flex-1 truncate font-mono text-foreground/90" :title="status?.current">{{
            headline
          }}</span>
        </div>
      </div>

      <ScrollArea class="flex-1 min-h-0">
        <div class="space-y-2 p-1.5">
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

            <div
              v-if="
                signingInfo?.commitGpgsign &&
                (signingInfo?.gpgFormat || '').toLowerCase() === 'ssh' &&
                !signingInfo.sshSigningAvailable
              "
              class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/20 p-2 text-[11px]"
            >
              <div class="font-medium">{{ t('git.ui.signing.sshMayFailTitle') }}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">
                {{ t('git.ui.signing.sshMayFailDescription') }}
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

            <GitStashPanel
              v-model:expanded="isStashExpanded"
              :stashes="stashList"
              :loading="stashLoading"
              :can-operate="!!repoRoot"
              @openCreate="stashDialogOpen = true"
              @dropAll="stashDropAll"
              @view="stashView"
              @apply="(ref: string) => stashAction('apply', ref)"
              @pop="(ref: string) => stashAction('pop', ref)"
              @branch="stashBranchFrom"
              @drop="(ref: string) => stashAction('drop', ref)"
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
              <MiniActionButton size="xs" @click="repoPickerOpen = true">{{ t('git.ui.selectRepo') }}</MiniActionButton>
              <MiniActionButton variant="default" size="xs" @click="initRepoOpen = true">{{
                t('git.ui.initialize')
              }}</MiniActionButton>
            </div>
          </div>

          <div v-if="gitReady" class="space-y-0">
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
              @select="(p: string) => selectFile(p, 'working')"
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
              @select="(p: string) => selectFile(p, 'staged')"
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
              @select="(p: string) => selectFile(p, 'working')"
              @stageAll="stageAllTracked"
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
              @select="(p: string) => selectFile(p, 'working')"
              @stageAll="stageAllUntracked"
              @stage="(p: string) => stagePaths([p])"
              @rename="openRenameDialog"
              @discard="(p: string) => revertFile(p)"
              @ignore="(p: string) => ignorePath(p)"
              @showMore="showMoreUntracked"
            />
          </div>
        </div>
      </ScrollArea>
    </div>

    <div class="min-w-0 flex-1 overflow-hidden" v-show="!ui.isMobile || !ui.isSessionSwitcherOpen">
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

    <GitRepoPickerDialog
      :open="repoPickerOpen"
      :project-root="projectRoot || ''"
      :repos="repos"
      :closed-repos="closedRepos"
      :parent-repos="parentRepos"
      :repos-loading="reposLoading"
      :repos-error="reposError"
      :selected-repo-relative="selectedRepoRelative"
      @update:open="
        (v: boolean) => {
          repoPickerOpen = v
          if (v) void loadRepos()
        }
      "
      @refresh="loadRepos"
      @openInit="initRepoOpen = true"
      @openClone="
        () => {
          repoPickerOpen = false
          cloneRepoOpen = true
        }
      "
      @select="selectRepo"
      @openParent="openParentRepo"
      @closeRepo="closeRepo"
      @reopenRepo="reopenRepo"
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

    <GitHistoryDialog
      :open="historyOpen"
      :loading="historyLoading"
      :error="historyError"
      :commits="historyCommits"
      :has-more="historyHasMore"
      :selected="historySelected"
      :branch-options="historyBranchOptions"
      :tag-options="historyTagOptions"
      :files="historyFiles"
      :files-loading="historyFilesLoading"
      :files-error="historyFilesError"
      :selected-file="historyFileSelected"
      :file-diff="historyFileDiff"
      :file-diff-loading="historyFileDiffLoading"
      :file-diff-error="historyFileDiffError"
      :filter-path="historyFilterPath"
      :filter-author="historyFilterAuthor"
      :filter-message="historyFilterMessage"
      :filter-ref="historyFilterRef"
      :filter-ref-type="historyFilterRefType"
      :compare-selected-hash="historyCompareHash"
      :diff="historyDiff"
      :diff-loading="historyDiffLoading"
      :diff-error="historyDiffError"
      @update:open="(v: boolean) => (v ? openHistoryWithRefs() : closeHistoryDialog())"
      @update:filterAuthor="(v: string) => (historyFilterAuthor = v)"
      @update:filterMessage="(v: string) => (historyFilterMessage = v)"
      @update:filterRef="(v: string) => (historyFilterRef = v)"
      @update:filterRefType="(v: 'branch' | 'tag') => (historyFilterRefType = v)"
      @loadMore="loadMoreHistory"
      @refresh="refreshHistory"
      @clearFilter="clearHistoryFilter"
      @applyFilters="applyHistoryFilters"
      @clearFilters="clearHistoryFilters"
      @select="selectCommit"
      @checkout="onHistoryCheckout"
      @createBranch="onHistoryCreateBranch"
      @selectCompare="selectHistoryCompareCommit"
      @clearCompare="clearHistoryCompareCommit"
      @compareWithParent="compareHistoryWithParent"
      @compareWithSelected="compareHistoryWithSelected"
      @copyHash="(hash: string) => copyCommitHash(hash)"
      @cherryPick="onHistoryCherryPick"
      @revert="onHistoryRevert"
      @reset="onHistoryReset"
      @selectFile="selectCommitFile"
      @clearFile="clearSelectedFile"
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
