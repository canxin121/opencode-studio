<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'

const props = defineProps<{
  repoRoot: string | null
  isMobilePointer: boolean
  actionsAnchorEl?: HTMLElement | null
  committing: boolean
  commitNoVerify: boolean
  commitSignoff: boolean
  commitAmend: boolean
  commitNoGpgSign: boolean
  setCommitNoVerify: (value: boolean) => void
  setCommitSignoff: (value: boolean) => void
  setCommitAmend: (value: boolean) => void
  setCommitNoGpgSign: (value: boolean) => void
  commitMessage: string
  restoreCommitTemplate: () => void
  discardCommitMessage: () => void
  undoLastCommit: () => void | Promise<void>
  commitAll: () => void | Promise<void>
  commitEmpty: () => void | Promise<void>
  postCommitCommand: 'none' | 'push' | 'sync'
  triggerPostCommitAction: (action: 'push' | 'sync') => void | Promise<void>
  dismissPostCommitPrompt: () => void

  stageAll: () => void
  stageAllTracked: () => void
  stageAllUntracked: () => void
  stageAllMerge: () => void

  fetchRemote: () => void | Promise<void>
  fetchPrune: () => void | Promise<void>
  fetchAll: () => void | Promise<void>
  openFetchFrom: () => void

  pull: () => void | Promise<void>
  pullRebase: () => void | Promise<void>
  openPullFrom: () => void

  push: () => void | Promise<void>
  pushForce: () => void | Promise<void>
  pushForceWithLease: () => void | Promise<void>
  pushTags: () => void | Promise<void>
  pushFollowTags: () => void | Promise<void>
  openPushTo: () => void

  sync: () => void | Promise<void>
  syncRebase: () => void | Promise<void>

  openBranchesDialog: () => void
  openRemotesDialog: () => void
  openWorktreesDialog: () => void
  openBranchFromDialog: () => void
  openDetachedDialog: () => void
  openHistoryDialog: () => void
  openMergeDialog: () => void
  openRebaseDialog: () => void
  openCompareDialog: () => void
  compareWithUpstream: () => void | Promise<void>
  openTagsDialog: () => void
  openStashPanel: () => void
  stashDropAll: () => void | Promise<void>
  stashPushStagedQuick: () => void | Promise<void>
  stashPushKeepIndexQuick: () => void | Promise<void>
  stashPushIncludeUntrackedQuick: () => void | Promise<void>
  openSubmodulesDialog: () => void
  openLfsDialog: () => void
  openAutoFetchDialog: () => void

  cleanUntracked: (includeIgnored: boolean) => void
  discardAllTracked: () => void

  openGitTerminalWithCommand: (repoDir: string, gitCmd: string) => void
  terminalCommandForCommit: (message: string) => string
}>()

const actionsOpen = defineModel<boolean>('actionsOpen', { required: true })
const actionsQuery = ref('')

const commitErrorOpen = defineModel<boolean>('commitErrorOpen', { required: true })
const commitErrorTitle = defineModel<string>('commitErrorTitle', { required: true })
const commitErrorOutput = defineModel<string>('commitErrorOutput', { required: true })

const postCommitOpen = defineModel<boolean>('postCommitOpen', { required: true })
const postCommitTitle = defineModel<string>('postCommitTitle', { required: true })
const postCommitExplain = defineModel<string>('postCommitExplain', { required: true })
const postCommitRememberChoice = defineModel<boolean>('postCommitRememberChoice', { required: true })

function repoDirOrEmpty(): string {
  return (props.repoRoot || '').trim()
}

function closeActionsThen(fn: () => void) {
  actionsOpen.value = false
  fn()
}

watch(actionsOpen, (open) => {
  if (!open) actionsQuery.value = ''
})

const postCommitDefaultLabel = computed(() => {
  if (props.postCommitCommand === 'push') return 'Push'
  if (props.postCommitCommand === 'sync') return 'Sync'
  return 'Prompt'
})

const hasCommitMessage = computed(() => Boolean((props.commitMessage || '').trim()))
const canRunCommitMessageActions = computed(() => !props.committing)
const canRunCommitVariants = computed(() => hasCommitMessage.value && !props.committing)

const sourceControlActionGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'commit',
    title: 'Commit',
    items: [
      {
        id: 'commit-no-verify',
        label: 'No verify',
        description: 'Skip pre-commit hooks',
        checked: props.commitNoVerify,
      },
      {
        id: 'commit-signoff',
        label: 'Sign-off',
        description: 'Append Signed-off-by trailer',
        checked: props.commitSignoff,
      },
      { id: 'commit-amend', label: 'Amend', description: 'Amend the latest commit', checked: props.commitAmend },
      {
        id: 'commit-no-gpg-sign',
        label: 'No sign',
        description: 'Skip GPG signing for this commit',
        checked: props.commitNoGpgSign,
      },
      {
        id: 'commit-template',
        label: 'Restore Template',
        description: 'Restore commit message template',
        disabled: !canRunCommitMessageActions.value,
      },
      {
        id: 'commit-discard-message',
        label: 'Discard Message',
        description: 'Clear the current commit message',
        variant: 'destructive',
        disabled: !hasCommitMessage.value || !canRunCommitMessageActions.value,
        confirmTitle: 'Discard commit message?',
        confirmDescription: 'This clears the current commit message draft.',
        confirmText: 'Discard',
        cancelText: 'Cancel',
      },
      {
        id: 'commit-undo-last',
        label: 'Undo Last Commit',
        description: 'Run git reset --soft HEAD~1',
        variant: 'destructive',
        disabled: !canRunCommitMessageActions.value,
        confirmTitle: 'Undo last commit?',
        confirmDescription: 'This keeps file changes but removes the latest commit.',
        confirmText: 'Undo',
        cancelText: 'Cancel',
      },
      {
        id: 'commit-all',
        label: 'Commit All',
        description: 'Commit tracked and untracked changes',
        disabled: !canRunCommitVariants.value,
      },
      {
        id: 'commit-empty',
        label: 'Commit Empty',
        description: 'Create an empty commit with current message',
        disabled: !canRunCommitVariants.value,
      },
    ],
  },
  {
    id: 'stage',
    title: 'Stage',
    items: [
      { id: 'stage-all', label: 'Stage All', description: 'Stage all tracked and untracked changes' },
      { id: 'stage-all-tracked', label: 'Stage All Tracked', description: 'Stage tracked file changes only' },
      { id: 'stage-all-untracked', label: 'Stage All Untracked', description: 'Stage untracked files only' },
      { id: 'stage-all-merge', label: 'Stage All Merge', description: 'Stage merge conflict resolutions' },
    ],
  },
  {
    id: 'sync',
    title: 'Sync',
    items: [
      { id: 'fetch', label: 'Fetch', description: 'Fetch updates from remote' },
      { id: 'fetch-from', label: 'Fetch from...', description: 'Choose remote and branch to fetch from' },
      { id: 'fetch-prune', label: 'Fetch (Prune)', description: 'Fetch and prune deleted refs' },
      { id: 'fetch-all', label: 'Fetch (All)', description: 'Fetch from all remotes' },
      { id: 'pull', label: 'Pull', description: 'Pull remote changes' },
      { id: 'pull-rebase', label: 'Pull (Rebase)', description: 'Pull and rebase current branch' },
      { id: 'pull-from', label: 'Pull from...', description: 'Choose remote and branch to pull from' },
      { id: 'push', label: 'Push', description: 'Push local commits to remote' },
      {
        id: 'push-force',
        label: 'Push (Force)',
        description: 'Force push remote branch history',
        variant: 'destructive',
        confirmTitle: 'Force push?',
        confirmDescription: 'This can overwrite remote history.',
        confirmText: 'Force push',
        cancelText: 'Cancel',
      },
      {
        id: 'push-force-with-lease',
        label: 'Push (Force with lease)',
        description: 'Force push while guarding against stale remote refs',
        variant: 'destructive',
        confirmTitle: 'Force push (with lease)?',
        confirmDescription: 'This can overwrite remote history.',
        confirmText: 'Force push',
        cancelText: 'Cancel',
      },
      { id: 'push-tags', label: 'Push Tags', description: 'Push local tags to remote' },
      { id: 'push-follow-tags', label: 'Push (Follow tags)', description: 'Push commits and reachable tags' },
      { id: 'push-to', label: 'Push to...', description: 'Choose remote and branch to push to' },
      { id: 'sync-now', label: 'Sync', description: 'Fetch and push in one flow' },
      { id: 'sync-rebase', label: 'Sync (Rebase)', description: 'Pull --rebase and push in one flow' },
    ],
  },
  {
    id: 'inspect',
    title: 'Inspect',
    items: [
      { id: 'branches', label: 'Branches...', description: 'Browse and switch branches' },
      { id: 'remotes', label: 'Remotes...', description: 'Manage git remotes' },
      { id: 'worktrees', label: 'Worktrees...', description: 'Manage linked worktrees' },
      { id: 'history', label: 'History...', description: 'Inspect commit history' },
      { id: 'compare', label: 'Compare...', description: 'Compare refs and branches' },
      {
        id: 'compare-upstream',
        label: 'Compare with upstream',
        description: 'Compare current branch against its tracking branch',
      },
      { id: 'tags', label: 'Tags...', description: 'Create and manage tags' },
      { id: 'submodules', label: 'Submodules...', description: 'Inspect submodule status' },
      { id: 'lfs', label: 'Git LFS...', description: 'Inspect Git LFS status' },
      { id: 'autofetch', label: 'Auto Fetch...', description: 'Configure background fetch' },
      { id: 'stash', label: 'Stash...', description: 'Open stash operations' },
      { id: 'stash-staged', label: 'Stash (Staged only)', description: 'Stash only staged changes' },
      { id: 'stash-keep-index', label: 'Stash (Keep index)', description: 'Stash unstaged changes only' },
      {
        id: 'stash-include-untracked',
        label: 'Stash (Include untracked)',
        description: 'Stash tracked and untracked changes',
      },
      {
        id: 'stash-drop-all',
        label: 'Stash (Drop all)',
        description: 'Delete all stash entries',
        variant: 'destructive',
        confirmTitle: 'Drop all stashes?',
        confirmDescription: 'This permanently removes all stash entries.',
        confirmText: 'Drop all',
        cancelText: 'Cancel',
      },
    ],
  },
  {
    id: 'branching',
    title: 'Branching',
    items: [
      { id: 'merge-branch', label: 'Merge Branch...', description: 'Merge another branch into current branch' },
      { id: 'rebase-branch', label: 'Rebase Branch...', description: 'Rebase current branch onto another branch' },
      { id: 'branch-from', label: 'Create Branch from...', description: 'Create a branch from selected ref' },
      { id: 'checkout-detached', label: 'Checkout Detached...', description: 'Checkout a detached commit or ref' },
    ],
  },
  {
    id: 'cleanup',
    title: 'Cleanup',
    items: [
      {
        id: 'clean-untracked',
        label: 'Clean Untracked',
        description: 'Delete untracked files and folders',
        variant: 'destructive',
        confirmTitle: 'Clean untracked?',
        confirmDescription: 'This will delete untracked files and folders.',
        confirmText: 'Clean',
        cancelText: 'Cancel',
      },
      {
        id: 'clean-all',
        label: 'Clean All (incl. ignored)',
        description: 'Delete untracked and ignored files',
        variant: 'destructive',
        confirmTitle: 'Clean all (including ignored)?',
        confirmDescription: 'This will delete untracked and ignored files.',
        confirmText: 'Clean',
        cancelText: 'Cancel',
      },
      {
        id: 'discard-all-tracked',
        label: 'Discard All Tracked',
        description: 'Reset index and working tree for tracked files',
        variant: 'destructive',
        confirmTitle: 'Discard all tracked changes?',
        confirmDescription: 'This resets index + working tree for tracked files.',
        confirmText: 'Discard',
        cancelText: 'Cancel',
      },
    ],
  },
])

function runSourceControlAction(item: OptionMenuItem) {
  const id = String(item.id || '')
  if (!id) return

  if (id === 'commit-no-verify') return closeActionsThen(() => props.setCommitNoVerify(!props.commitNoVerify))
  if (id === 'commit-signoff') return closeActionsThen(() => props.setCommitSignoff(!props.commitSignoff))
  if (id === 'commit-amend') return closeActionsThen(() => props.setCommitAmend(!props.commitAmend))
  if (id === 'commit-no-gpg-sign') return closeActionsThen(() => props.setCommitNoGpgSign(!props.commitNoGpgSign))
  if (id === 'commit-template') return closeActionsThen(props.restoreCommitTemplate)
  if (id === 'commit-discard-message') return closeActionsThen(props.discardCommitMessage)
  if (id === 'commit-undo-last') return closeActionsThen(() => void props.undoLastCommit())
  if (id === 'commit-all') return closeActionsThen(() => void props.commitAll())
  if (id === 'commit-empty') return closeActionsThen(() => void props.commitEmpty())

  if (id === 'stage-all') return closeActionsThen(props.stageAll)
  if (id === 'stage-all-tracked') return closeActionsThen(props.stageAllTracked)
  if (id === 'stage-all-untracked') return closeActionsThen(props.stageAllUntracked)
  if (id === 'stage-all-merge') return closeActionsThen(props.stageAllMerge)

  if (id === 'fetch') return closeActionsThen(() => void props.fetchRemote())
  if (id === 'fetch-from') return closeActionsThen(props.openFetchFrom)
  if (id === 'fetch-prune') return closeActionsThen(() => void props.fetchPrune())
  if (id === 'fetch-all') return closeActionsThen(() => void props.fetchAll())
  if (id === 'pull') return closeActionsThen(() => void props.pull())
  if (id === 'pull-rebase') return closeActionsThen(() => void props.pullRebase())
  if (id === 'pull-from') return closeActionsThen(props.openPullFrom)
  if (id === 'push') return closeActionsThen(() => void props.push())
  if (id === 'push-force') return closeActionsThen(() => void props.pushForce())
  if (id === 'push-force-with-lease') return closeActionsThen(() => void props.pushForceWithLease())
  if (id === 'push-tags') return closeActionsThen(() => void props.pushTags())
  if (id === 'push-follow-tags') return closeActionsThen(() => void props.pushFollowTags())
  if (id === 'push-to') return closeActionsThen(props.openPushTo)
  if (id === 'sync-now') return closeActionsThen(() => void props.sync())
  if (id === 'sync-rebase') return closeActionsThen(() => void props.syncRebase())

  if (id === 'branches') return closeActionsThen(props.openBranchesDialog)
  if (id === 'remotes') return closeActionsThen(props.openRemotesDialog)
  if (id === 'worktrees') return closeActionsThen(props.openWorktreesDialog)
  if (id === 'history') return closeActionsThen(props.openHistoryDialog)
  if (id === 'compare') return closeActionsThen(props.openCompareDialog)
  if (id === 'compare-upstream') return closeActionsThen(() => void props.compareWithUpstream())
  if (id === 'tags') return closeActionsThen(props.openTagsDialog)
  if (id === 'submodules') return closeActionsThen(props.openSubmodulesDialog)
  if (id === 'lfs') return closeActionsThen(props.openLfsDialog)
  if (id === 'autofetch') return closeActionsThen(props.openAutoFetchDialog)
  if (id === 'stash') return closeActionsThen(props.openStashPanel)
  if (id === 'stash-staged') return closeActionsThen(() => void props.stashPushStagedQuick())
  if (id === 'stash-keep-index') return closeActionsThen(() => void props.stashPushKeepIndexQuick())
  if (id === 'stash-include-untracked') return closeActionsThen(() => void props.stashPushIncludeUntrackedQuick())
  if (id === 'stash-drop-all') return closeActionsThen(() => void props.stashDropAll())

  if (id === 'merge-branch') return closeActionsThen(props.openMergeDialog)
  if (id === 'rebase-branch') return closeActionsThen(props.openRebaseDialog)
  if (id === 'branch-from') return closeActionsThen(props.openBranchFromDialog)
  if (id === 'checkout-detached') return closeActionsThen(props.openDetachedDialog)

  if (id === 'clean-untracked') return closeActionsThen(() => props.cleanUntracked(false))
  if (id === 'clean-all') return closeActionsThen(() => props.cleanUntracked(true))
  if (id === 'discard-all-tracked') return closeActionsThen(props.discardAllTracked)
}
</script>

<template>
  <!-- SCM Actions Menu -->
  <OptionMenu
    :open="actionsOpen"
    v-model:query="actionsQuery"
    :groups="sourceControlActionGroups"
    title="Source Control Actions"
    mobile-title="Source Control Actions"
    :searchable="true"
    desktop-placement="bottom-end"
    :desktop-fixed="!props.isMobilePointer"
    :desktop-anchor-el="props.actionsAnchorEl ?? null"
    search-placeholder="Search actions"
    empty-text="No actions found."
    :is-mobile-pointer="props.isMobilePointer"
    :paginated="true"
    :page-size="20"
    pagination-mode="group"
    :collapsible-groups="true"
    filter-mode="internal"
    @update:open="
      (v: boolean) => {
        actionsOpen = v
      }
    "
    @select="runSourceControlAction"
  />

  <!-- Commit Error Dialog -->
  <Dialog
    :open="commitErrorOpen"
    :title="commitErrorTitle"
    description="Git reported an error"
    maxWidth="max-w-2xl"
    @update:open="
      (v: boolean) => {
        commitErrorOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div
        class="rounded-md border border-border/60 bg-muted/10 p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-80 overflow-auto"
      >
        {{ commitErrorOutput }}
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" @click="commitErrorOpen = false">Close</Button>
        <Button
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(repoDirOrEmpty(), props.terminalCommandForCommit(props.commitMessage))
              commitErrorOpen = false
            }
          "
        >
          Use Terminal
        </Button>
      </div>
    </div>
  </Dialog>

  <!-- Post Commit Prompt -->
  <Dialog
    :open="postCommitOpen"
    :title="postCommitTitle"
    description="Next steps"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        if (!v) postCommitRememberChoice = false
        postCommitOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div v-if="postCommitExplain" class="text-xs text-muted-foreground whitespace-pre-wrap">
        {{ postCommitExplain }}
      </div>
      <div class="text-[11px] text-muted-foreground">Global default: {{ postCommitDefaultLabel }}</div>
      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input v-model="postCommitRememberChoice" type="checkbox" class="accent-primary" />
        Remember this choice for this repository
      </label>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" @click="props.dismissPostCommitPrompt">Later</Button>
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              void props.triggerPostCommitAction('sync')
            }
          "
          >Sync</Button
        >
        <Button
          size="sm"
          @click="
            () => {
              void props.triggerPostCommitAction('push')
            }
          "
          >Push</Button
        >
      </div>
    </div>
  </Dialog>
</template>
