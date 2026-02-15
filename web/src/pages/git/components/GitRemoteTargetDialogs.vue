<script setup lang="ts">
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import MiniActionButton from '@/components/ui/MiniActionButton.vue'

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
</script>

<template>
  <!-- Push To... Dialog -->
  <FormDialog
    :open="pushToOpen"
    title="Push To..."
    description="Choose a remote and branch"
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
          <div class="text-xs font-medium text-muted-foreground">Remote</div>
          <select v-model="targetRemote" class="h-9 rounded border border-input bg-background text-xs px-2">
            <option v-for="r in props.remoteInfo?.remotes || []" :key="r.name" :value="r.name">
              {{ r.name }} ({{ r.protocol }}{{ r.host ? `://${r.host}` : '' }})
            </option>
          </select>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Branch</div>
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
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">Loading remote branches...</div>
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
          <div class="text-[11px] text-muted-foreground">Or provide a refspec below (for advanced push).</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Refspec (optional)</div>
          <Input v-model="targetRef" class="h-9 font-mono text-xs" placeholder="HEAD:refs/heads/main" />
        </div>

        <label class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input v-model="targetSetUpstream" type="checkbox" class="accent-primary" />
          <span>Set upstream (-u)</span>
        </label>
        <div class="text-[11px] text-muted-foreground">Tip: if auth/signing prompts are needed, use Terminal.</div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="pushToOpen = false">Cancel</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.pushToTarget"
          >Push</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Pull From... Dialog -->
  <FormDialog
    :open="pullFromOpen"
    title="Pull From..."
    description="Choose a remote and branch"
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
          <div class="text-xs font-medium text-muted-foreground">Remote</div>
          <select v-model="targetRemote" class="h-9 rounded border border-input bg-background text-xs px-2">
            <option v-for="r in props.remoteInfo?.remotes || []" :key="r.name" :value="r.name">
              {{ r.name }} ({{ r.protocol }}{{ r.host ? `://${r.host}` : '' }})
            </option>
          </select>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Branch</div>
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
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">Loading remote branches...</div>
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
          <div class="text-[11px] text-muted-foreground">Or provide a refspec below (for advanced pull).</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Refspec (optional)</div>
          <Input v-model="targetRef" class="h-9 font-mono text-xs" placeholder="refs/heads/main" />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="pullFromOpen = false">Cancel</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.pullFromTarget"
          >Pull</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Fetch From... Dialog -->
  <FormDialog
    :open="fetchFromOpen"
    title="Fetch From..."
    description="Choose a remote and branch to fetch"
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
          <div class="text-xs font-medium text-muted-foreground">Remote</div>
          <select v-model="targetRemote" class="h-9 rounded border border-input bg-background text-xs px-2">
            <option v-for="r in props.remoteInfo?.remotes || []" :key="r.name" :value="r.name">
              {{ r.name }} ({{ r.protocol }}{{ r.host ? `://${r.host}` : '' }})
            </option>
          </select>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Branch</div>
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
          <div v-if="remoteBranchLoading" class="text-[11px] text-muted-foreground">Loading remote branches...</div>
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
          <div class="text-[11px] text-muted-foreground">Or provide a refspec below (for advanced fetch).</div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">Refspec (optional)</div>
          <Input
            v-model="targetRef"
            class="h-9 font-mono text-xs"
            placeholder="refs/heads/main:refs/remotes/origin/main"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <MiniActionButton @click="fetchFromOpen = false">Cancel</MiniActionButton>
        <MiniActionButton
          variant="default"
          :disabled="!targetRemote.trim() || (!targetBranch.trim() && !targetRef.trim())"
          @click="props.fetchFromTarget"
          >Fetch</MiniActionButton
        >
      </div>
    </div>
  </FormDialog>

  <!-- Stash Dialog -->
  <FormDialog
    :open="stashDialogOpen"
    title="Stash Changes"
    description="Save local changes for later"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        stashDialogOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">Message (optional)</div>
        <Input v-model="stashMessage" class="h-9 font-mono text-xs" placeholder="wip" />
      </div>
      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input v-model="stashStaged" type="checkbox" class="accent-primary" />
        <span>Staged only</span>
      </label>
      <label
        class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none"
        :class="stashStaged ? 'opacity-60' : ''"
      >
        <input v-model="stashIncludeUntracked" type="checkbox" class="accent-primary" :disabled="stashStaged" />
        <span>Include untracked</span>
      </label>
      <label
        class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none"
        :class="stashStaged ? 'opacity-60' : ''"
      >
        <input v-model="stashKeepIndex" type="checkbox" class="accent-primary" :disabled="stashStaged" />
        <span>Keep staged (keep index)</span>
      </label>
      <div class="flex justify-end gap-2">
        <MiniActionButton @click="stashDialogOpen = false">Cancel</MiniActionButton>
        <MiniActionButton variant="default" @click="props.stashPush">Stash</MiniActionButton>
      </div>
    </div>
  </FormDialog>
</template>
