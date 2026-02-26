<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiClipboardLine,
  RiCloseLine,
  RiFileCopy2Line,
  RiHistoryLine,
  RiLoader4Line,
  RiMore2Line,
  RiSave3Line,
  RiTextWrap,
  RiUserLine,
} from '@remixicon/vue'

import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { buildUnifiedDiffModel } from '@/features/git/diff/unifiedDiff'
import { formatDateTimeYMDHM, formatDateYMDShort2DigitYear } from '@/i18n/intl'

import { isImagePath } from '../fileKinds'
import type { FileNode, MarkdownViewMode, SelectionRange, ViewerMode } from '../types'
import type { GitBlameLine, GitDiffMeta, GitLogCommit } from '@/types/git'

type GitDiffMode = 'working' | 'staged'
type GitPatchMode = 'stage' | 'unstage' | 'discard'
type TimelineSide = 'left' | 'right'

const showMobileViewer = defineModel<boolean>('showMobileViewer', { default: false })
const autoSaveEnabled = defineModel<boolean>('autoSaveEnabled', { default: false })
const wrapLines = defineModel<boolean>('wrapLines', { default: true })
const markdownViewMode = defineModel<MarkdownViewMode>('markdownViewMode', { default: 'source' })
const draftContent = defineModel<string>('draftContent', { default: '' })
const selection = defineModel<SelectionRange | null>('selection', { default: null })
const commentText = defineModel<string>('commentText', { default: '' })

const props = defineProps<{
  isMobile: boolean
  selectedFile: FileNode | null
  displaySelectedPath: string
  viewerMode: ViewerMode
  canEdit: boolean
  dirty: boolean
  isSaving: boolean
  displayedContent: string
  rawUrl: string
  selectedPath: string
  fileLoading: boolean
  fileError: string | null
  fileStatusLabel: string
  blameEnabled: boolean
  blameLoading: boolean
  blameError: string | null
  blameLines: GitBlameLine[]
  timelineEnabled: boolean
  timelinePath: string
  timelineLoading: boolean
  timelineError: string | null
  timelineCommits: GitLogCommit[]
  timelineHasMore: boolean
  timelineLeftCommit: GitLogCommit | null
  timelineLeftContent: string
  timelineLeftLoading: boolean
  timelineLeftError: string | null
  timelineRightCommit: GitLogCommit | null
  timelineRightContent: string
  timelineRightLoading: boolean
  timelineRightError: string | null
  gitInlineEnabled: boolean
  gitDiffLoading: boolean
  gitDiffError: string | null
  gitDiffText: string
  gitDiffMeta: GitDiffMeta | null
  gitDiffMode: GitDiffMode
  gitPatchBusy: boolean
  toggleBlame: () => boolean | void | Promise<boolean | void>
  reloadBlame: () => boolean | void | Promise<boolean | void>
  toggleGitInline: () => boolean | void | Promise<boolean | void>
  toggleGitDiffMode: () => boolean | void | Promise<boolean | void>
  applyGitPatch: (patch: string, mode: GitPatchMode) => boolean | void | Promise<boolean | void>
  loadMoreTimeline: () => boolean | void | Promise<boolean | void>
  selectTimelineCommit: (side: TimelineSide, commit: GitLogCommit) => boolean | void | Promise<boolean | void>
  openTimeline: () => boolean | void | Promise<boolean | void>
  openSidebar: () => boolean | void | Promise<boolean | void>
  openRaw: () => boolean | void | Promise<boolean | void>
  save: () => boolean | void | Promise<boolean | void>
  copyToClipboard: (text: string) => void | Promise<void>
}>()

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'insertSelection'): void
}>()

const editorRef = ref<InstanceType<typeof CodeMirrorEditor> | null>(null)
const viewMenuOpen = ref(false)
const viewMenuQuery = ref('')
const viewMenuAnchorEl = ref<HTMLElement | null>(null)

const isSelectedImage = computed(() => Boolean(props.selectedFile && isImagePath(props.selectedFile.path)))
const supportsSourceEditor = computed(
  () => props.viewerMode === 'text' || (props.viewerMode === 'markdown' && markdownViewMode.value !== 'preview'),
)
const showMarkdownPreview = computed(() => props.viewerMode === 'markdown' && markdownViewMode.value !== 'source')
const showMarkdownSource = computed(() => props.viewerMode === 'markdown' && markdownViewMode.value !== 'preview')
const showMarkdownSplit = computed(() => props.viewerMode === 'markdown' && markdownViewMode.value === 'split')
const canShowViewMenu = computed(() => props.viewerMode === 'text' || props.viewerMode === 'markdown')

const viewMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'view-options',
    title: t('files.viewer.viewMenu.groupTitle'),
    items: [
      {
        id: 'toggle-blame',
        label: props.blameEnabled ? t('files.viewer.viewMenu.blame.disable') : t('files.viewer.viewMenu.blame.enable'),
        description: t('files.viewer.viewMenu.blame.description'),
        checked: props.blameEnabled,
        icon: RiUserLine,
        disabled: props.viewerMode !== 'text' || !props.selectedFile,
      },
      {
        id: 'toggle-timeline',
        label: props.timelineEnabled
          ? t('files.viewer.viewMenu.timeline.disable')
          : t('files.viewer.viewMenu.timeline.enable'),
        description: t('files.viewer.viewMenu.timeline.description'),
        checked: props.timelineEnabled,
        icon: RiHistoryLine,
        disabled: props.viewerMode !== 'text' || !props.selectedFile,
      },
      {
        id: 'toggle-wrap',
        label: wrapLines.value ? t('files.viewer.viewMenu.wrap.disable') : t('files.viewer.viewMenu.wrap.enable'),
        description: t('files.viewer.viewMenu.wrap.description'),
        checked: wrapLines.value,
        icon: RiTextWrap,
        disabled: !supportsSourceEditor.value,
      },
      {
        id: 'toggle-autosave',
        label: autoSaveEnabled.value
          ? t('files.viewer.viewMenu.autosave.disable')
          : t('files.viewer.viewMenu.autosave.enable'),
        description: t('files.viewer.viewMenu.autosave.description'),
        checked: autoSaveEnabled.value,
        icon: RiSave3Line,
        disabled: !supportsSourceEditor.value || !props.canEdit,
      },
    ],
  },
])

const gitDiffModeLabel = computed(() =>
  props.gitDiffMode === 'staged' ? t('files.viewer.gitDiffMode.staged') : t('files.viewer.gitDiffMode.workingTree'),
)

const gitDiffRangeLabel = computed(() =>
  props.gitDiffMode === 'staged'
    ? t('files.viewer.gitDiffRange.headToIndex')
    : t('files.viewer.gitDiffRange.indexToWorkingTree'),
)

function runViewMenuAction(item: OptionMenuItem) {
  if (item.disabled) return
  if (item.id === 'toggle-blame') {
    void props.toggleBlame()
    return
  }
  if (item.id === 'toggle-timeline') {
    void props.openTimeline()
    return
  }
  if (item.id === 'toggle-wrap') {
    wrapLines.value = !wrapLines.value
    return
  }
  if (item.id === 'toggle-autosave') {
    autoSaveEnabled.value = !autoSaveEnabled.value
  }
}

const NOT_COMMITTED_HASH = '0000000000000000000000000000000000000000'

function shortHash(hash: string): string {
  return String(hash || '').slice(0, 7)
}

function formatTimelineDate(value: string): string {
  if (!value) return ''
  return formatDateTimeYMDHM(value)
}

function timelineCommitLabel(commit: GitLogCommit | null): string {
  if (!commit) return String(t('files.viewer.timeline.selectCommitShort'))
  const hash = shortHash(commit.hash)
  const subject = (commit.subject || '').trim() || String(t('files.viewer.timeline.noMessage'))
  return `${hash} · ${subject}`
}

function timelineCommitMeta(commit: GitLogCommit | null): string {
  if (!commit) return String(t('files.viewer.timeline.searchPlaceholder'))
  const author = (commit.authorName || '').trim() || String(t('common.unknown'))
  const date = formatTimelineDate(commit.authorDate)
  return date ? `${author} · ${date}` : author
}

function timelineCommitKeywords(commit: GitLogCommit): string {
  const refs = Array.isArray(commit.refs) ? commit.refs.join(' ') : ''
  const parents = Array.isArray(commit.parents) ? commit.parents.join(' ') : ''
  return [
    commit.hash || '',
    commit.shortHash || '',
    commit.subject || '',
    commit.body || '',
    commit.authorName || '',
    commit.authorEmail || '',
    commit.authorDate || '',
    refs,
    parents,
  ]
    .join(' ')
    .trim()
}

const timelineLeftMenuOpen = ref(false)
const timelineLeftMenuQuery = ref('')
const timelineLeftMenuAnchorEl = ref<HTMLElement | null>(null)
const timelineRightMenuOpen = ref(false)
const timelineRightMenuQuery = ref('')
const timelineRightMenuAnchorEl = ref<HTMLElement | null>(null)

const timelineCommitByHash = computed(() => {
  const map = new Map<string, GitLogCommit>()
  for (const commit of props.timelineCommits) {
    const hash = String(commit?.hash || '').trim()
    if (!hash || map.has(hash)) continue
    map.set(hash, commit)
  }
  return map
})

const timelineLeftModelPath = computed(() => {
  const filePath = (props.timelinePath || props.selectedPath || '').trim() || 'timeline-file'
  return `timeline-left:${filePath}`
})

const timelineRightModelPath = computed(() => {
  const filePath = (props.timelinePath || props.selectedPath || '').trim() || 'timeline-file'
  return `timeline-right:${filePath}`
})

const timelineAnyLoading = computed(
  () => props.timelineLoading || props.timelineLeftLoading || props.timelineRightLoading,
)

const timelineErrorText = computed(() => {
  const messages = [props.timelineError, props.timelineLeftError, props.timelineRightError]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  if (!messages.length) return ''
  return Array.from(new Set(messages)).join(' | ')
})

const hasTimelineStatus = computed(
  () => props.timelineEnabled && (timelineAnyLoading.value || Boolean(timelineErrorText.value)),
)

const statusStripVisible = computed(() => {
  if (props.viewerMode !== 'text') return false
  if (hasTimelineStatus.value) return true
  if (props.gitInlineEnabled) return true
  if (
    props.blameEnabled &&
    (props.blameLoading || Boolean(props.blameError) || props.dirty || !blameCommitBlocks.value.length)
  ) {
    return true
  }
  return false
})

function optionItemHaystack(item: OptionMenuItem): string {
  return `${item.label || ''} ${item.description || ''} ${item.keywords || ''}`.toLowerCase()
}

function buildTimelineMenuGroups(side: TimelineSide, queryRaw: string): OptionMenuGroup[] {
  const query = String(queryRaw || '')
    .trim()
    .toLowerCase()
  const selectedHash = (side === 'left' ? props.timelineLeftCommit?.hash : props.timelineRightCommit?.hash) || ''

  const commitItems = props.timelineCommits
    .map<OptionMenuItem>((commit) => {
      const hash = String(commit?.hash || '').trim()
      return {
        id: `timeline-commit:${hash}`,
        label: timelineCommitLabel(commit),
        description: timelineCommitMeta(commit),
        checked: hash === selectedHash,
        keywords: timelineCommitKeywords(commit),
      }
    })
    .filter((item) => (!query ? true : optionItemHaystack(item).includes(query)))

  const groups: OptionMenuGroup[] = [
    {
      id: `timeline-${side}-commits`,
      title: 'Commits',
      subtitle: `${commitItems.length}/${props.timelineCommits.length} loaded`,
      items: commitItems,
    },
  ]

  if (props.timelineHasMore || props.timelineLoading) {
    groups.push({
      id: `timeline-${side}-load-more`,
      items: [
        {
          id: 'timeline-load-more',
          label: props.timelineLoading ? 'Loading more commits...' : 'Load more commits',
          description: props.timelineHasMore ? 'Fetch older history for broader search' : 'No more commits',
          keywords: 'older history more commits',
          disabled: props.timelineLoading || !props.timelineHasMore,
        },
      ],
    })
  }

  return groups
}

const timelineLeftMenuGroups = computed(() => buildTimelineMenuGroups('left', timelineLeftMenuQuery.value))
const timelineRightMenuGroups = computed(() => buildTimelineMenuGroups('right', timelineRightMenuQuery.value))

const timelineLeftButtonLabel = computed(() => timelineCommitLabel(props.timelineLeftCommit))
const timelineRightButtonLabel = computed(() => timelineCommitLabel(props.timelineRightCommit))

function setTimelineMenuOpen(side: TimelineSide, value: boolean) {
  if (side === 'left') {
    timelineLeftMenuOpen.value = value
    if (value) timelineRightMenuOpen.value = false
    return
  }

  timelineRightMenuOpen.value = value
  if (value) timelineLeftMenuOpen.value = false
}

function setTimelineMenuQuery(side: TimelineSide, value: string) {
  if (side === 'left') {
    timelineLeftMenuQuery.value = value
    return
  }

  timelineRightMenuQuery.value = value
}

function handleTimelineMenuSelect(side: TimelineSide, item: OptionMenuItem) {
  const id = String(item?.id || '').trim()
  if (!id) return

  if (id === 'timeline-load-more') {
    void props.loadMoreTimeline()
    return
  }

  if (!id.startsWith('timeline-commit:')) return
  const hash = id.slice('timeline-commit:'.length).trim()
  if (!hash) return

  const commit = timelineCommitByHash.value.get(hash)
  if (!commit) return

  void props.selectTimelineCommit(side, commit)
  setTimelineMenuOpen(side, false)
}

type BlameColorRegistry = {
  styleEl: HTMLStyleElement | null
  classNames: Set<string>
}

type BlameColorGlobalState = typeof globalThis & {
  __ocBlameColorRegistry__?: BlameColorRegistry
}

function getBlameColorRegistry(): BlameColorRegistry {
  const globalScope = globalThis as BlameColorGlobalState
  if (!globalScope.__ocBlameColorRegistry__) {
    globalScope.__ocBlameColorRegistry__ = {
      styleEl: null,
      classNames: new Set<string>(),
    }
  }
  return globalScope.__ocBlameColorRegistry__
}

function normalizeBlameHash(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function radicalInverseBase2(value: number): number {
  let n = Math.max(0, Math.floor(value))
  let result = 0
  let factor = 0.5
  while (n > 0) {
    result += (n & 1) * factor
    n >>>= 1
    factor *= 0.5
  }
  return result
}

const BLAME_TONE_SEQUENCE = [
  { lightness: 0.69, chroma: 0.13 },
  { lightness: 0.63, chroma: 0.14 },
  { lightness: 0.75, chroma: 0.11 },
  { lightness: 0.58, chroma: 0.12 },
]

const DEFAULT_BLAME_TONE = { lightness: 0.69, chroma: 0.13 }

function blameAccentBySlot(slot: number): string {
  const safeSlot = Math.max(0, Math.floor(slot))
  const toneBandSize = 24
  const toneBand = Math.floor(safeSlot / toneBandSize)
  const tone = BLAME_TONE_SEQUENCE[toneBand % BLAME_TONE_SEQUENCE.length] ?? DEFAULT_BLAME_TONE
  const hue = Math.round((radicalInverseBase2(safeSlot + 1) * 360 + toneBand * 13) % 360)
  return `${tone.lightness.toFixed(3)} ${tone.chroma.toFixed(3)} ${hue}`
}

function ensureBlameColorStyleElement(registry: BlameColorRegistry): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (registry.styleEl && registry.styleEl.isConnected) return registry.styleEl

  let styleEl = document.getElementById('oc-blame-commit-colors') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'oc-blame-commit-colors'
    document.head.appendChild(styleEl)
  }

  registry.styleEl = styleEl
  return styleEl
}

function ensureBlameCommitColorClass(slot: number): string {
  const safeSlot = Math.max(0, Math.floor(slot))
  const className = `oc-blame-commit-color-s-${safeSlot}`
  const registry = getBlameColorRegistry()
  if (registry.classNames.has(className)) return className

  const styleEl = ensureBlameColorStyleElement(registry)
  if (styleEl) {
    const accent = blameAccentBySlot(safeSlot)
    styleEl.appendChild(document.createTextNode(`.${className}{--oc-blame-accent:${accent};}`))
    registry.classNames.add(className)
  }

  return className
}

function isNotCommittedLine(line: GitBlameLine): boolean {
  return (line.hash || '') === NOT_COMMITTED_HASH || (line.author || '').trim().toLowerCase() === 'not committed yet'
}

function blameKey(line: GitBlameLine): string {
  return [line.hash || '', line.author || '', line.authorTime || 0, (line.summary || '').trim()].join('::')
}

function formatBlameDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return String(t('common.unknown'))
  return formatDateTimeYMDHM(unixSeconds * 1000) || String(t('common.unknown'))
}

function clampBlameLabel(text: string, max = 72): string {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, Math.max(0, max - 3))}...`
}

function formatBlameDateShort(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return ''
  return formatDateYMDShort2DigitYear(unixSeconds * 1000)
}

type BlameCommitBlock = {
  id: string
  startLine: number
  endLine: number
  hash: string
  author: string
  authorEmail: string
  authorTime: number
  summary: string
  pending: boolean
}

function blockId(block: Omit<BlameCommitBlock, 'id'>): string {
  return [block.hash, block.author, block.authorTime, block.summary, block.startLine, block.endLine].join('::')
}

const blameCommitBlocks = computed<BlameCommitBlock[]>(() => {
  if (!props.blameEnabled || !props.blameLines.length) return []

  const maxLine = Math.max(1, countLines(draftContent.value))
  const orderedLines = props.blameLines.slice().sort((a, b) => a.line - b.line)

  const blocks: BlameCommitBlock[] = []
  let current: Omit<BlameCommitBlock, 'id'> | null = null
  let previousKey = ''
  let previousLine = 0

  for (const line of orderedLines) {
    const lineNumber = Math.max(1, Math.floor(line.line || 0))
    if (lineNumber > maxLine) continue

    const key = blameKey(line)
    if (!current || key !== previousKey || lineNumber !== previousLine + 1) {
      if (current) blocks.push({ id: blockId(current), ...current })
      current = {
        startLine: lineNumber,
        endLine: lineNumber,
        hash: (line.hash || '').trim(),
        author: (line.author || '').trim(),
        authorEmail: (line.authorEmail || '').trim(),
        authorTime: Number(line.authorTime || 0),
        summary: (line.summary || '').trim(),
        pending: isNotCommittedLine(line),
      }
    } else {
      current.endLine = lineNumber
    }

    previousKey = key
    previousLine = lineNumber
  }

  if (current) blocks.push({ id: blockId(current), ...current })
  return blocks
})

const editorVisibleStartLine = ref(1)
const editorVisibleEndLine = ref(1)

function onEditorScroll(payload: { visibleStartLine: number; visibleEndLine: number }) {
  editorVisibleStartLine.value = payload.visibleStartLine
  editorVisibleEndLine.value = payload.visibleEndLine
}

function copyCommitHash(hash: string) {
  const cleaned = String(hash || '').trim()
  if (!cleaned || cleaned === NOT_COMMITTED_HASH) return
  void props.copyToClipboard(cleaned)
}

function formatBlameBlockHover(block: BlameCommitBlock): string {
  const author = (block.author || '').trim() || 'Unknown'
  const summary = (block.summary || '').trim() || (block.pending ? 'Uncommitted changes' : 'No commit summary')
  const email = (block.authorEmail || '').trim()
  const hash = (block.hash || '').trim()

  return [
    `Summary: ${summary}`,
    `Author: ${author}${email ? ` <${email}>` : ''}`,
    block.authorTime ? `Date: ${formatBlameDate(block.authorTime)}` : 'Date: Unknown date',
    !block.pending && hash ? `Commit: ${hash}` : 'Commit: (worktree)',
    `Lines: ${block.startLine}-${block.endLine} (${block.endLine - block.startLine + 1})`,
    block.pending ? 'Status: Uncommitted changes' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

type EditorLineMarker = {
  line: number
  className?: string
  gutterClassName?: string
  glyphClassName?: string
  hover?: string
}

const blameBlockLineMarkers = computed<EditorLineMarker[]>(() => {
  if (!props.blameEnabled || !blameCommitBlocks.value.length) return []

  const colorSlotByHash = new Map<string, number>()
  for (const block of blameCommitBlocks.value) {
    if (block.pending) continue
    const hashKey = normalizeBlameHash(block.hash)
    if (!hashKey || colorSlotByHash.has(hashKey)) continue
    colorSlotByHash.set(hashKey, colorSlotByHash.size)
  }

  const overscanLines = 80
  const startLine = Math.max(1, editorVisibleStartLine.value - overscanLines)
  const endLine = Math.min(editorLineCount.value, editorVisibleEndLine.value + overscanLines)
  if (endLine < startLine) return []

  const markers: EditorLineMarker[] = []
  const maxMarkers = 1600

  for (const block of blameCommitBlocks.value) {
    if (block.endLine < startLine) continue
    if (block.startLine > endLine) break

    const from = Math.max(startLine, block.startLine)
    const to = Math.min(endLine, block.endLine)

    const hashKey = normalizeBlameHash(block.hash)
    const colorSlot = hashKey ? (colorSlotByHash.get(hashKey) ?? 0) : 0
    const colorClass = block.pending ? 'oc-blame-commit-color--pending' : ensureBlameCommitColorClass(colorSlot)
    const hover = formatBlameBlockHover(block)

    for (let line = from; line <= to; line += 1) {
      if (markers.length >= maxMarkers) return markers

      const isStart = line === block.startLine
      const isEnd = line === block.endLine
      const position = isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'mid'

      markers.push({
        line,
        gutterClassName: `oc-blame-block-marker oc-blame-block-marker--${position} ${colorClass}`,
        hover,
      })
    }
  }

  return markers
})

type GitHunkView = {
  id: string
  range: string
  additions: number
  deletions: number
  patch: string
  anchorLine: number
}

type GitLineDecoration = {
  line: number
  type: 'add' | 'del' | 'mod'
  hover?: string
}

function countLines(text: string): number {
  if (!text) return 1
  return text.split('\n').length
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(1, Math.min(lineCount, Math.floor(line || 1)))
}

const parsedGitDiff = computed(() => buildUnifiedDiffModel(props.gitDiffText, props.gitDiffMeta))
const editorLineCount = computed(() => countLines(draftContent.value))

const gitHunks = computed<GitHunkView[]>(() => {
  if (!props.gitInlineEnabled) return []
  const lineCount = Math.max(1, editorLineCount.value)
  return parsedGitDiff.value.hunks.map((hunk) => {
    return {
      id: hunk.id,
      range: hunk.range,
      additions: hunk.additions,
      deletions: hunk.deletions,
      patch: hunk.patch,
      anchorLine: clampLine(hunk.anchorLine || 1, lineCount),
    }
  })
})

const gitDiffZones = computed(() => {
  if (!props.gitInlineEnabled) return []
  const zones: Array<{ line: number; content: string[] }> = []

  for (const hunk of parsedGitDiff.value.hunks) {
    let currentLine = hunk.newStart || 1
    let pendingDeletes: string[] = []

    const flush = () => {
      if (pendingDeletes.length > 0) {
        zones.push({
          line: Math.max(0, currentLine - 1),
          content: [...pendingDeletes],
        })
        pendingDeletes = []
      }
    }

    for (const line of hunk.lines) {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@') || line.startsWith('\\')) continue

      if (line.startsWith('-')) {
        pendingDeletes.push(line)
      } else if (line.startsWith('+')) {
        flush()
        currentLine += 1
      } else if (line.startsWith(' ')) {
        flush()
        currentLine += 1
      }
    }
    flush()
  }
  return zones
})

const gitInlineHints = computed(() => {
  if (!props.gitInlineEnabled) return []
  return gitHunks.value.slice(0, 320).map((hunk) => ({
    line: hunk.anchorLine,
    text: `${hunk.range} +${hunk.additions} -${hunk.deletions}`,
    className: 'oc-inline-git-hunk',
  }))
})

const mergedInlineDecorations = computed(() => [...gitInlineHints.value])
const inlineDecorationsEnabled = computed(() => props.gitInlineEnabled)

function mergeLineDecorationType(current: GitLineDecoration['type'], next: GitLineDecoration['type']) {
  const score: Record<GitLineDecoration['type'], number> = { add: 1, del: 2, mod: 3 }
  return score[next] > score[current] ? next : current
}

const gitLineDecorations = computed<GitLineDecoration[]>(() => {
  if (!props.gitInlineEnabled || !parsedGitDiff.value.hunks.length) return []

  const modeLabel = props.gitDiffMode === 'staged' ? 'Staged diff' : 'Working tree diff'
  const lineCount = Math.max(1, editorLineCount.value)
  const byLine = new Map<number, { type: GitLineDecoration['type']; notes: Set<string> }>()

  function setLine(line: number, type: GitLineDecoration['type'], note: string) {
    const key = clampLine(line, lineCount)
    const existing = byLine.get(key)
    if (existing) {
      existing.type = mergeLineDecorationType(existing.type, type)
      if (note) existing.notes.add(note)
      return
    }
    byLine.set(key, { type, notes: new Set(note ? [note] : []) })
  }

  for (const hunk of parsedGitDiff.value.hunks) {
    const range = hunk.range
    let index = 0
    let newLine = Math.max(1, hunk.newStart || 1)

    while (index < hunk.lines.length) {
      const raw = hunk.lines[index] || ''

      if (raw.startsWith(' ')) {
        newLine += 1
        index += 1
        continue
      }

      if (raw.startsWith('\\')) {
        index += 1
        continue
      }

      if (raw.startsWith('-') && !raw.startsWith('---')) {
        const deleted: string[] = []
        while (index < hunk.lines.length) {
          const line = hunk.lines[index] || ''
          if (!line.startsWith('-') || line.startsWith('---')) break
          deleted.push(line.slice(1))
          index += 1
        }

        const addedStart = newLine
        const added: string[] = []
        while (index < hunk.lines.length) {
          const line = hunk.lines[index] || ''
          if (!line.startsWith('+') || line.startsWith('+++')) break
          added.push(line.slice(1))
          newLine += 1
          index += 1
        }

        const deletedPreview = deleted
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(' | ')

        if (added.length > 0) {
          const detail = `${modeLabel} ${range}: modified (${deleted.length} -> ${added.length})`
          for (let i = 0; i < added.length; i += 1) {
            setLine(addedStart + i, 'mod', detail)
          }
          if (deleted.length > added.length) {
            const extra = deleted.length - added.length
            const detailWithPreview = deletedPreview
              ? `${modeLabel} ${range}: deleted ${extra} extra line(s) (${deletedPreview})`
              : `${modeLabel} ${range}: deleted ${extra} extra line(s)`
            setLine(addedStart, 'del', detailWithPreview)
          }
        } else {
          const detailWithPreview = deletedPreview
            ? `${modeLabel} ${range}: deleted ${deleted.length} line(s) (${deletedPreview})`
            : `${modeLabel} ${range}: deleted ${deleted.length} line(s)`
          setLine(addedStart, 'del', detailWithPreview)
        }

        continue
      }

      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        const addedStart = newLine
        let addedCount = 0
        while (index < hunk.lines.length) {
          const line = hunk.lines[index] || ''
          if (!line.startsWith('+') || line.startsWith('+++')) break
          addedCount += 1
          newLine += 1
          index += 1
        }
        for (let i = 0; i < addedCount; i += 1) {
          setLine(addedStart + i, 'add', `${modeLabel} ${range}: added line`)
        }
        continue
      }

      index += 1
    }
  }

  return Array.from(byLine.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([line, info]) => ({
      line,
      type: info.type,
      hover: Array.from(info.notes).join('\n'),
    }))
})

async function applyHunkPatch(patch: string, mode: GitPatchMode) {
  if (!patch || props.gitPatchBusy) return
  await props.applyGitPatch(patch, mode)
}

const noop = () => {}

const codeLensActions = computed(() => {
  if (!props.selectedFile || props.viewerMode !== 'text') return []
  const actions: Array<{ line: number; title: string; onClick: () => void }> = []

  if (props.blameEnabled && blameCommitBlocks.value.length) {
    const seen = new Set<string>()
    const blocks = blameCommitBlocks.value.slice(0, 4000)
    for (const block of blocks) {
      const commitKey = block.pending ? 'WORKTREE' : (block.hash || '').trim()
      if (!commitKey) continue
      if (seen.has(commitKey)) continue
      seen.add(commitKey)

      const author = (block.author || '').trim() || 'Unknown'
      const dateLabel = formatBlameDateShort(block.authorTime)
      const summaryRaw = (block.summary || '').trim() || (block.pending ? 'Uncommitted changes' : '(no message)')
      const summary = clampBlameLabel(summaryRaw, 84) || summaryRaw

      const title = block.pending
        ? `WORKTREE · ${summary}`
        : `${shortHash(block.hash)} · ${summary} · ${author}${dateLabel ? ` · ${dateLabel}` : ''}`

      actions.push({
        line: block.startLine,
        title,
        onClick: block.pending ? noop : () => copyCommitHash(block.hash),
      })
    }
  }

  if (!props.gitInlineEnabled) return actions

  actions.push({
    line: 1,
    title: props.gitDiffMode === 'staged' ? 'Switch to working tree diff' : 'Switch to staged diff',
    onClick: () => {
      void props.toggleGitDiffMode()
    },
  })

  if (props.gitDiffLoading || props.gitDiffError || props.gitPatchBusy || props.dirty) {
    actions.push({
      line: 1,
      title: props.dirty ? 'Save file to enable hunk actions' : 'Git hunk actions unavailable',
      onClick: noop,
    })
    return actions
  }

  const hunks = gitHunks.value.filter((hunk) => Boolean(hunk.patch)).slice(0, 240)
  for (const hunk of hunks) {
    if (props.gitDiffMode === 'staged') {
      actions.push({
        line: hunk.anchorLine,
        title: `Unstage ${hunk.range} (+${hunk.additions}/-${hunk.deletions})`,
        onClick: () => {
          void applyHunkPatch(hunk.patch, 'unstage')
        },
      })
      continue
    }

    actions.push({
      line: hunk.anchorLine,
      title: `Stage ${hunk.range} (+${hunk.additions}/-${hunk.deletions})`,
      onClick: () => {
        void applyHunkPatch(hunk.patch, 'stage')
      },
    })

    actions.push({
      line: hunk.anchorLine,
      title: `Discard ${hunk.range}`,
      onClick: () => {
        void applyHunkPatch(hunk.patch, 'discard')
      },
    })
  }

  return actions
})

function updateSelectionFromEditor() {
  if (!supportsSourceEditor.value) return
  const sel = editorRef.value?.getSelection?.()
  if (!sel || !sel.text || !sel.text.trim()) {
    selection.value = null
    commentText.value = ''
    return
  }
  selection.value = { start: sel.fromLine, end: sel.toLine, text: sel.text }
}

function clearSelection() {
  selection.value = null
  commentText.value = ''
}

function onSendSelection() {
  emit('insertSelection')
}
</script>

<template>
  <section class="flex min-h-0 h-full flex-col overflow-hidden bg-background">
    <div class="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
      <IconButton
        v-if="isMobile && showMobileViewer"
        size="lg"
        :tooltip="t('nav.back')"
        :is-mobile-pointer="isMobile"
        :aria-label="t('nav.back')"
        @click="showMobileViewer = false"
      >
        <RiArrowLeftSLine class="h-5 w-5" />
      </IconButton>

      <div class="min-w-0 flex-1">
        <div class="typography-ui-label font-semibold truncate">
          {{ selectedFile?.name || t('files.viewer.title.selectFile') }}
        </div>
      </div>

      <div v-if="viewerMode === 'markdown'" class="shrink-0">
        <SegmentedControl class="grid-cols-3 max-w-xs">
          <SegmentedButton :active="markdownViewMode === 'source'" size="xs" @click="markdownViewMode = 'source'">
            {{ t('files.viewer.markdown.mode.source') }}
          </SegmentedButton>
          <SegmentedButton :active="markdownViewMode === 'preview'" size="xs" @click="markdownViewMode = 'preview'">
            {{ t('files.viewer.markdown.mode.preview') }}
          </SegmentedButton>
          <SegmentedButton :active="markdownViewMode === 'split'" size="xs" @click="markdownViewMode = 'split'">
            {{ t('files.viewer.markdown.mode.split') }}
          </SegmentedButton>
        </SegmentedControl>
      </div>

      <OptionMenu
        :open="viewMenuOpen"
        :query="viewMenuQuery"
        :groups="viewMenuGroups"
        :title="t('files.viewer.viewMenu.title')"
        :mobile-title="t('files.viewer.viewMenu.title')"
        :searchable="true"
        :is-mobile-pointer="isMobile"
        desktop-placement="bottom-end"
        :desktop-fixed="true"
        :desktop-anchor-el="viewMenuAnchorEl"
        filter-mode="internal"
        @update:open="
          (v) => {
            viewMenuOpen = v
            if (!v) viewMenuQuery = ''
          }
        "
        @update:query="(v) => (viewMenuQuery = v)"
        @select="runViewMenuAction"
      />

      <div class="flex items-center gap-1">
        <IconButton
          v-if="supportsSourceEditor && canEdit && !autoSaveEnabled"
          variant="ghost"
          size="sm"
          class="h-7 w-7"
          :tooltip="dirty ? t('files.viewer.save.titleDirty') : t('files.viewer.save.titleSaved')"
          :is-mobile-pointer="isMobile"
          :disabled="!dirty || isSaving"
          :title="dirty ? t('files.viewer.save.titleDirty') : t('files.viewer.save.titleSaved')"
          @click="() => save()"
        >
          <RiLoader4Line v-if="isSaving" class="h-4 w-4 animate-spin" />
          <RiSave3Line v-else class="h-4 w-4" />
        </IconButton>

        <IconButton
          v-if="supportsSourceEditor && displayedContent"
          variant="ghost"
          size="sm"
          class="h-7 w-7"
          :tooltip="t('files.viewer.actions.copyContents')"
          :is-mobile-pointer="isMobile"
          :title="t('files.viewer.actions.copyContents')"
          @click="copyToClipboard(displayedContent)"
        >
          <RiClipboardLine class="h-4 w-4" />
        </IconButton>

        <div v-if="canShowViewMenu" ref="viewMenuAnchorEl" class="relative">
          <IconButton
            variant="ghost"
            size="sm"
            class="h-7 w-7"
            :class="viewMenuOpen ? 'bg-secondary/60 text-foreground' : ''"
            :tooltip="t('files.viewer.viewMenu.title')"
            :is-mobile-pointer="isMobile"
            :title="t('files.viewer.viewMenu.title')"
            :aria-label="t('files.viewer.viewMenu.title')"
            @mousedown.prevent
            @click.stop="
              () => {
                viewMenuQuery = ''
                viewMenuOpen = !viewMenuOpen
              }
            "
          >
            <RiMore2Line class="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>

    <div
      v-if="statusStripVisible"
      class="flex flex-wrap items-center gap-3 border-b border-border/40 px-3 py-1 text-[11px] text-muted-foreground"
    >
      <span v-if="timelineEnabled && timelineAnyLoading" class="inline-flex items-center gap-1">
        <RiLoader4Line class="h-3 w-3 animate-spin" />
        {{ t('files.viewer.status.loadingTimelineCommits') }}
      </span>
      <span v-else-if="timelineEnabled && timelineErrorText" class="text-destructive">
        {{ timelineErrorText }}
      </span>

      <span v-if="blameEnabled && blameLoading" class="inline-flex items-center gap-1">
        <RiLoader4Line class="h-3 w-3 animate-spin" />
        {{ t('files.viewer.status.loadingBlame') }}
      </span>
      <span v-else-if="blameEnabled && blameError" class="text-destructive">{{ blameError }}</span>
      <span v-else-if="blameEnabled && !blameCommitBlocks.length" class="text-muted-foreground/90">
        {{ t('files.viewer.status.noBlameYet') }}
      </span>

      <span v-if="blameEnabled && dirty" class="text-muted-foreground/90">{{
        t('files.viewer.status.showingBlameLastSaved')
      }}</span>

      <span v-if="gitInlineEnabled && gitDiffLoading" class="inline-flex items-center gap-1">
        <RiLoader4Line class="h-3 w-3 animate-spin" />
        {{ t('files.viewer.status.loadingChanges', { scope: gitDiffModeLabel }) }}
      </span>
      <span v-else-if="gitInlineEnabled && gitDiffError" class="text-destructive">{{ gitDiffError }}</span>
      <span v-else-if="gitInlineEnabled && !gitHunks.length">
        {{ t('files.viewer.status.noChanges', { scope: gitDiffModeLabel }) }}
      </span>
      <span v-else-if="gitInlineEnabled">
        {{ t('files.viewer.status.hunksSummary', { count: gitHunks.length, range: gitDiffRangeLabel }) }}
      </span>
    </div>

    <div class="flex-1 min-h-0 relative">
      <template v-if="!selectedFile">
        <MobileSidebarEmptyState
          v-if="isMobile"
          :title="t('files.viewer.title.selectFile')"
          :description="t('files.viewer.empty.mobileDescription')"
          :action-label="t('header.openFilesPanel')"
          :show-action="true"
          @action="props.openSidebar"
        />
        <div v-else class="h-full grid place-items-center text-muted-foreground typography-meta">
          {{ t('files.viewer.empty.desktopDescription') }}
        </div>
      </template>

      <div v-else-if="fileLoading" class="p-3 flex items-center gap-2 text-muted-foreground typography-meta">
        <RiLoader4Line class="h-4 w-4 animate-spin" />
        {{ t('common.loading') }}
      </div>

      <div v-else-if="viewerMode === 'binary'" class="p-3">
        <div class="rounded-md border border-border bg-background/40 px-3 py-2 text-muted-foreground typography-meta">
          {{ t('files.viewer.binaryPreviewUnavailable') }}
          <div v-if="fileError" class="mt-2 text-destructive">{{ fileError }}</div>
          <div class="mt-2">
            <Button variant="outline" size="sm" class="font-mono text-xs" @click="props.openRaw">{{
              t('files.viewer.actions.downloadRaw')
            }}</Button>
          </div>
        </div>
      </div>

      <div v-else-if="viewerMode === 'pdf'" class="flex h-full flex-col p-2">
        <div v-if="!rawUrl" class="p-3 text-muted-foreground typography-meta">
          {{ t('files.viewer.status.loadingPdf') }}
        </div>
        <iframe
          v-else
          :src="rawUrl"
          class="h-full w-full rounded-md border border-border/40 bg-background"
          :title="selectedFile?.name || 'PDF preview'"
        />
      </div>

      <div v-else-if="viewerMode === 'audio'" class="grid h-full place-items-center p-4">
        <div class="w-full max-w-2xl rounded-md border border-border/40 bg-muted/10 p-4">
          <div class="mb-2 text-xs text-muted-foreground">{{ selectedFile?.name }}</div>
          <audio v-if="rawUrl" :src="rawUrl" controls class="w-full" />
          <div v-else class="text-sm text-muted-foreground">{{ t('files.viewer.status.loadingAudio') }}</div>
        </div>
      </div>

      <div v-else-if="viewerMode === 'video'" class="grid h-full place-items-center p-3">
        <div class="w-full max-w-5xl rounded-md border border-border/40 bg-background/70 p-2">
          <video v-if="rawUrl" :src="rawUrl" controls class="max-h-[72vh] w-full rounded" />
          <div v-else class="p-3 text-sm text-muted-foreground">{{ t('files.viewer.status.loadingVideo') }}</div>
        </div>
      </div>

      <div v-else-if="viewerMode === 'image' || isSelectedImage" class="flex h-full items-center justify-center p-3">
        <div v-if="!rawUrl" class="text-muted-foreground typography-meta">
          {{ t('files.viewer.status.loadingImage') }}
        </div>
        <img
          v-else
          :src="rawUrl"
          :alt="selectedFile?.name || t('files.viewer.imageAltFallback')"
          class="max-w-full max-h-[70vh] object-contain rounded-md border border-border/30 bg-primary/10"
        />
      </div>

      <div
        v-else-if="viewerMode === 'markdown'"
        class="h-full flex min-h-0"
        :class="showMarkdownSplit && isMobile ? 'flex-col' : ''"
      >
        <div
          v-if="showMarkdownSource"
          class="min-h-0 min-w-0"
          :class="
            showMarkdownSplit
              ? isMobile
                ? 'flex-1 border-b border-border/30'
                : 'flex-1 border-r border-border/30'
              : 'flex-1'
          "
          @mouseup="updateSelectionFromEditor"
          @keyup="updateSelectionFromEditor"
        >
          <CodeMirrorEditor
            ref="editorRef"
            v-model="draftContent"
            :path="selectedPath"
            :use-files-theme="true"
            :wrap="wrapLines"
            :read-only="!canEdit"
            @editor-scroll="onEditorScroll"
          />
        </div>

        <div
          v-if="showMarkdownPreview"
          class="min-h-0 min-w-0 overflow-auto"
          :class="showMarkdownSplit ? 'flex-1' : 'flex-1'"
        >
          <div class="mx-auto w-full max-w-4xl p-4">
            <MarkdownRenderer :content="draftContent" mode="markdown" />
          </div>
        </div>
      </div>

      <div v-else class="h-full flex min-h-0">
        <template v-if="timelineEnabled">
          <div class="flex-1 min-w-0 relative flex flex-col">
            <div
              class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/40 bg-muted/10 px-2 py-2"
            >
              <button
                ref="timelineLeftMenuAnchorEl"
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-left text-[11px] hover:bg-muted/30"
                @click="setTimelineMenuOpen('left', !timelineLeftMenuOpen)"
              >
                <span class="truncate">{{ timelineLeftButtonLabel }}</span>
                <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>

              <div class="text-xs text-muted-foreground">-></div>

              <button
                ref="timelineRightMenuAnchorEl"
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-left text-[11px] hover:bg-muted/30"
                @click="setTimelineMenuOpen('right', !timelineRightMenuOpen)"
              >
                <span class="truncate">{{ timelineRightButtonLabel }}</span>
                <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </div>

            <div class="flex-1 min-h-0 relative">
              <MonacoDiffEditor
                :original-value="timelineLeftContent"
                :modified-value="timelineRightContent"
                :path="timelineRightModelPath"
                :original-path="timelineLeftModelPath"
                :use-files-theme="true"
                :wrap="wrapLines"
                :read-only="true"
              />

              <div
                v-if="(!timelineLeftCommit || !timelineRightCommit) && !timelineLoading"
                class="absolute inset-0 grid place-items-center text-xs text-muted-foreground pointer-events-none"
              >
                {{ t('files.viewer.timeline.selectBothCommitsHint') }}
              </div>
            </div>

            <OptionMenu
              :open="timelineLeftMenuOpen"
              :query="timelineLeftMenuQuery"
              :groups="timelineLeftMenuGroups"
              :title="t('files.viewer.timeline.selectCommitTitle')"
              :mobile-title="t('files.viewer.timeline.selectCommitTitle')"
              :search-placeholder="t('files.viewer.timeline.searchPlaceholder')"
              :empty-text="t('files.viewer.timeline.emptyText')"
              :is-mobile-pointer="isMobile"
              desktop-placement="bottom-start"
              :desktop-fixed="true"
              :desktop-anchor-el="timelineLeftMenuAnchorEl"
              filter-mode="external"
              :close-on-select="false"
              :paginated="true"
              :page-size="10"
              pagination-mode="item"
              @update:open="(v) => setTimelineMenuOpen('left', v)"
              @update:query="(v) => setTimelineMenuQuery('left', v)"
              @select="(item) => handleTimelineMenuSelect('left', item)"
            />

            <OptionMenu
              :open="timelineRightMenuOpen"
              :query="timelineRightMenuQuery"
              :groups="timelineRightMenuGroups"
              :title="t('files.viewer.timeline.selectCommitTitle')"
              :mobile-title="t('files.viewer.timeline.selectCommitTitle')"
              :search-placeholder="t('files.viewer.timeline.searchPlaceholder')"
              :empty-text="t('files.viewer.timeline.emptyText')"
              :is-mobile-pointer="isMobile"
              desktop-placement="bottom-start"
              :desktop-fixed="true"
              :desktop-anchor-el="timelineRightMenuAnchorEl"
              filter-mode="external"
              :close-on-select="false"
              :paginated="true"
              :page-size="10"
              pagination-mode="item"
              @update:open="(v) => setTimelineMenuOpen('right', v)"
              @update:query="(v) => setTimelineMenuQuery('right', v)"
              @select="(item) => handleTimelineMenuSelect('right', item)"
            />
          </div>
        </template>

        <div
          v-else
          class="flex-1 min-w-0 relative"
          @mouseup="updateSelectionFromEditor"
          @keyup="updateSelectionFromEditor"
        >
          <CodeMirrorEditor
            ref="editorRef"
            v-model="draftContent"
            :path="selectedPath"
            :use-files-theme="true"
            :wrap="wrapLines"
            :read-only="!canEdit || blameEnabled || gitInlineEnabled"
            :inline-decorations="mergedInlineDecorations"
            :inline-decorations-enabled="inlineDecorationsEnabled"
            :git-line-decorations="gitLineDecorations"
            :git-line-decorations-enabled="gitInlineEnabled"
            :line-markers="blameBlockLineMarkers"
            :line-markers-enabled="blameEnabled"
            :diff-zones="gitDiffZones"
            :diff-zones-enabled="gitInlineEnabled"
            :code-lens-actions="codeLensActions"
            @editor-scroll="onEditorScroll"
          />
        </div>
      </div>

      <div
        v-if="selection && !timelineEnabled && supportsSourceEditor"
        class="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none"
      >
        <div class="pointer-events-auto w-full max-w-xl rounded-xl border border-border bg-background/95 p-3 shadow-lg">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ selectedFile?.name }}:{{ selection.start }}-{{ selection.end }}</span>
            <IconButton
              size="xs"
              :tooltip="t('files.viewer.selection.clearAria')"
              :is-mobile-pointer="isMobile"
              :aria-label="t('files.viewer.selection.clearAria')"
              @click="clearSelection"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
          </div>
          <textarea
            v-model="commentText"
            class="mt-2 w-full min-h-[60px] rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :placeholder="t('files.viewer.selection.notePlaceholder')"
          />
          <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ t('files.viewer.selection.insertHint') }}</span>
            <Button size="sm" @click="onSendSelection" :disabled="!selection?.text.trim()">
              <RiFileCopy2Line class="h-4 w-4 mr-1" />
              {{ t('files.viewer.selection.insertButton') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="fileStatusLabel" class="border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground">
      {{ fileStatusLabel }}
    </div>
  </section>
</template>
