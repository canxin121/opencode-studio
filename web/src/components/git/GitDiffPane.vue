<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiArrowGoBackLine, RiGitBranchLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import ConflictEditor from '@/components/ConflictEditor.vue'
import GitEditorDiffViewer from '@/components/git/GitEditorDiffViewer.vue'

type DiffSource = 'working' | 'staged'

const props = defineProps<{
  directory: string
  selectedFile: string | null
  diffSource: DiffSource
  isMobile: boolean
  selectedIsConflict: boolean
  conflictPaths?: string[]
  stageHunk?: (patch: string) => void | Promise<void>
  unstageHunk?: (patch: string) => void | Promise<void>
  discardHunk?: (patch: string) => void | Promise<void>
  stageSelected?: (patch: string) => void | Promise<void>
  unstageSelected?: (patch: string) => void | Promise<void>
  discardSelected?: (patch: string) => void | Promise<void>
  openFile?: (path: string) => void | Promise<void>
  revealFile?: (path: string) => void | Promise<void>
}>()

const emit = defineEmits<{
  (e: 'update:selectedFile', value: string | null): void
  (e: 'resolved'): void
}>()

const diffViewerRef = ref<InstanceType<typeof GitEditorDiffViewer> | null>(null)
const forceDiffForPath = ref('')

function refreshDiff() {
  diffViewerRef.value?.refresh?.()
}

defineExpose({ refreshDiff })

const sourceLabel = computed(() => (props.diffSource === 'staged' ? 'Index' : 'Working Tree'))
const showConflictEditor = computed(() => {
  const file = (props.selectedFile || '').trim()
  if (!file) return false
  if (props.diffSource !== 'working' || !props.selectedIsConflict) return false
  return forceDiffForPath.value !== file
})

watch(
  () => [props.selectedFile, props.selectedIsConflict, props.diffSource] as const,
  (next, prev) => {
    const file = next[0]
    const isConflict = next[1]
    const source = next[2]
    const prevFile = prev?.[0]
    const current = (file || '').trim()
    const previous = (prevFile || '').trim()
    if (current !== previous) {
      forceDiffForPath.value = ''
      return
    }
    if (!isConflict || source !== 'working') {
      forceDiffForPath.value = ''
    }
  },
)

function openConflictPath(path: string) {
  emit('update:selectedFile', path)
}

function openDiffFallback() {
  const path = (props.selectedFile || '').trim()
  if (!path) return
  forceDiffForPath.value = path
}

function returnToConflictEditor() {
  forceDiffForPath.value = ''
}

function handleResolved() {
  forceDiffForPath.value = ''
  emit('resolved')
}

function close() {
  emit('update:selectedFile', null)
}
</script>

<template>
  <div class="flex flex-1 flex-col min-w-0 bg-background/30 relative h-full overflow-hidden">
    <div
      v-if="isMobile && selectedFile"
      class="h-12 border-b border-border/40 flex items-center bg-background flex-shrink-0 px-4 select-none"
    >
      <Button variant="ghost" size="sm" class="h-8 w-8 -ml-2 mr-1 p-0 rounded-full" @click="close">
        <RiArrowGoBackLine class="h-5 w-5" />
      </Button>
      <div class="flex flex-col min-w-0 overflow-hidden">
        <span class="text-sm font-mono font-medium truncate">{{ selectedFile }}</span>
        <span class="text-[10px] text-muted-foreground uppercase tracking-wide">{{ sourceLabel }}</span>
      </div>
    </div>

    <div v-if="!selectedFile" class="flex-1 flex items-center justify-center text-muted-foreground">
      <div class="text-center">
        <RiGitBranchLine class="h-12 w-12 mx-auto mb-2 opacity-20" />
        <p class="text-sm">Select a file to view changes</p>
      </div>
    </div>
    <div v-else class="flex-1 flex flex-col min-h-0">
      <div class="flex-1 overflow-hidden relative">
        <div
          v-if="selectedFile && diffSource === 'working' && selectedIsConflict && !showConflictEditor"
          class="absolute top-2 right-2 z-10"
        >
          <Button variant="secondary" size="sm" class="h-7" @click="returnToConflictEditor"
            >Open Conflict Editor</Button
          >
        </div>
        <ConflictEditor
          v-if="showConflictEditor"
          :directory="directory || ''"
          :path="selectedFile || ''"
          :conflict-paths="conflictPaths || []"
          @resolved="handleResolved"
          @fallbackDiff="openDiffFallback"
          @selectConflict="openConflictPath"
        />
        <GitEditorDiffViewer
          v-else
          ref="diffViewerRef"
          :directory="directory || ''"
          :path="selectedFile"
          :staged="diffSource === 'staged'"
          :on-stage-hunk="props.stageHunk"
          :on-unstage-hunk="props.unstageHunk"
          :on-discard-hunk="props.discardHunk"
          :on-open-file="props.openFile"
          :on-reveal-file="props.revealFile"
        />
      </div>
    </div>
  </div>
</template>
