<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'

const { t } = useI18n()

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
  if (props.postCommitCommand === 'push') return t('git.actions.push')
  if (props.postCommitCommand === 'sync') return t('git.actions.sync')
  return t('git.ui.postCommit.prompt')
})

const hasCommitMessage = computed(() => Boolean((props.commitMessage || '').trim()))
const canRunCommitMessageActions = computed(() => !props.committing)
const canRunCommitVariants = computed(() => hasCommitMessage.value && !props.committing)

const sourceControlActionGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'commit',
    title: t('git.actionsMenu.groups.commit'),
    items: [
      {
        id: 'commit-no-verify',
        label: t('git.actionsMenu.commit.noVerify.label'),
        description: t('git.actionsMenu.commit.noVerify.description'),
        checked: props.commitNoVerify,
      },
      {
        id: 'commit-signoff',
        label: t('git.actionsMenu.commit.signoff.label'),
        description: t('git.actionsMenu.commit.signoff.description'),
        checked: props.commitSignoff,
      },
      {
        id: 'commit-amend',
        label: t('git.actionsMenu.commit.amend.label'),
        description: t('git.actionsMenu.commit.amend.description'),
        checked: props.commitAmend,
      },
      {
        id: 'commit-no-gpg-sign',
        label: t('git.actionsMenu.commit.noGpgSign.label'),
        description: t('git.actionsMenu.commit.noGpgSign.description'),
        checked: props.commitNoGpgSign,
      },
      {
        id: 'commit-template',
        label: t('git.actionsMenu.commit.restoreTemplate.label'),
        description: t('git.actionsMenu.commit.restoreTemplate.description'),
        disabled: !canRunCommitMessageActions.value,
      },
      {
        id: 'commit-discard-message',
        label: t('git.actionsMenu.commit.discardMessage.label'),
        description: t('git.actionsMenu.commit.discardMessage.description'),
        variant: 'destructive',
        disabled: !hasCommitMessage.value || !canRunCommitMessageActions.value,
        confirmTitle: t('git.actionsMenu.commit.discardMessage.confirmTitle'),
        confirmDescription: t('git.actionsMenu.commit.discardMessage.confirmDescription'),
        confirmText: t('common.discard'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'commit-undo-last',
        label: t('git.actionsMenu.commit.undoLastCommit.label'),
        description: t('git.actionsMenu.commit.undoLastCommit.description'),
        variant: 'destructive',
        disabled: !canRunCommitMessageActions.value,
        confirmTitle: t('git.actionsMenu.commit.undoLastCommit.confirmTitle'),
        confirmDescription: t('git.actionsMenu.commit.undoLastCommit.confirmDescription'),
        confirmText: t('common.undo'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'commit-all',
        label: t('git.actionsMenu.commit.commitAll.label'),
        description: t('git.actionsMenu.commit.commitAll.description'),
        disabled: !canRunCommitVariants.value,
      },
      {
        id: 'commit-empty',
        label: t('git.actionsMenu.commit.commitEmpty.label'),
        description: t('git.actionsMenu.commit.commitEmpty.description'),
        disabled: !canRunCommitVariants.value,
      },
    ],
  },
  {
    id: 'stage',
    title: t('git.actionsMenu.groups.stage'),
    items: [
      {
        id: 'stage-all',
        label: t('git.actionsMenu.stage.stageAll.label'),
        description: t('git.actionsMenu.stage.stageAll.description'),
      },
      {
        id: 'stage-all-tracked',
        label: t('git.actionsMenu.stage.stageAllTracked.label'),
        description: t('git.actionsMenu.stage.stageAllTracked.description'),
      },
      {
        id: 'stage-all-untracked',
        label: t('git.actionsMenu.stage.stageAllUntracked.label'),
        description: t('git.actionsMenu.stage.stageAllUntracked.description'),
      },
      {
        id: 'stage-all-merge',
        label: t('git.actionsMenu.stage.stageAllMerge.label'),
        description: t('git.actionsMenu.stage.stageAllMerge.description'),
      },
    ],
  },
  {
    id: 'sync',
    title: t('git.actionsMenu.groups.sync'),
    items: [
      {
        id: 'fetch',
        label: t('git.actionsMenu.sync.fetch.label'),
        description: t('git.actionsMenu.sync.fetch.description'),
      },
      {
        id: 'fetch-from',
        label: t('git.actionsMenu.sync.fetchFrom.label'),
        description: t('git.actionsMenu.sync.fetchFrom.description'),
      },
      {
        id: 'fetch-prune',
        label: t('git.actionsMenu.sync.fetchPrune.label'),
        description: t('git.actionsMenu.sync.fetchPrune.description'),
      },
      {
        id: 'fetch-all',
        label: t('git.actionsMenu.sync.fetchAll.label'),
        description: t('git.actionsMenu.sync.fetchAll.description'),
      },
      {
        id: 'pull',
        label: t('git.actionsMenu.sync.pull.label'),
        description: t('git.actionsMenu.sync.pull.description'),
      },
      {
        id: 'pull-rebase',
        label: t('git.actionsMenu.sync.pullRebase.label'),
        description: t('git.actionsMenu.sync.pullRebase.description'),
      },
      {
        id: 'pull-from',
        label: t('git.actionsMenu.sync.pullFrom.label'),
        description: t('git.actionsMenu.sync.pullFrom.description'),
      },
      {
        id: 'push',
        label: t('git.actionsMenu.sync.push.label'),
        description: t('git.actionsMenu.sync.push.description'),
      },
      {
        id: 'push-force',
        label: t('git.actionsMenu.sync.pushForce.label'),
        description: t('git.actionsMenu.sync.pushForce.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.sync.pushForce.confirmTitle'),
        confirmDescription: t('git.actionsMenu.sync.pushForce.confirmDescription'),
        confirmText: t('git.actionsMenu.sync.pushForce.confirmText'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'push-force-with-lease',
        label: t('git.actionsMenu.sync.pushForceWithLease.label'),
        description: t('git.actionsMenu.sync.pushForceWithLease.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.sync.pushForceWithLease.confirmTitle'),
        confirmDescription: t('git.actionsMenu.sync.pushForceWithLease.confirmDescription'),
        confirmText: t('git.actionsMenu.sync.pushForceWithLease.confirmText'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'push-tags',
        label: t('git.actionsMenu.sync.pushTags.label'),
        description: t('git.actionsMenu.sync.pushTags.description'),
      },
      {
        id: 'push-follow-tags',
        label: t('git.actionsMenu.sync.pushFollowTags.label'),
        description: t('git.actionsMenu.sync.pushFollowTags.description'),
      },
      {
        id: 'push-to',
        label: t('git.actionsMenu.sync.pushTo.label'),
        description: t('git.actionsMenu.sync.pushTo.description'),
      },
      {
        id: 'sync-now',
        label: t('git.actionsMenu.sync.syncNow.label'),
        description: t('git.actionsMenu.sync.syncNow.description'),
      },
      {
        id: 'sync-rebase',
        label: t('git.actionsMenu.sync.syncRebase.label'),
        description: t('git.actionsMenu.sync.syncRebase.description'),
      },
    ],
  },
  {
    id: 'inspect',
    title: t('git.actionsMenu.groups.inspect'),
    items: [
      {
        id: 'branches',
        label: t('git.actionsMenu.inspect.branches.label'),
        description: t('git.actionsMenu.inspect.branches.description'),
      },
      {
        id: 'remotes',
        label: t('git.actionsMenu.inspect.remotes.label'),
        description: t('git.actionsMenu.inspect.remotes.description'),
      },
      {
        id: 'worktrees',
        label: t('git.actionsMenu.inspect.worktrees.label'),
        description: t('git.actionsMenu.inspect.worktrees.description'),
      },
      {
        id: 'history',
        label: t('git.actionsMenu.inspect.history.label'),
        description: t('git.actionsMenu.inspect.history.description'),
      },
      {
        id: 'compare',
        label: t('git.actionsMenu.inspect.compare.label'),
        description: t('git.actionsMenu.inspect.compare.description'),
      },
      {
        id: 'compare-upstream',
        label: t('git.actionsMenu.inspect.compareUpstream.label'),
        description: t('git.actionsMenu.inspect.compareUpstream.description'),
      },
      {
        id: 'tags',
        label: t('git.actionsMenu.inspect.tags.label'),
        description: t('git.actionsMenu.inspect.tags.description'),
      },
      {
        id: 'submodules',
        label: t('git.actionsMenu.inspect.submodules.label'),
        description: t('git.actionsMenu.inspect.submodules.description'),
      },
      {
        id: 'lfs',
        label: t('git.actionsMenu.inspect.lfs.label'),
        description: t('git.actionsMenu.inspect.lfs.description'),
      },
      {
        id: 'autofetch',
        label: t('git.actionsMenu.inspect.autoFetch.label'),
        description: t('git.actionsMenu.inspect.autoFetch.description'),
      },
      {
        id: 'stash',
        label: t('git.actionsMenu.inspect.stash.label'),
        description: t('git.actionsMenu.inspect.stash.description'),
      },
      {
        id: 'stash-staged',
        label: t('git.actionsMenu.inspect.stashStagedOnly.label'),
        description: t('git.actionsMenu.inspect.stashStagedOnly.description'),
      },
      {
        id: 'stash-keep-index',
        label: t('git.actionsMenu.inspect.stashKeepIndex.label'),
        description: t('git.actionsMenu.inspect.stashKeepIndex.description'),
      },
      {
        id: 'stash-include-untracked',
        label: t('git.actionsMenu.inspect.stashIncludeUntracked.label'),
        description: t('git.actionsMenu.inspect.stashIncludeUntracked.description'),
      },
      {
        id: 'stash-drop-all',
        label: t('git.actionsMenu.inspect.stashDropAll.label'),
        description: t('git.actionsMenu.inspect.stashDropAll.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.inspect.stashDropAll.confirmTitle'),
        confirmDescription: t('git.actionsMenu.inspect.stashDropAll.confirmDescription'),
        confirmText: t('git.actionsMenu.inspect.stashDropAll.confirmText'),
        cancelText: t('common.cancel'),
      },
    ],
  },
  {
    id: 'branching',
    title: t('git.actionsMenu.groups.branching'),
    items: [
      {
        id: 'merge-branch',
        label: t('git.actionsMenu.branching.mergeBranch.label'),
        description: t('git.actionsMenu.branching.mergeBranch.description'),
      },
      {
        id: 'rebase-branch',
        label: t('git.actionsMenu.branching.rebaseBranch.label'),
        description: t('git.actionsMenu.branching.rebaseBranch.description'),
      },
      {
        id: 'branch-from',
        label: t('git.actionsMenu.branching.createBranchFrom.label'),
        description: t('git.actionsMenu.branching.createBranchFrom.description'),
      },
      {
        id: 'checkout-detached',
        label: t('git.actionsMenu.branching.checkoutDetached.label'),
        description: t('git.actionsMenu.branching.checkoutDetached.description'),
      },
    ],
  },
  {
    id: 'cleanup',
    title: t('git.actionsMenu.groups.cleanup'),
    items: [
      {
        id: 'clean-untracked',
        label: t('git.actionsMenu.cleanup.cleanUntracked.label'),
        description: t('git.actionsMenu.cleanup.cleanUntracked.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.cleanup.cleanUntracked.confirmTitle'),
        confirmDescription: t('git.actionsMenu.cleanup.cleanUntracked.confirmDescription'),
        confirmText: t('common.clean'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'clean-all',
        label: t('git.actionsMenu.cleanup.cleanAll.label'),
        description: t('git.actionsMenu.cleanup.cleanAll.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.cleanup.cleanAll.confirmTitle'),
        confirmDescription: t('git.actionsMenu.cleanup.cleanAll.confirmDescription'),
        confirmText: t('common.clean'),
        cancelText: t('common.cancel'),
      },
      {
        id: 'discard-all-tracked',
        label: t('git.actionsMenu.cleanup.discardAllTracked.label'),
        description: t('git.actionsMenu.cleanup.discardAllTracked.description'),
        variant: 'destructive',
        confirmTitle: t('git.actionsMenu.cleanup.discardAllTracked.confirmTitle'),
        confirmDescription: t('git.actionsMenu.cleanup.discardAllTracked.confirmDescription'),
        confirmText: t('common.discard'),
        cancelText: t('common.cancel'),
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
    :title="t('git.ui.sourceControlActions')"
    :mobile-title="t('git.ui.sourceControlActions')"
    :searchable="true"
    desktop-placement="bottom-end"
    :desktop-fixed="!props.isMobilePointer"
    :desktop-anchor-el="props.actionsAnchorEl ?? null"
    :search-placeholder="t('common.searchActions')"
    :empty-text="t('common.noActionsFound')"
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
    :description="t('git.ui.dialogs.commitErrorDescription')"
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
        <Button variant="secondary" size="sm" @click="commitErrorOpen = false">{{ t('common.close') }}</Button>
        <Button
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(repoDirOrEmpty(), props.terminalCommandForCommit(props.commitMessage))
              commitErrorOpen = false
            }
          "
        >
          {{ t('common.useTerminal') }}
        </Button>
      </div>
    </div>
  </Dialog>

  <!-- Post Commit Prompt -->
  <Dialog
    :open="postCommitOpen"
    :title="postCommitTitle"
    :description="t('git.ui.postCommit.description')"
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
      <div class="text-[11px] text-muted-foreground">
        {{ t('git.ui.postCommit.globalDefault', { label: postCommitDefaultLabel }) }}
      </div>
      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input v-model="postCommitRememberChoice" type="checkbox" class="accent-primary" />
        {{ t('git.ui.postCommit.rememberChoice') }}
      </label>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" @click="props.dismissPostCommitPrompt">{{ t('common.later') }}</Button>
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              void props.triggerPostCommitAction('sync')
            }
          "
          >{{ t('git.actions.sync') }}</Button
        >
        <Button
          size="sm"
          @click="
            () => {
              void props.triggerPostCommitAction('push')
            }
          "
          >{{ t('git.actions.push') }}</Button
        >
      </div>
    </div>
  </Dialog>
</template>
