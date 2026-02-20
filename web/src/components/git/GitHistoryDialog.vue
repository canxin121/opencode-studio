<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'
import DiffViewer from '@/components/DiffViewer.vue'

import type { GitCommitFile, GitLogCommit } from '@/types/git'

const props = defineProps<{
  open: boolean
  loading: boolean
  error: string | null
  commits: GitLogCommit[]
  hasMore: boolean
  selected: GitLogCommit | null
  files: GitCommitFile[]
  filesLoading: boolean
  filesError: string | null
  selectedFile: GitCommitFile | null
  fileDiff: string
  fileDiffLoading: boolean
  fileDiffError: string | null
  filterPath: string | null
  filterAuthor: string
  filterMessage: string
  filterRef: string
  filterRefType: 'branch' | 'tag'
  branchOptions: string[]
  tagOptions: string[]
  diff: string
  diffLoading: boolean
  diffError: string | null
  compareSelectedHash: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'select', commit: GitLogCommit): void
  (e: 'selectFile', file: GitCommitFile): void
  (e: 'clearFile'): void
  (e: 'checkout', commit: GitLogCommit): void
  (e: 'createBranch', commit: GitLogCommit): void
  (e: 'copyHash', hash: string): void
  (e: 'selectCompare', commit: GitLogCommit): void
  (e: 'clearCompare'): void
  (e: 'compareWithParent', commit: GitLogCommit): void
  (e: 'compareWithSelected', commit: GitLogCommit): void
  (e: 'cherryPick', commit: GitLogCommit): void
  (e: 'revert', commit: GitLogCommit): void
  (e: 'reset', payload: { commit: GitLogCommit; mode: 'soft' | 'mixed' | 'hard' }): void
  (e: 'loadMore'): void
  (e: 'refresh'): void
  (e: 'clearFilter'): void
  (e: 'update:filterAuthor', value: string): void
  (e: 'update:filterMessage', value: string): void
  (e: 'update:filterRef', value: string): void
  (e: 'update:filterRefType', value: 'branch' | 'tag'): void
  (e: 'applyFilters'): void
  (e: 'clearFilters'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function formatDate(value: string) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

const selectedMeta = computed(() => {
  const c = props.selected
  if (!c) return ''
  const date = formatDate(c.authorDate)
  const author = c.authorName || 'Unknown'
  return `${author}${date ? ` · ${date}` : ''}`
})

const selectedRefs = computed(() => props.selected?.refs || [])
const selectedFileLabel = computed(() => props.selectedFile?.path || '')
const refOptions = computed(() => (props.filterRefType === 'tag' ? props.tagOptions : props.branchOptions))

const filterRefTypePickerOptions: PickerOption[] = [
  { value: 'branch', label: 'Branch' },
  { value: 'tag', label: 'Tag' },
]

const refPickerOptions = computed<PickerOption[]>(() => {
  const list = Array.isArray(refOptions.value) ? refOptions.value : []
  return list.map((r) => ({ value: r, label: r }))
})

const resetMode = ref<'soft' | 'mixed' | 'hard'>('mixed')

const resetModePickerOptions: PickerOption[] = [
  { value: 'soft', label: 'Reset soft' },
  { value: 'mixed', label: 'Reset mixed' },
  { value: 'hard', label: 'Reset hard' },
]
const hardResetOpen = ref(false)
const hardResetText = ref('')
const hardResetTarget = ref<GitLogCommit | null>(null)

const hardResetReady = computed(() => hardResetText.value.trim().toUpperCase() === 'RESET')
const compareSelectionShort = computed(() => {
  const hash = (props.compareSelectedHash || '').trim()
  return hash ? hash.slice(0, 7) : ''
})
const selectedParentHash = computed(() => {
  const parent = props.selected?.parents?.[0]
  const hash = typeof parent === 'string' ? parent.trim() : ''
  return hash || ''
})

function requestReset(commit: GitLogCommit | null) {
  if (!commit) return
  if (resetMode.value === 'hard') {
    hardResetTarget.value = commit
    hardResetText.value = ''
    hardResetOpen.value = true
    return
  }
  emit('reset', { commit, mode: resetMode.value })
}

function confirmHardReset() {
  const target = hardResetTarget.value
  if (!target) return
  if (!hardResetReady.value) return
  emit('reset', { commit: target, mode: 'hard' })
  hardResetOpen.value = false
  hardResetTarget.value = null
  hardResetText.value = ''
}

function onFilterRefTypeChange(value: string | number) {
  const v = String(value || '')
  emit('update:filterRefType', v === 'tag' ? 'tag' : 'branch')
}
</script>

<template>
  <FormDialog
    :open="open"
    title="History"
    description="Recent commits"
    maxWidth="max-w-6xl"
    @update:open="onUpdateOpen"
  >
    <div class="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="text-xs font-medium text-muted-foreground">Commits</div>
          <Button variant="secondary" size="sm" :disabled="loading" @click="$emit('refresh')">Refresh</Button>
        </div>

        <div
          v-if="compareSelectionShort"
          class="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-2 py-1"
        >
          <div class="text-[11px] text-muted-foreground">
            Compare base:
            <span class="font-mono">{{ compareSelectionShort }}</span>
          </div>
          <Button variant="ghost" size="sm" class="h-6" @click="$emit('clearCompare')">Clear</Button>
        </div>

        <div
          v-if="filterPath"
          class="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-2 py-1"
        >
          <div class="text-[11px] text-muted-foreground font-mono truncate">{{ filterPath }}</div>
          <Button variant="ghost" size="sm" class="h-6" @click="$emit('clearFilter')">Clear</Button>
        </div>

        <div class="grid gap-2 rounded-md border border-border/50 bg-muted/10 p-2">
          <div class="text-[11px] font-medium text-muted-foreground">Search</div>
          <div class="grid gap-2 lg:grid-cols-[120px_1fr]">
            <OptionPicker
              :model-value="filterRefType"
              :options="filterRefTypePickerOptions"
              title="Ref type"
              search-placeholder="Search types"
              :include-empty="false"
              trigger-class="h-8 rounded border border-input bg-background text-xs px-2"
              size="sm"
              @update:model-value="onFilterRefTypeChange"
            />
            <Input
              :model-value="filterRef"
              class="h-8 font-mono text-xs"
              :placeholder="filterRefType === 'tag' ? 'Tag name' : 'Branch name'"
              @update:model-value="(v) => $emit('update:filterRef', String(v))"
            />
          </div>
          <OptionPicker
            v-if="refOptions.length"
            :model-value="filterRef"
            @update:model-value="(v) => $emit('update:filterRef', String(v || ''))"
            :options="refPickerOptions"
            title="Ref"
            search-placeholder="Search refs"
            :empty-label="`All ${filterRefType === 'tag' ? 'tags' : 'branches'}`"
            trigger-class="h-8 rounded border border-input bg-background text-xs px-2"
            size="sm"
            monospace
          />
          <Input
            :model-value="filterAuthor"
            class="h-8 font-mono text-xs"
            placeholder="Author contains"
            @update:model-value="(v) => $emit('update:filterAuthor', String(v))"
          />
          <Input
            :model-value="filterMessage"
            class="h-8 font-mono text-xs"
            placeholder="Message contains"
            @update:model-value="(v) => $emit('update:filterMessage', String(v))"
          />
          <div class="flex items-center gap-2">
            <Button size="sm" class="h-7" @click="$emit('applyFilters')">Search</Button>
            <Button variant="secondary" size="sm" class="h-7" @click="$emit('clearFilters')">Clear</Button>
          </div>
        </div>

        <div class="rounded-md border border-border/50 overflow-hidden">
          <div v-if="error" class="p-3 text-xs text-red-500">{{ error }}</div>
          <div v-else-if="loading && !commits.length" class="p-3 text-xs text-muted-foreground">Loading...</div>
          <ScrollArea v-else class="h-72">
            <div v-if="!commits.length" class="p-3 text-xs text-muted-foreground">No commits</div>
            <div v-else class="divide-y divide-border/40">
              <button
                v-for="c in commits"
                :key="c.hash"
                type="button"
                class="w-full text-left p-3 hover:bg-muted/40 transition-colors"
                :class="selected?.hash === c.hash ? 'bg-muted/50' : ''"
                @click="$emit('select', c)"
              >
                <div class="flex items-start gap-2">
                  <span v-if="c.graph" class="text-[10px] font-mono text-muted-foreground whitespace-pre">
                    {{ c.graph }}
                  </span>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-foreground truncate">
                      {{ c.subject || '(no message)' }}
                    </div>
                    <div class="text-[11px] text-muted-foreground mt-1">
                      <span class="font-mono">{{ c.shortHash }}</span>
                      <span v-if="c.authorName" class="ml-2">{{ c.authorName }}</span>
                      <span v-if="c.authorDate" class="ml-2">{{ formatDate(c.authorDate) }}</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </ScrollArea>
        </div>

        <div class="flex justify-between">
          <Button
            variant="secondary"
            size="sm"
            class="w-full"
            :disabled="!hasMore || loading"
            @click="$emit('loadMore')"
          >
            Load more
          </Button>
        </div>
      </div>

      <div class="rounded-md border border-border/50 bg-background/40 p-3 min-h-[20rem]">
        <div v-if="!selected" class="text-xs text-muted-foreground">Select a commit to view diff.</div>
        <div v-else class="space-y-3">
          <div class="space-y-1">
            <div class="text-sm font-semibold text-foreground">{{ selected.subject || '(no message)' }}</div>
            <div class="text-[11px] text-muted-foreground">{{ selectedMeta }}</div>
            <div class="text-[11px] text-muted-foreground font-mono">{{ selected.hash }}</div>
            <div v-if="selected.body" class="text-[11px] text-muted-foreground whitespace-pre-wrap">
              {{ selected.body }}
            </div>
            <div v-if="selectedRefs.length" class="flex flex-wrap gap-1">
              <span
                v-for="r in selectedRefs"
                :key="r"
                class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
              >
                {{ r }}
              </span>
            </div>
            <div class="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" @click="$emit('copyHash', selected.hash)">Copy hash</Button>
              <Button variant="secondary" size="sm" @click="$emit('checkout', selected)">Checkout</Button>
              <Button variant="secondary" size="sm" @click="$emit('createBranch', selected)">Create branch</Button>
              <Button
                variant="secondary"
                size="sm"
                :disabled="compareSelectedHash === selected.hash"
                @click="$emit('selectCompare', selected)"
              >
                {{
                  compareSelectedHash === selected.hash ? `Selected (${compareSelectionShort})` : 'Select for compare'
                }}
              </Button>
              <Button
                v-if="selectedParentHash"
                variant="secondary"
                size="sm"
                @click="$emit('compareWithParent', selected)"
              >
                Compare with parent
              </Button>
              <Button
                v-if="compareSelectedHash && compareSelectedHash !== selected.hash"
                variant="secondary"
                size="sm"
                @click="$emit('compareWithSelected', selected)"
              >
                Compare with selected
              </Button>
              <div class="flex items-center gap-1">
                <div class="w-[140px]">
                  <OptionPicker
                    v-model="resetMode"
                    :options="resetModePickerOptions"
                    title="Reset mode"
                    search-placeholder="Search modes"
                    :include-empty="false"
                    trigger-class="h-7 rounded border border-input bg-background text-[11px] px-2"
                    size="sm"
                  />
                </div>
                <ConfirmPopover
                  title="Reset to this commit?"
                  description="This will move HEAD and update the working tree based on mode."
                  confirm-text="Reset"
                  cancel-text="Cancel"
                  variant="destructive"
                  @confirm="requestReset(selected)"
                >
                  <Button variant="secondary" size="sm" @click="() => {}">Reset</Button>
                </ConfirmPopover>
              </div>
              <ConfirmPopover
                title="Cherry-pick this commit?"
                description="This will apply the commit on top of the current branch."
                confirm-text="Cherry-pick"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('cherryPick', selected)"
              >
                <Button variant="secondary" size="sm" @click="() => {}">Cherry-pick</Button>
              </ConfirmPopover>
              <ConfirmPopover
                title="Revert this commit?"
                description="This will create a new commit that reverts the changes."
                confirm-text="Revert"
                cancel-text="Cancel"
                variant="destructive"
                @confirm="$emit('revert', selected)"
              >
                <Button variant="secondary" size="sm" @click="() => {}">Revert</Button>
              </ConfirmPopover>
            </div>
          </div>

          <div class="border-t border-border/60 pt-3 space-y-2">
            <div class="flex items-center justify-between">
              <div class="text-xs font-medium text-muted-foreground">Files</div>
              <Button variant="ghost" size="sm" class="h-6" :disabled="!selectedFile" @click="$emit('clearFile')">
                All files
              </Button>
            </div>
            <div class="rounded-md border border-border/40 overflow-hidden">
              <div v-if="filesError" class="p-2 text-xs text-red-500">{{ filesError }}</div>
              <div v-else-if="filesLoading" class="p-2 text-xs text-muted-foreground">Loading files...</div>
              <ScrollArea v-else class="h-36">
                <div v-if="!files.length" class="p-2 text-xs text-muted-foreground">No file changes.</div>
                <div v-else class="divide-y divide-border/40">
                  <button
                    v-for="f in files"
                    :key="`${f.status}:${f.path}`"
                    type="button"
                    class="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/40"
                    :class="selectedFile?.path === f.path ? 'bg-muted/60' : ''"
                    @click="$emit('selectFile', f)"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-[10px] font-mono text-muted-foreground w-4">{{ f.status }}</span>
                      <span class="font-mono truncate flex-1">{{ f.path }}</span>
                      <span v-if="f.oldPath" class="text-[10px] text-muted-foreground truncate">{{ f.oldPath }}</span>
                      <span v-if="f.insertions > 0" class="text-[10px] text-emerald-500 font-mono"
                        >+{{ f.insertions }}</span
                      >
                      <span v-if="f.deletions > 0" class="text-[10px] text-rose-500 font-mono">-{{ f.deletions }}</span>
                    </div>
                  </button>
                </div>
              </ScrollArea>
            </div>

            <div class="pt-2">
              <div class="text-xs font-medium text-muted-foreground mb-1">
                {{ selectedFileLabel ? `Diff — ${selectedFileLabel}` : 'Diff — All files' }}
              </div>
              <div v-if="selectedFileLabel">
                <div v-if="fileDiffError" class="text-xs text-red-500">{{ fileDiffError }}</div>
                <div v-else-if="fileDiffLoading" class="text-xs text-muted-foreground">Loading diff...</div>
                <div v-else-if="!fileDiff" class="text-xs text-muted-foreground">No diff content.</div>
                <div v-else class="h-[320px] min-h-0">
                  <DiffViewer :diff="fileDiff" :output-format="'side-by-side'" :draw-file-list="false" />
                </div>
              </div>
              <div v-else>
                <div v-if="diffError" class="text-xs text-red-500">{{ diffError }}</div>
                <div v-else-if="diffLoading" class="text-xs text-muted-foreground">Loading diff...</div>
                <div v-else-if="!diff" class="text-xs text-muted-foreground">No diff content.</div>
                <div v-else class="h-[320px] min-h-0">
                  <DiffViewer :diff="diff" :output-format="'side-by-side'" :draw-file-list="false" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </FormDialog>

  <ConfirmPopover
    :open="hardResetOpen"
    force-dialog
    title="Confirm hard reset"
    description="This will rewrite the working tree and discard local changes."
    confirm-text="Confirm hard reset"
    cancel-text="Cancel"
    variant="destructive"
    :confirm-disabled="!hardResetReady"
    max-width="max-w-md"
    @update:open="
      (v: boolean) => {
        hardResetOpen = v
        if (!v) {
          hardResetTarget = null
          hardResetText = ''
        }
      }
    "
    @cancel="hardResetOpen = false"
    @confirm="confirmHardReset"
  >
    <template #content>
      <div class="text-xs text-muted-foreground">Type <span class="font-mono">RESET</span> to confirm hard reset.</div>
      <Input v-model="hardResetText" class="h-8 font-mono text-xs" placeholder="RESET" />
    </template>
  </ConfirmPopover>
</template>
