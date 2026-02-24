<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import MiniActionButton from '@/components/ui/MiniActionButton.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'

const { t } = useI18n()

type RemoteInfo = {
  remotes?: Array<{ name: string; protocol?: string | null; host?: string | null }>
} | null

const props = defineProps<{
  remoteInfo: RemoteInfo
  remoteBranchLoading: boolean
  filteredRemoteBranchOptions: string[]

  hideBranchPickSoon: () => void
  onBranchPickKeydown: (ev: KeyboardEvent) => void

  pushToTarget: () => void
  pullFromTarget: () => void
  fetchFromTarget: () => void
  stashPush: () => void
}>()

const pushToOpen = defineModel<boolean>('pushToOpen', { required: true })
const pullFromOpen = defineModel<boolean>('pullFromOpen', { required: true })
const fetchFromOpen = defineModel<boolean>('fetchFromOpen', { required: true })

const targetRemote = defineModel<string>('targetRemote', { required: true })
const targetBranch = defineModel<string>('targetBranch', { required: true })
const targetRef = defineModel<string>('targetRef', { required: true })
const targetSetUpstream = defineModel<boolean>('targetSetUpstream', { required: true })

const branchPickVisible = defineModel<boolean>('branchPickVisible', { required: true })
const branchPickIndex = defineModel<number>('branchPickIndex', { required: true })

const stashDialogOpen = defineModel<boolean>('stashDialogOpen', { required: true })
const stashMessage = defineModel<string>('stashMessage', { required: true })
const stashIncludeUntracked = defineModel<boolean>('stashIncludeUntracked', { required: true })
const stashKeepIndex = defineModel<boolean>('stashKeepIndex', { required: true })
const stashStaged = defineModel<boolean>('stashStaged', { required: true })

const remotePickerOptions = computed<PickerOption[]>(() => {
  const list = Array.isArray(props.remoteInfo?.remotes) ? props.remoteInfo?.remotes || [] : []
  return list.map((r) => {
    const proto = r.protocol ? String(r.protocol) : ''
    const host = r.host ? String(r.host) : ''
    const details = `${proto}${host ? `://${host}` : ''}`.trim()
    return {
      value: r.name,
      label: details ? `${r.name} (${details})` : r.name,
    }
  })
})
</script>

<template>
  <!-- Push To... Dialog -->
  <FormDialog
    :open="pushToOpen"
    :title="t('git.remoteTargetDialogs.push.title')"
    :description="t('git.remoteTargetDialogs.chooseRemoteAndBranch')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        pushToOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.remote') }}</div>
          <OptionPicker
            v-model="targetRemote"
            :options="remotePickerOptions"
            :title="t('git.fields.remote')"
            :search-placeholder="t('git.ui.searchRemotes')"
            :include-empty="false"
            trigger-class="rounded border bg-background text-xs px-2"
            size="sm"
          />
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.branch') }}</div>
          <Input
            v-model="targetBranch"
            class="h-9 font-mono text-xs"
            placeholder="main"
            @focus="
              () => {
                branchPickVisible = true
                branchPickIndex = 0
              }
            "
            @blur="props.hideBranchPickSoon"
            @keydown="props.onBranchPickKeydown"
          />
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">{{
            t('git.remoteTargetDialogs.loadingRemoteBranches')
          }}</div>
          <div
            v-else-if="branchPickVisible && filteredRemoteBranchOptions.length"
            class="mt-1 max-h-28 overflow-auto rounded-md border border-border/50 bg-background/40"
          >
            <button
              v-for="(b, idx) in filteredRemoteBranchOptions.slice(0, 20)"
              :key="`push-branch:${b}`"
              type="button"
              class="w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-muted/30"
              :class="idx === branchPickIndex ? 'bg-muted/40' : ''"
              @mouseenter="branchPickIndex = idx"
              @click="
                () => {
                  targetBranch = b
                  branchPickVisible = false
                }
              "
            >
              {{ b }}
            </button>
          </div>
          <div class="text-[11px] text-muted-foreground">{{ t('git.remoteTargetDialogs.push.advancedHint') }}</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.refspecOptional') }}</div>
          <Input v-model="targetRef" class="h-9 font-mono text-xs" placeholder="HEAD:refs/heads/main" />
        </div>

        <label class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input v-model="targetSetUpstream" type="checkbox" class="accent-primary" />
          <span>{{ t('git.remoteTargetDialogs.push.setUpstream') }}</span>
        </label>
        <div class="text-[11px] text-muted-foreground">{{ t('git.remoteTargetDialogs.push.tipTerminal') }}</div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="pushToOpen = false">{{ t('common.cancel') }}</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.pushToTarget"
          >{{ t('git.actions.push') }}</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Pull From... Dialog -->
  <FormDialog
    :open="pullFromOpen"
    :title="t('git.remoteTargetDialogs.pull.title')"
    :description="t('git.remoteTargetDialogs.chooseRemoteAndBranch')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        pullFromOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.remote') }}</div>
          <OptionPicker
            v-model="targetRemote"
            :options="remotePickerOptions"
            :title="t('git.fields.remote')"
            :search-placeholder="t('git.ui.searchRemotes')"
            :include-empty="false"
            trigger-class="rounded border bg-background text-xs px-2"
            size="sm"
          />
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.branch') }}</div>
          <Input
            v-model="targetBranch"
            class="h-9 font-mono text-xs"
            placeholder="main"
            @focus="
              () => {
                branchPickVisible = true
                branchPickIndex = 0
              }
            "
            @blur="props.hideBranchPickSoon"
            @keydown="props.onBranchPickKeydown"
          />
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">{{
            t('git.remoteTargetDialogs.loadingRemoteBranches')
          }}</div>
          <div
            v-else-if="branchPickVisible && filteredRemoteBranchOptions.length"
            class="mt-1 max-h-28 overflow-auto rounded-md border border-border/50 bg-background/40"
          >
            <button
              v-for="(b, idx) in filteredRemoteBranchOptions.slice(0, 20)"
              :key="`pull-branch:${b}`"
              type="button"
              class="w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-muted/30"
              :class="idx === branchPickIndex ? 'bg-muted/40' : ''"
              @mouseenter="branchPickIndex = idx"
              @click="
                () => {
                  targetBranch = b
                  branchPickVisible = false
                }
              "
            >
              {{ b }}
            </button>
          </div>
          <div class="text-[11px] text-muted-foreground">{{ t('git.remoteTargetDialogs.pull.advancedHint') }}</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.refspecOptional') }}</div>
          <Input v-model="targetRef" class="h-9 font-mono text-xs" placeholder="refs/heads/main" />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="pullFromOpen = false">{{ t('common.cancel') }}</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.pullFromTarget"
          >{{ t('git.actions.pull') }}</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Fetch From... Dialog -->
  <FormDialog
    :open="fetchFromOpen"
    :title="t('git.remoteTargetDialogs.fetch.title')"
    :description="t('git.remoteTargetDialogs.fetch.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        fetchFromOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.remote') }}</div>
          <OptionPicker
            v-model="targetRemote"
            :options="remotePickerOptions"
            :title="t('git.fields.remote')"
            :search-placeholder="t('git.ui.searchRemotes')"
            :include-empty="false"
            trigger-class="rounded border bg-background text-xs px-2"
            size="sm"
          />
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.branch') }}</div>
          <Input
            v-model="targetBranch"
            class="h-9 font-mono text-xs"
            placeholder="main"
            @focus="
              () => {
                branchPickVisible = true
                branchPickIndex = 0
              }
            "
            @blur="props.hideBranchPickSoon"
            @keydown="props.onBranchPickKeydown"
          />
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">{{
            t('git.remoteTargetDialogs.loadingRemoteBranches')
          }}</div>
          <div
            v-else-if="branchPickVisible && filteredRemoteBranchOptions.length"
            class="mt-1 max-h-28 overflow-auto rounded-md border border-border/50 bg-background/40"
          >
            <button
              v-for="(b, idx) in filteredRemoteBranchOptions.slice(0, 20)"
              :key="`fetch-branch:${b}`"
              type="button"
              class="w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-muted/30"
              :class="idx === branchPickIndex ? 'bg-muted/40' : ''"
              @mouseenter="branchPickIndex = idx"
              @click="
                () => {
                  targetBranch = b
                  branchPickVisible = false
                }
              "
            >
              {{ b }}
            </button>
          </div>
          <div class="text-[11px] text-muted-foreground">{{ t('git.remoteTargetDialogs.fetch.advancedHint') }}</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.refspecOptional') }}</div>
          <Input
            v-model="targetRef"
            class="h-9 font-mono text-xs"
            placeholder="refs/heads/main:refs/remotes/origin/main"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="fetchFromOpen = false">{{ t('common.cancel') }}</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.fetchFromTarget"
          >{{ t('git.actions.fetch') }}</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Stash Dialog -->
  <FormDialog
    :open="stashDialogOpen"
    :title="t('git.remoteTargetDialogs.stash.title')"
    :description="t('git.remoteTargetDialogs.stash.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        stashDialogOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.fields.messageOptional') }}</div>
        <Input v-model="stashMessage" class="h-9 font-mono text-xs" placeholder="wip" />
      </div>
      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input v-model="stashStaged" type="checkbox" class="accent-primary" />
        <span>{{ t('git.remoteTargetDialogs.stash.stagedOnly') }}</span>
      </label>
      <label
        class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none"
        :class="stashStaged ? 'opacity-60' : ''"
      >
        <input v-model="stashIncludeUntracked" type="checkbox" class="accent-primary" :disabled="stashStaged" />
        <span>{{ t('git.remoteTargetDialogs.stash.includeUntracked') }}</span>
      </label>
      <label
        class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none"
        :class="stashStaged ? 'opacity-60' : ''"
      >
        <input v-model="stashKeepIndex" type="checkbox" class="accent-primary" :disabled="stashStaged" />
        <span>{{ t('git.remoteTargetDialogs.stash.keepIndex') }}</span>
      </label>
      <div class="flex justify-end gap-2">
        <MiniActionButton @click="stashDialogOpen = false">{{ t('common.cancel') }}</MiniActionButton>
        <MiniActionButton variant="default" @click="props.stashPush">{{ t('git.actions.stash') }}</MiniActionButton>
      </div>
    </div>
  </FormDialog>
</template>
