<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  RiPencilLine,
  RiFileEditLine,
  RiFileTextLine,
  RiTerminalBoxLine,
  RiFolder6Line,
  RiMenuSearchLine,
  RiFileSearchLine,
  RiGlobalLine,
  RiListCheck3,
  RiBookLine,
  RiSurveyLine,
  RiFileList2Line,
  RiTaskLine,
  RiGitBranchLine,
  RiToolsLine,
  RiCheckLine,
  RiStopCircleLine,
} from '@remixicon/vue'
import ActivityDisclosureButton from '@/components/ui/ActivityDisclosureButton.vue'
import CodeBlock from './CodeBlock.vue'
import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import { buildUnifiedMonacoDiffModel } from '@/features/git/diff/unifiedDiff'
import { useChatStore } from '@/stores/chat'
import { formatTimeHM } from '@/i18n/intl'
import { resolveToolInputDisplay } from './toolInvocationInput'

type ToolValue = unknown
type UnknownRecord = Record<string, ToolValue>
type ToolPartLike = {
  tool?: string
  state?: ToolValue
  ocLazy?: boolean
  metadata?: ToolValue
  time?: ToolValue
  [k: string]: ToolValue
}

function isRecord(value: ToolValue): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: ToolValue): UnknownRecord {
  return isRecord(value) ? value : {}
}

function toDisplayString(value: ToolValue): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const props = defineProps<{
  part: ToolPartLike
  initiallyExpanded?: boolean
  // When the session has ended, pending/running tools are considered stale.
  sessionEnded?: boolean
  // Bump this value to force-close all tool details.
  collapseSignal?: number
}>()

const isOpen = ref(Boolean(props.initiallyExpanded))

const chat = useChatStore()
const detailLoading = ref(false)

const partRecord = computed(() => asRecord(props.part))
const isLazy = computed(() => partRecord.value.ocLazy === true)

async function ensureDetail() {
  if (detailLoading.value) return
  if (!isLazy.value) return
  detailLoading.value = true
  try {
    await chat.ensureMessagePartDetail(props.part)
  } finally {
    detailLoading.value = false
  }
}

function toggleOpen() {
  const next = !isOpen.value
  isOpen.value = next
  if (next) void ensureDetail()
}

onMounted(() => {
  if (isOpen.value) void ensureDetail()
})

watch(
  () => props.collapseSignal,
  () => {
    // Don't collapse while a tool is still running; keep progress visible.
    if (isRunning.value) return
    isOpen.value = false
  },
)

// --- Logic ported from toolHelpers/ToolPart ---

const toolName = computed(() => {
  const value = partRecord.value.tool
  return typeof value === 'string' && value.trim() ? value : 'unknown'
})
const state = computed(() => asRecord(partRecord.value.state))
const status = computed(() => state.value.status)
const input = computed(() => asRecord(state.value.input))
const output = computed(() => state.value.output)
const error = computed(() => state.value.error)
const metadata = computed(() => {
  const stateMeta = isRecord(state.value.metadata) ? state.value.metadata : null
  if (stateMeta) return stateMeta
  const partMeta = isRecord(partRecord.value.metadata) ? partRecord.value.metadata : null
  if (partMeta) return partMeta
  const resultMeta = asRecord(asRecord(state.value.result).metadata)
  return resultMeta
})

const displayName = computed(() => {
  const t = toolName.value.toLowerCase()
  if (t === 'bash') return 'Run Command'
  if (t === 'edit' || t === 'multiedit') return 'Edit File'
  if (t === 'apply_patch') return 'Apply Patch'
  if (t === 'str_replace' || t === 'str_replace_based_edit_tool') return 'Replace Text'
  if (t === 'read') return 'Read File'
  if (t === 'write') return 'Write File'
  if (t === 'list') return 'List Files'
  if (t === 'glob') return 'Find Files'
  if (t === 'search') return 'Search'
  if (t === 'grep') return 'Grep'
  if (t === 'webfetch' || t === 'fetch' || t === 'curl' || t === 'wget') return 'Fetch URL'
  if (t === 'question') return 'Question'
  if (t === 'task') return 'Task'
  return t.charAt(0).toUpperCase() + t.slice(1)
})

const icon = computed(() => {
  const t = toolName.value.toLowerCase()
  if (['edit', 'multiedit', 'apply_patch', 'str_replace'].includes(t)) return RiPencilLine
  if (['write', 'create', 'file_write'].includes(t)) return RiFileEditLine
  if (['read', 'view', 'file_read', 'cat'].includes(t)) return RiFileTextLine
  if (['bash', 'shell', 'cmd', 'terminal'].includes(t)) return RiTerminalBoxLine
  if (['list', 'ls', 'dir', 'list_files'].includes(t)) return RiFolder6Line
  if (['search', 'grep', 'find', 'ripgrep'].includes(t)) return RiMenuSearchLine
  if (t === 'glob') return RiFileSearchLine
  if (['fetch', 'curl', 'wget', 'webfetch', 'web-search', 'google'].includes(t)) return RiGlobalLine
  if (['todowrite', 'todoread'].includes(t)) return RiListCheck3
  if (t === 'skill') return RiBookLine
  if (t === 'question') return RiSurveyLine
  if (t === 'plan_enter') return RiFileList2Line
  if (t === 'plan_exit') return RiTaskLine
  if (t.startsWith('git')) return RiGitBranchLine
  return RiToolsLine
})

function clipSummary(raw: string, max = 80): string {
  const oneLine = String(raw || '')
    .split('\n')[0]
    ?.trim()
  if (!oneLine) return ''
  return oneLine.substring(0, max)
}

function summarizeUnknownInputValue(value: ToolValue): string {
  if (typeof value === 'string') {
    return clipSummary(value, 80)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const compact = value
      .map((item) => {
        if (typeof item === 'string') return clipSummary(item, 60)
        if (typeof item === 'number' || typeof item === 'boolean') return String(item)
        return ''
      })
      .filter(Boolean)
      .slice(0, 8)
      .join(' ')
    return clipSummary(compact, 80)
  }
  return ''
}

const summary = computed(() => {
  const inp = input.value && typeof input.value === 'object' ? input.value : {}
  const t = toolName.value.toLowerCase()

  // Prefer upstream title/label when available.
  const title = typeof state.value?.title === 'string' ? state.value.title.trim() : ''
  if (title) return title.substring(0, 80)

  if (t === 'bash' && typeof inp.command === 'string') {
    const firstLine = inp.command.split('\n')[0] || ''
    return firstLine.substring(0, 60)
  }

  if (['edit', 'multiedit', 'read', 'write'].includes(t)) {
    const path = inp.filePath || inp.file_path || inp.path
    if (typeof path === 'string') {
      return path.split('/').pop() || path
    }
  }

  if (t === 'task' && typeof inp.description === 'string') {
    return inp.description.substring(0, 50)
  }

  if (t === 'glob' && typeof inp.pattern === 'string') {
    return inp.pattern.substring(0, 80)
  }

  if ((t === 'search' || t === 'grep') && typeof inp.pattern === 'string') {
    const where = typeof inp.path === 'string' ? inp.path : ''
    return where ? `${inp.pattern}  in  ${where}`.substring(0, 80) : inp.pattern.substring(0, 80)
  }

  if ((t === 'webfetch' || t === 'fetch' || t === 'curl' || t === 'wget') && typeof inp.url === 'string') {
    return inp.url.substring(0, 80)
  }

  if (t === 'question' && Array.isArray(inp.questions)) {
    return `Asked ${inp.questions.length} question(s)`
  }

  if (t === 'list' && typeof inp.path === 'string') {
    return inp.path
  }

  const fallbackKeys = [
    'description',
    'command',
    'argv',
    'query',
    'pattern',
    'path',
    'filePath',
    'file_path',
    'url',
    'name',
    'title',
    'prompt',
  ]
  for (const key of fallbackKeys) {
    const summarized = summarizeUnknownInputValue(inp[key])
    if (summarized) return summarized
  }

  for (const value of Object.values(inp)) {
    const summarized = summarizeUnknownInputValue(value)
    if (summarized) return summarized
  }

  return ''
})

const durationLabel = computed(() => {
  const directTime = asRecord(partRecord.value.time)
  const stateTime = asRecord(state.value.time)
  const start =
    typeof stateTime.start === 'number'
      ? stateTime.start
      : typeof directTime.start === 'number'
        ? directTime.start
        : null
  const end =
    typeof stateTime.end === 'number' ? stateTime.end : typeof directTime.end === 'number' ? directTime.end : null
  if (!start || !end || end <= start) return ''
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
})

function formatTimeShort(ms: number): string {
  return formatTimeHM(ms)
}

const timeLabel = computed(() => {
  const directTime = asRecord(partRecord.value.time)
  const stateTime = asRecord(state.value.time)
  const end =
    typeof stateTime.end === 'number' ? stateTime.end : typeof directTime.end === 'number' ? directTime.end : null
  const start =
    typeof stateTime.start === 'number'
      ? stateTime.start
      : typeof directTime.start === 'number'
        ? directTime.start
        : null
  const at = end ?? start
  if (!at) return ''
  return formatTimeShort(at)
})

const isStale = computed(
  () => Boolean(props.sessionEnded) && (status.value === 'running' || status.value === 'pending'),
)
const isError = computed(() => status.value === 'error')
const isRunning = computed(() => !isStale.value && (status.value === 'running' || status.value === 'pending'))
const isSuccess = computed(() => status.value === 'completed')
const disclosureStatus = computed(() => {
  if (isError.value) return 'error'
  if (isRunning.value) return 'running'
  return 'default'
})

// Helper to determine language for CodeBlock
const outputLang = computed(() => {
  const t = toolName.value.toLowerCase()
  if (t === 'read') {
    const rawPath = input.value.filePath ?? input.value.file_path
    const path = typeof rawPath === 'string' ? rawPath : ''
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
    if (path.endsWith('.rs')) return 'rust'
    if (path.endsWith('.py')) return 'python'
    if (path.endsWith('.json')) return 'json'
    if (path.endsWith('.md')) return 'markdown'
    if (path.endsWith('.vue')) return 'xml' // or html
    if (path.endsWith('.html')) return 'xml'
    if (path.endsWith('.css')) return 'css'
    return 'text'
  }
  if (t === 'bash') return 'bash'
  if (['edit', 'multiedit', 'apply_patch'].includes(t)) return 'diff'
  return 'text'
})

const diffText = computed(() => {
  const t = toolName.value.toLowerCase()
  if (!['edit', 'multiedit', 'apply_patch', 'str_replace', 'str_replace_based_edit_tool'].includes(t)) return ''
  const m = metadata.value
  const direct = typeof m.diff === 'string' ? m.diff.trim() : ''
  if (direct) return direct
  const files = Array.isArray(m.files) ? m.files : []
  const joined = files
    .map((f) => {
      const rec = asRecord(f)
      return typeof rec.diff === 'string' ? rec.diff.trim() : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return joined
})

const activityDiffPreview = computed(() => {
  const text = diffText.value
  if (!text) return null
  return buildUnifiedMonacoDiffModel(text)
})

const displayOutput = computed(() => {
  if (error.value) return toDisplayString(error.value)
  if (output.value == null) return ''

  // If output isn't a string, show JSON so we don't render an empty box.
  if (typeof output.value !== 'string') {
    return toDisplayString(output.value)
  }

  // Clean up output
  let clean = output.value
  // Remove <file> tags if present
  clean = clean.replace(/^<file>\s*\n?/, '').replace(/\n?<\/file>\s*$/, '')
  return clean.trim()
})

const displayInputData = computed(() => resolveToolInputDisplay(toolName.value, input.value))

const shouldShowInput = computed(() => {
  return Boolean(displayInputData.value.text)
})
</script>

<template>
  <div class="relative">
    <ActivityDisclosureButton
      :open="isOpen"
      :icon="icon"
      :label="displayName"
      :summary="summary"
      :status="disclosureStatus"
      @toggle="toggleOpen"
    >
      <template #right>
        <div class="shrink-0 flex items-center gap-1.5">
          <span v-if="timeLabel" class="text-[10px] text-muted-foreground/70 font-mono">{{ timeLabel }}</span>
          <span v-if="durationLabel" class="text-[10px] text-muted-foreground/70 font-mono">{{ durationLabel }}</span>
          <div v-if="isStale" class="text-muted-foreground/80">
            <RiStopCircleLine class="h-3.5 w-3.5" />
          </div>
          <div v-else-if="isError" class="text-[10px] font-semibold text-destructive">Failed</div>
          <div v-else-if="isSuccess && !isOpen" class="text-emerald-500/80">
            <RiCheckLine class="h-3.5 w-3.5" />
          </div>
        </div>
      </template>
    </ActivityDisclosureButton>

    <Transition name="toolreveal">
      <div v-show="isOpen" class="pl-6 pt-0.5 pb-1">
        <div class="space-y-2">
          <div v-if="detailLoading" class="text-[11px] text-muted-foreground/70 italic">Loading details...</div>

          <div v-if="shouldShowInput" class="text-xs">
            <div class="text-muted-foreground/80 mb-1 font-medium flex justify-between items-center">
              <span>Input</span>
              <span class="text-[10px] uppercase tracking-wider opacity-70">{{ displayInputData.lang }}</span>
            </div>
            <CodeBlock :code="displayInputData.text" :lang="displayInputData.lang" :compact="true" class="my-0" />
          </div>

          <div v-if="activityDiffPreview" class="text-xs">
            <div class="text-muted-foreground/80 mb-1 font-medium flex justify-between items-center">
              <span>Diff</span>
              <span class="text-[10px] uppercase tracking-wider opacity-70">diff</span>
            </div>
            <div class="oc-activity-detail overflow-hidden">
              <MonacoDiffEditor
                class="h-96"
                :path="activityDiffPreview.path"
                :original-path="`${activityDiffPreview.path}:base`"
                :original-value="activityDiffPreview.original"
                :modified-value="activityDiffPreview.modified"
                :read-only="true"
                :wrap="true"
              />
            </div>
          </div>

          <div v-if="displayOutput || error" class="text-xs">
            <div v-if="error" class="text-destructive mb-1 font-medium">Error</div>
            <div v-else class="text-muted-foreground/80 mb-1 font-medium flex justify-between items-center">
              <span>Output</span>
              <span class="text-[10px] uppercase tracking-wider opacity-70">{{ outputLang }}</span>
            </div>
            <CodeBlock v-if="displayOutput" :code="displayOutput" :lang="outputLang" :compact="true" class="my-0" />
          </div>

          <div
            v-else-if="!detailLoading && !isLazy && !shouldShowInput && !isRunning && isSuccess"
            class="text-[11px] text-muted-foreground/70 italic"
          >
            (Completed with no output)
          </div>

          <div v-else-if="isStale" class="text-[11px] text-muted-foreground/70 italic">(Stopped: session ended)</div>

          <div v-else-if="isRunning" class="text-[11px] text-muted-foreground/70 italic">Running...</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toolreveal-enter-active,
.toolreveal-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms ease;
}

.toolreveal-enter-from,
.toolreveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
