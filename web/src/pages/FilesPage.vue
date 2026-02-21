<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'

import FileViewerPane from './files/components/FileViewerPane.vue'
import FilesExplorerPane from './files/components/FilesExplorerPane.vue'

import {
  MAX_VIEW_CHARS,
  extensionFromPath,
  isHiddenName,
  isImagePath,
  languageForPath,
  shouldIgnoreEntryName,
  shouldIgnorePath,
  truncateContent,
} from './files/fileKinds'
import type {
  DialogKind,
  FileNode,
  FlatRow,
  ListEntry,
  ListResponse,
  SearchFile,
  SearchResponse,
  SelectionRange,
  ViewerMode,
} from './files/types'
import type {
  GitBlameLine,
  GitBlameResponse,
  GitDiffMeta,
  GitCommitFileContentResponse,
  GitLogCommit,
  GitLogResponse,
} from '@/types/git'
import type { JsonValue } from '@/types/json'

type GitDiffMode = 'working' | 'staged'
type GitPatchMode = 'stage' | 'unstage' | 'discard'
type CreateKind = 'createFile' | 'createFolder'
type ExplorerSidebarMode = 'tree' | 'search'
type ExplorerSearchMode = 'files' | 'content'
type ContentSearchScopeMode = 'workspace' | 'selected' | 'active-file'

import { ApiError, apiBlob } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { gitJson } from '@/lib/gitApi'
import {
  applyGitPatch as applyGitPatchApi,
  deletePath as deletePathApi,
  getGitBlame,
  getGitDiff,
  replaceFileContent,
  listDirectory,
  makeDirectory,
  readFileText,
  renamePath,
  searchFileContent,
  searchFiles,
  uploadFile,
  writeFile,
} from '@/features/files/api/filesApi'
import type { FsContentSearchFileResult, FsContentSearchMatch } from '@/features/files/api/filesApi'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import { useChatStore } from '@/stores/chat'
import { useToastsStore } from '@/stores/toasts'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'

const STORAGE_FILES_SHOW_HIDDEN = 'oc2.files.showHidden'
const STORAGE_FILES_RESPECT_GITIGNORE = 'oc2.files.respectGitignore'
const STORAGE_FILES_AUTOSAVE = 'oc2.files.autosave'
const STORAGE_FILES_SIDEBAR_MODE = 'oc2.files.sidebarMode'
const STORAGE_FILES_SEARCH_MODE = 'oc2.files.searchMode'
const STORAGE_FILES_CONTENT_SCOPE_MODE = 'oc2.files.contentScopeMode'
const STORAGE_FILES_EXPLORER_UI_PREFIX = 'oc2.files.explorer.ui:'
const STORAGE_FILES_EXPLORER_CACHE_PREFIX = 'oc2.files.explorer.cache:'
const DIRECTORY_PAGE_SIZE = 400
const HIDDEN_FILE_RELATIVE_PATHS = new Set(['web/src/data/directorySessionSnapshotDb.ts'])

const chat = useChatStore()
const toasts = useToastsStore()
const directoryStore = useDirectoryStore()
const ui = useUiStore()
const { startDesktopSidebarResize } = useDesktopSidebarResize()

const projectRoot = computed(() => directoryStore.currentDirectory || '')
const root = computed(() => trimTrailingSlashes(normalizePath((projectRoot.value || '').trim())))
const isMobile = computed(() => ui.isMobile)

const showHidden = ref(localStorage.getItem(STORAGE_FILES_SHOW_HIDDEN) === 'true')
const respectGitignore = ref(localStorage.getItem(STORAGE_FILES_RESPECT_GITIGNORE) !== 'false')
const autoSaveEnabled = ref(localStorage.getItem(STORAGE_FILES_AUTOSAVE) === 'true')
const showGitignored = computed({
  get: () => !respectGitignore.value,
  set: (v) => {
    respectGitignore.value = !v
  },
})

const expandedDirs = ref<Set<string>>(new Set())
const loadedDirs = ref<Set<string>>(new Set())
const inFlightDirs = ref<Set<string>>(new Set())
const entriesByDir = ref<Record<string, ListEntry[]>>({})
const childrenByDir = ref<Record<string, FileNode[]>>({})

type FilesExplorerUiState = {
  v: 1
  root: string
  showHidden: boolean
  respectGitignore: boolean
  expandedDirs: string[]
  highlightedPath?: string
  selectedPath?: string
  selectedDirectoryPath?: string
}

type FilesExplorerCacheState = {
  v: 1
  root: string
  showHidden: boolean
  respectGitignore: boolean
  at: number
  loadedDirs: string[]
  entriesByDir: Record<string, ListEntry[]>
}

function storageKey(prefix: string, rootPath: string): string {
  const base = trimTrailingSlashes(normalizePath((rootPath || '').trim()))
  return `${prefix}${base}`
}

function readJson<T>(st: Storage, key: string, fallback: T): T {
  try {
    const raw = st.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(st: Storage, key: string, value: JsonValue) {
  try {
    st.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota/unavailable
  }
}

let persistExplorerTimer: number | null = null
function persistExplorerSoon() {
  if (!root.value) return
  if (persistExplorerTimer !== null) return
  persistExplorerTimer = window.setTimeout(() => {
    persistExplorerTimer = null
    persistExplorerNow()
  }, 120)
}

function persistExplorerNow() {
  const rootPath = root.value
  if (!rootPath) return

  const base = trimTrailingSlashes(normalizePath(rootPath))
  const flags = { showHidden: showHidden.value, respectGitignore: respectGitignore.value }

  // UI state (localStorage): expanded dirs + current focus.
  const uiState: FilesExplorerUiState = {
    v: 1,
    root: base,
    ...flags,
    expandedDirs: Array.from(expandedDirs.value),
    highlightedPath: highlightedPath.value || undefined,
    selectedPath: selectedFile.value?.path || undefined,
    selectedDirectoryPath: selectedDirectoryPath.value || undefined,
  }
  writeJson(localStorage, storageKey(STORAGE_FILES_EXPLORER_UI_PREFIX, base), uiState)

  // Cache state (sessionStorage): directory listings (keep it bounded).
  const keepDirs = new Set<string>()
  keepDirs.add(base)
  for (const d of expandedDirs.value) keepDirs.add(normalizePath(String(d || '').trim()))

  const nextEntries: Record<string, ListEntry[]> = {}
  const nextLoaded: string[] = []
  for (const d of loadedDirs.value) {
    const dir = normalizePath(String(d || '').trim())
    if (!dir) continue
    if (!keepDirs.has(dir)) continue
    nextLoaded.push(dir)
    nextEntries[dir] = entriesByDir.value[dir] || []
  }

  const cacheState: FilesExplorerCacheState = {
    v: 1,
    root: base,
    ...flags,
    at: Date.now(),
    loadedDirs: nextLoaded,
    entriesByDir: nextEntries,
  }
  writeJson(sessionStorage, storageKey(STORAGE_FILES_EXPLORER_CACHE_PREFIX, base), cacheState)
}

function restoreExplorerState(rootPath: string): boolean {
  const base = trimTrailingSlashes(normalizePath((rootPath || '').trim()))
  if (!base) return false

  const uiKey = storageKey(STORAGE_FILES_EXPLORER_UI_PREFIX, base)
  const uiState = readJson<FilesExplorerUiState | null>(localStorage, uiKey, null)
  const sameUi =
    uiState &&
    uiState.v === 1 &&
    uiState.root === base &&
    uiState.showHidden === showHidden.value &&
    uiState.respectGitignore === respectGitignore.value

  if (sameUi) {
    const nextExpanded = new Set<string>()
    for (const d of uiState.expandedDirs || []) {
      const dir = normalizePath(String(d || '').trim())
      if (dir) nextExpanded.add(dir)
    }
    expandedDirs.value = nextExpanded
    highlightedPath.value = typeof uiState.highlightedPath === 'string' ? uiState.highlightedPath : ''
    const selectedDir =
      typeof uiState.selectedDirectoryPath === 'string'
        ? normalizePath(String(uiState.selectedDirectoryPath || '').trim())
        : ''
    selectedDirectoryPath.value = selectedDir && withinWorkspace(selectedDir, base) ? selectedDir : ''
  }

  const cacheKey = storageKey(STORAGE_FILES_EXPLORER_CACHE_PREFIX, base)
  const cacheState = readJson<FilesExplorerCacheState | null>(sessionStorage, cacheKey, null)
  const sameCache =
    cacheState &&
    cacheState.v === 1 &&
    cacheState.root === base &&
    cacheState.showHidden === showHidden.value &&
    cacheState.respectGitignore === respectGitignore.value &&
    cacheState.entriesByDir &&
    typeof cacheState.entriesByDir === 'object'

  if (!sameCache) {
    return Boolean(sameUi)
  }

  const nextEntries: Record<string, ListEntry[]> = {}
  const nextChildren: Record<string, FileNode[]> = {}
  const nextLoaded = new Set<string>()

  for (const dir of cacheState.loadedDirs || []) {
    const d = normalizePath(String(dir || '').trim())
    if (!d) continue
    const rawEntries = cacheState.entriesByDir[d]
    const entries = Array.isArray(rawEntries) ? rawEntries : []
    nextEntries[d] = entries
    nextChildren[d] = mapDirectoryEntries(d, entries)
    nextLoaded.add(d)
  }

  // Only apply if we at least have the root listing.
  if (!nextChildren[base]) {
    return Boolean(sameUi)
  }

  entriesByDir.value = nextEntries
  childrenByDir.value = nextChildren
  loadedDirs.value = nextLoaded
  inFlightDirs.value = new Set()

  return true
}

function readStoredSearchMode(): ExplorerSearchMode {
  const raw = (localStorage.getItem(STORAGE_FILES_SEARCH_MODE) || '').trim()
  return raw === 'content' ? 'content' : 'files'
}

function readStoredSidebarMode(): ExplorerSidebarMode {
  const raw = (localStorage.getItem(STORAGE_FILES_SIDEBAR_MODE) || '').trim()
  return raw === 'search' ? 'search' : 'tree'
}

function readStoredContentScopeMode(): ContentSearchScopeMode {
  const raw = (localStorage.getItem(STORAGE_FILES_CONTENT_SCOPE_MODE) || '').trim()
  if (raw === 'selected') return 'selected'
  if (raw === 'active-file') return 'active-file'
  return 'workspace'
}

const explorerSidebarMode = ref<ExplorerSidebarMode>(readStoredSidebarMode())
const explorerSearchMode = ref<ExplorerSearchMode>(readStoredSearchMode())
const searchQuery = ref('')
const searching = ref(false)
const searchResults = ref<FileNode[]>([])

const contentSearchQuery = ref('')
const contentSearchReplace = ref('')
const contentSearchReplaceOpen = ref(false)
const contentSearchCaseSensitive = ref(false)
const contentSearchWholeWord = ref(false)
const contentSearchRegex = ref(false)
const contentSearchScopeMode = ref<ContentSearchScopeMode>(readStoredContentScopeMode())
const contentSearchLoading = ref(false)
const contentSearchReplacing = ref(false)
const contentSearchError = ref<string | null>(null)
const contentSearchFiles = ref<FsContentSearchFileResult[]>([])
const contentSearchMatchCount = ref(0)
const contentSearchTruncated = ref(false)

const hasFileSearch = computed(() => Boolean(searchQuery.value.trim()))
const hasContentSearch = computed(() => Boolean(contentSearchQuery.value.trim()))

const selectedFile = ref<FileNode | null>(null)
const selectedDirectoryPath = ref('')
const highlightedPath = ref('')
const fileContent = ref('')
const draftContent = ref('')
const fileLoading = ref(false)
const fileError = ref<string | null>(null)
const viewerMode = ref<ViewerMode>('none')
const wrapLines = ref(true)
const isSaving = ref(false)
const uploading = ref(false)
const showMobileViewer = ref(false)
const showFilesSidebar = computed(() => (isMobile.value ? ui.isSessionSwitcherOpen : ui.isSidebarOpen))

const blameEnabled = ref(false)
const blameLoading = ref(false)
const blameError = ref<string | null>(null)
const blameLines = ref<GitBlameLine[]>([])
const blameKey = ref('')
const BLAME_CACHE_MAX = 180
const blameCache = new Map<string, GitBlameLine[]>()
const blameInFlight = new Map<string, Promise<GitBlameResponse>>()
let blameRequestSeq = 0

const gitInlineEnabled = ref(false)
const gitDiffMode = ref<GitDiffMode>('working')
const gitDiffLoading = ref(false)
const gitDiffError = ref<string | null>(null)
const gitDiffText = ref('')
const gitDiffMeta = ref<GitDiffMeta | null>(null)
const gitDiffKey = ref('')
const gitPatchBusy = ref(false)

const fileTimelineEnabled = ref(false)
const fileTimelinePath = ref('')
const fileTimelineLoading = ref(false)
const fileTimelineError = ref<string | null>(null)
const fileTimelineCommits = ref<GitLogCommit[]>([])
const fileTimelineHasMore = ref(false)
const fileTimelineOffset = ref(0)
const FILE_TIMELINE_PAGE_SIZE = 10

type TimelineSide = 'left' | 'right'

const fileTimelineLeftCommit = ref<GitLogCommit | null>(null)
const fileTimelineLeftContent = ref('')
const fileTimelineLeftLoading = ref(false)
const fileTimelineLeftError = ref<string | null>(null)

const fileTimelineRightCommit = ref<GitLogCommit | null>(null)
const fileTimelineRightContent = ref('')
const fileTimelineRightLoading = ref(false)
const fileTimelineRightError = ref<string | null>(null)

let fileTimelineLeftRequestSeq = 0
let fileTimelineRightRequestSeq = 0
let fileTimelineLoadSeq = 0
const FILE_TIMELINE_CONTENT_CACHE_MAX = 220
const fileTimelineContentCache = new Map<string, GitCommitFileContentResponse>()
const fileTimelineContentInFlight = new Map<string, Promise<GitCommitFileContentResponse>>()

let autoSaveTimer: number | null = null

function clearAutoSaveTimer() {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+S: save current file.
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
  if ((e.key || '').toLowerCase() !== 's') return
  if (viewerMode.value !== 'text' || !canEdit.value) return
  if (!selectedFile.value?.path) return

  e.preventDefault()
  void save()
}

const selection = ref<SelectionRange | null>(null)
const commentText = ref('')

const activeDialog = ref<DialogKind>(null)
const dialogData = ref<{ path: string; name?: string; type?: 'file' | 'directory' } | null>(null)
const dialogInput = ref('')
const dialogSubmitting = ref(false)

const deletingPaths = ref<Set<string>>(new Set())

const confirmDiscardOpen = ref(false)
const pendingSelect = ref<FileNode | null>(null)

watch(showHidden, (v) => localStorage.setItem(STORAGE_FILES_SHOW_HIDDEN, v ? 'true' : 'false'))
watch(respectGitignore, (v) => localStorage.setItem(STORAGE_FILES_RESPECT_GITIGNORE, v ? 'true' : 'false'))
watch(autoSaveEnabled, (v) => {
  localStorage.setItem(STORAGE_FILES_AUTOSAVE, v ? 'true' : 'false')
  if (!v) {
    clearAutoSaveTimer()
  }
})
watch(explorerSidebarMode, (v) => localStorage.setItem(STORAGE_FILES_SIDEBAR_MODE, v))
watch(explorerSearchMode, (v) => localStorage.setItem(STORAGE_FILES_SEARCH_MODE, v))
watch(contentSearchScopeMode, (v) => localStorage.setItem(STORAGE_FILES_CONTENT_SCOPE_MODE, v))

watch(
  () => [blameEnabled.value, selectedFile.value?.path, viewerMode.value, root.value] as const,
  ([enabled, path, mode, rootPath]) => {
    if (!enabled || !path || mode !== 'text' || !rootPath) {
      clearBlame()
      return
    }
    void loadBlame()
  },
)

watch(
  () => [gitInlineEnabled.value, selectedFile.value?.path, viewerMode.value, root.value, gitDiffMode.value] as const,
  ([enabled, path, mode, rootPath]) => {
    if (!enabled || !path || mode !== 'text' || !rootPath) {
      clearGitDiff()
      return
    }
    void loadGitDiff()
  },
)

watch(
  () => [isMobile.value, showMobileViewer.value] as const,
  ([mobile, showViewer]) => {
    if (!mobile || showViewer) return
    if (!selectedFile.value) return

    selectedFile.value = null
    viewerMode.value = 'none'
    fileContent.value = ''
    draftContent.value = ''
    fileLoading.value = false
    fileError.value = null
    selection.value = null
    commentText.value = ''
    clearBlame()
    clearGitDiff()
    closeFileTimeline()
  },
)

let rootRestoreSeq = 0
let openFileSeq = 0
let pageMounted = false

function isStaleRootRestore(seq: number, rootPath: string): boolean {
  return seq !== rootRestoreSeq || root.value !== rootPath
}

watch(
  () =>
    [root.value, Array.from(expandedDirs.value).join('|'), highlightedPath.value, selectedFile.value?.path].join('::'),
  () => {
    persistExplorerSoon()
  },
)

const selectedPath = computed(() => selectedFile.value?.path || '')
const rawApiPath = computed(() => {
  const path = selectedPath.value
  const rootPath = root.value
  if (!path || !rootPath) return ''
  return `/api/fs/raw?directory=${encodeURIComponent(rootPath)}&path=${encodeURIComponent(path)}`
})

const rawUrl = ref('')
let rawUrlSeq = 0

function revokeRawUrl() {
  const href = String(rawUrl.value || '').trim()
  if (!href) return
  if (href.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(href)
    } catch {
      // ignore
    }
  }
  rawUrl.value = ''
}

watch(
  () => {
    const filePath = selectedFile.value?.path || ''
    const isImg = Boolean(filePath && isImagePath(filePath))
    return [rawApiPath.value, isImg] as const
  },
  async ([path, isImg]) => {
    rawUrlSeq += 1
    const seq = rawUrlSeq

    revokeRawUrl()
    if (!isImg) return
    if (!path) return

    try {
      const blob = await apiBlob(path)
      if (seq !== rawUrlSeq) return
      const href = URL.createObjectURL(blob)
      rawUrl.value = href
    } catch (err) {
      if (seq !== rawUrlSeq) return
      fileError.value = err instanceof ApiError ? err.message || err.bodyText || '' : err instanceof Error ? err.message : String(err)
      rawUrl.value = ''
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  revokeRawUrl()
})
const isSelectedImage = computed(() => Boolean(selectedFile.value && isImagePath(selectedFile.value.path)))
const isTruncated = computed(() => fileContent.value.length > MAX_VIEW_CHARS)
const displayedContent = computed(() => truncateContent(fileContent.value))
const canEdit = computed(() => Boolean(selectedFile.value && !isSelectedImage.value && !isTruncated.value))
const dirty = computed(() => canEdit.value && draftContent.value !== displayedContent.value)

const displaySelectedPath = computed(() => {
  if (!selectedFile.value?.path) return ''
  if (isPathHiddenInFiles(selectedFile.value.path)) return ''
  return relativeToWorkspace(selectedFile.value.path)
})

const fileStatusLabel = computed(() => {
  if (!selectedFile.value?.path || viewerMode.value !== 'text') return ''
  return dirty.value ? 'modified' : 'saved'
})

const flattenedTree = computed<FlatRow[]>(() => {
  const rootPath = root.value
  if (!rootPath) return []

  const rows: FlatRow[] = []
  const walk = (dirPath: string, depth: number) => {
    const list = childrenByDir.value[dirPath] || []
    for (const node of list) {
      const isDir = node.type === 'directory'
      const isExpanded = isDir && expandedDirs.value.has(node.path)
      rows.push({
        node,
        depth,
        isExpanded,
        isLoading: isDir && inFlightDirs.value.has(node.path),
      })
      if (isDir && isExpanded) {
        walk(node.path, depth + 1)
      }
    }
  }

  walk(rootPath, 0)
  return rows
})

const hasRootChildren = computed(() => {
  const rootPath = root.value
  if (!rootPath) return false
  return Array.isArray(childrenByDir.value[rootPath])
})

const activeCreateDir = computed(() => {
  const rootPath = root.value
  if (!rootPath) return ''

  const selectedDir = normalizePath(String(selectedDirectoryPath.value || '').trim())
  if (selectedDir && withinWorkspace(selectedDir)) return selectedDir

  const file = selectedFile.value
  if (!file) return rootPath
  if (file.type === 'directory') return file.path

  const normalized = normalizePath(String(file.path || '').trim())
  const parent = normalized.split('/').slice(0, -1).join('/')
  return parent || rootPath
})

const activeUploadDir = computed(() => {
  const rootPath = root.value
  if (!rootPath) return ''

  const selectedDir = normalizePath(String(selectedDirectoryPath.value || '').trim())
  if (selectedDir && withinWorkspace(selectedDir)) return selectedDir

  const file = selectedFile.value
  if (!file) return rootPath
  if (file.type === 'directory') return file.path
  const normalized = normalizePath(String(file.path || '').trim())
  const parent = normalized.split('/').slice(0, -1).join('/')
  return parent || rootPath
})

const contentSearchSelectedScopePath = computed(() => {
  const selectedDir = normalizePath(String(selectedDirectoryPath.value || '').trim())
  if (!selectedDir || !withinWorkspace(selectedDir)) return ''
  return selectedDir
})

const contentSearchActiveFileScopePath = computed(() => {
  const rootPath = root.value
  if (!rootPath) return ''

  const file = selectedFile.value
  if (!file?.path) return ''

  const normalized = normalizePath(String(file.path || '').trim())
  const scopePath = file.type === 'directory' ? normalized : normalized.split('/').slice(0, -1).join('/')
  if (!scopePath || !withinWorkspace(scopePath)) return ''
  return scopePath
})

const contentSearchScopePath = computed(() => {
  const rootPath = root.value
  if (!rootPath) return ''

  if (contentSearchScopeMode.value === 'selected') {
    return contentSearchSelectedScopePath.value || rootPath
  }
  if (contentSearchScopeMode.value === 'active-file') {
    return contentSearchActiveFileScopePath.value || rootPath
  }
  return rootPath
})

function labelForScopePath(path: string): string {
  if (!path) return ''
  const rel = relativeToWorkspace(path)
  return rel === '.' ? 'workspace root' : rel
}

const contentSearchScopeOptions = computed(() => {
  const rootPath = root.value
  const selectedPath = contentSearchSelectedScopePath.value
  const activeFilePath = contentSearchActiveFileScopePath.value

  return [
    {
      id: 'workspace' as const,
      label: 'Workspace',
      description: labelForScopePath(rootPath),
      disabled: !rootPath,
    },
    {
      id: 'selected' as const,
      label: 'Selected folder',
      description: selectedPath ? labelForScopePath(selectedPath) : 'Select a folder in explorer first',
      disabled: !selectedPath,
    },
    {
      id: 'active-file' as const,
      label: 'Current file folder',
      description: activeFilePath ? labelForScopePath(activeFilePath) : 'Open a file first',
      disabled: !activeFilePath,
    },
  ]
})

const activeContentSearchScope = computed(() => {
  return contentSearchScopeOptions.value.find((scope) => scope.id === contentSearchScopeMode.value) || null
})

const contentSearchSummary = computed(() => {
  if (!hasContentSearch.value) return 'Type to search inside file contents.'
  if (contentSearchLoading.value) return 'Searching...'
  const files = contentSearchFiles.value.length
  const matches = contentSearchMatchCount.value
  const text = `${matches} match${matches === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}`
  return contentSearchTruncated.value ? `${text} (limited)` : text
})

const dialogTitle = computed(() => {
  switch (activeDialog.value) {
    case 'createFile':
      return 'Create file'
    case 'createFolder':
      return 'Create folder'
    case 'rename':
      return 'Rename'
    default:
      return ''
  }
})

const dialogDescription = computed(() => {
  const base = dialogData.value?.path || root.value || 'root'
  if (activeDialog.value === 'createFile') return `Create a new file in ${base}`
  if (activeDialog.value === 'createFolder') return `Create a new folder in ${base}`
  if (activeDialog.value === 'rename') return `Rename ${dialogData.value?.name || ''}`
  return ''
})

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '')
}

function joinPath(base: string, name: string): string {
  const b = base.replace(/\/+$/, '')
  const n = name.replace(/^\/+/, '')
  return `${b}/${n}`
}

function withinWorkspace(path: string, basePath = root.value): boolean {
  const normalizedBase = trimTrailingSlashes(normalizePath(basePath || ''))
  if (!normalizedBase) return true
  const normalizedPath = trimTrailingSlashes(normalizePath(path))
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)
}

function relativeToWorkspace(absPath: string): string {
  const base = trimTrailingSlashes(root.value)
  const normalized = trimTrailingSlashes(normalizePath(absPath))
  if (!base) return normalized
  if (normalized === base) return '.'
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return normalized
}

function normalizeRelativePathKey(path: string): string {
  return normalizePath(String(path || '').trim()).replace(/^\/+/, '')
}

function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function isPathHiddenInFiles(absOrRelPath: string): boolean {
  const normalized = normalizePath(String(absOrRelPath || '').trim())
  if (!normalized) return false

  const rel = normalizeRelativePathKey(relativeToWorkspace(normalized))
  if (HIDDEN_FILE_RELATIVE_PATHS.has(rel)) return true

  const direct = normalizeRelativePathKey(normalized)
  return HIDDEN_FILE_RELATIVE_PATHS.has(direct)
}

function resetFileTimelineState() {
  fileTimelineLoadSeq += 1
  fileTimelineLeftRequestSeq += 1
  fileTimelineRightRequestSeq += 1
  fileTimelineContentCache.clear()
  fileTimelineContentInFlight.clear()

  fileTimelineLoading.value = false
  fileTimelineError.value = null
  fileTimelineCommits.value = []
  fileTimelineHasMore.value = false
  fileTimelineOffset.value = 0

  fileTimelineLeftCommit.value = null
  fileTimelineLeftContent.value = ''
  fileTimelineLeftLoading.value = false
  fileTimelineLeftError.value = null

  fileTimelineRightCommit.value = null
  fileTimelineRightContent.value = ''
  fileTimelineRightLoading.value = false
  fileTimelineRightError.value = null
}

function closeFileTimeline() {
  fileTimelineEnabled.value = false
  fileTimelinePath.value = ''
  resetFileTimelineState()
}

function isTimelineSideRequestStale(side: TimelineSide, requestSeq: number): boolean {
  return side === 'left' ? requestSeq !== fileTimelineLeftRequestSeq : requestSeq !== fileTimelineRightRequestSeq
}

function timelineContentCacheKey(commitHash: string): string {
  const rootPath = root.value
  const relPath = fileTimelinePath.value.trim()
  const hash = String(commitHash || '').trim()
  if (!rootPath || !relPath || !hash) return ''
  return `${rootPath}::${relPath}::${hash}`
}

function applyTimelineCommitContent(side: TimelineSide, requestSeq: number, payload: GitCommitFileContentResponse) {
  if (isTimelineSideRequestStale(side, requestSeq)) return
  const isLeft = side === 'left'

  if (!payload?.exists) {
    if (isLeft) {
      fileTimelineLeftContent.value = ''
      fileTimelineLeftError.value = 'File does not exist in this commit.'
    } else {
      fileTimelineRightContent.value = ''
      fileTimelineRightError.value = 'File does not exist in this commit.'
    }
    return
  }

  if (payload.binary) {
    if (isLeft) {
      fileTimelineLeftContent.value = ''
      fileTimelineLeftError.value = 'Selected commit stores this file as binary. Text compare is unavailable.'
    } else {
      fileTimelineRightContent.value = ''
      fileTimelineRightError.value = 'Selected commit stores this file as binary. Text compare is unavailable.'
    }
    return
  }

  if (isLeft) {
    fileTimelineLeftContent.value = typeof payload.content === 'string' ? payload.content : ''
    fileTimelineLeftError.value = null
  } else {
    fileTimelineRightContent.value = typeof payload.content === 'string' ? payload.content : ''
    fileTimelineRightError.value = null
  }

  if (payload.truncated) {
    toasts.push('info', 'Commit content is large and has been truncated for preview.')
  }
}

async function selectFileTimelineCommit(side: TimelineSide, commit: GitLogCommit) {
  const rootPath = root.value
  const relPath = fileTimelinePath.value.trim()
  const hash = (commit?.hash || '').trim()
  if (!rootPath || !relPath || !hash) return

  const isLeft = side === 'left'
  const requestSeq = isLeft ? ++fileTimelineLeftRequestSeq : ++fileTimelineRightRequestSeq

  if (isLeft) {
    fileTimelineLeftCommit.value = commit
    fileTimelineLeftError.value = null
    fileTimelineLeftLoading.value = true
  } else {
    fileTimelineRightCommit.value = commit
    fileTimelineRightError.value = null
    fileTimelineRightLoading.value = true
  }

  const cacheKey = timelineContentCacheKey(hash)
  const cached = cacheKey ? fileTimelineContentCache.get(cacheKey) : undefined
  if (cached) {
    if (!isTimelineSideRequestStale(side, requestSeq)) {
      applyTimelineCommitContent(side, requestSeq, cached)
      if (isLeft) {
        fileTimelineLeftLoading.value = false
      } else {
        fileTimelineRightLoading.value = false
      }
    }
    return
  }

  try {
    let inFlight = cacheKey ? fileTimelineContentInFlight.get(cacheKey) : undefined
    if (!inFlight) {
      const request = gitJson<GitCommitFileContentResponse>('commit-file-content', rootPath, {
        commit: hash,
        path: relPath,
      })
      if (cacheKey) {
        inFlight = request
        fileTimelineContentInFlight.set(cacheKey, request)
        void request.finally(() => {
          if (fileTimelineContentInFlight.get(cacheKey) === request) {
            fileTimelineContentInFlight.delete(cacheKey)
          }
        })
      } else {
        inFlight = request
      }
    }

    const resp = await inFlight
    if (isTimelineSideRequestStale(side, requestSeq)) return

    if (cacheKey) {
      setBoundedCacheEntry(fileTimelineContentCache, cacheKey, resp, FILE_TIMELINE_CONTENT_CACHE_MAX)
    }
    applyTimelineCommitContent(side, requestSeq, resp)
  } catch (err) {
    if (isTimelineSideRequestStale(side, requestSeq)) return
    if (isLeft) {
      fileTimelineLeftError.value = err instanceof Error ? err.message : String(err)
    } else {
      fileTimelineRightError.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    if (!isTimelineSideRequestStale(side, requestSeq)) {
      if (isLeft) {
        fileTimelineLeftLoading.value = false
      } else {
        fileTimelineRightLoading.value = false
      }
    }
  }
}

async function loadFileTimeline(reset = false) {
  const rootPath = root.value
  const relPath = fileTimelinePath.value.trim()
  if (!rootPath || !relPath) return
  if (fileTimelineLoading.value) return

  if (reset) {
    fileTimelineOffset.value = 0
    fileTimelineCommits.value = []
    fileTimelineHasMore.value = false

    fileTimelineLeftRequestSeq += 1
    fileTimelineRightRequestSeq += 1
    fileTimelineLeftCommit.value = null
    fileTimelineLeftContent.value = ''
    fileTimelineLeftLoading.value = false
    fileTimelineLeftError.value = null
    fileTimelineRightCommit.value = null
    fileTimelineRightContent.value = ''
    fileTimelineRightLoading.value = false
    fileTimelineRightError.value = null
  }

  const requestSeq = ++fileTimelineLoadSeq
  fileTimelineLoading.value = true
  fileTimelineError.value = null
  try {
    const resp = await gitJson<GitLogResponse>('log', rootPath, {
      path: relPath,
      offset: fileTimelineOffset.value,
      limit: FILE_TIMELINE_PAGE_SIZE,
      graph: true,
    })

    if (requestSeq !== fileTimelineLoadSeq || !fileTimelineEnabled.value || fileTimelinePath.value.trim() !== relPath) {
      return
    }

    const next = Array.isArray(resp?.commits) ? resp.commits : []
    fileTimelineCommits.value = reset ? next : [...fileTimelineCommits.value, ...next]
    fileTimelineHasMore.value = Boolean(resp?.hasMore)
    fileTimelineOffset.value = resp?.nextOffset ?? fileTimelineOffset.value + next.length

    if (reset && next.length) {
      const rightDefault = next[0] || null
      const leftDefault = next[1] || next[0] || null
      await Promise.all([
        leftDefault ? selectFileTimelineCommit('left', leftDefault) : Promise.resolve(),
        rightDefault ? selectFileTimelineCommit('right', rightDefault) : Promise.resolve(),
      ])
    }
  } catch (err) {
    if (requestSeq !== fileTimelineLoadSeq) return
    fileTimelineError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (requestSeq === fileTimelineLoadSeq) {
      fileTimelineLoading.value = false
    }
  }
}

async function loadMoreFileTimeline() {
  if (!fileTimelineHasMore.value) return
  await loadFileTimeline(false)
}

function openFileTimeline() {
  const file = selectedFile.value
  if (!file || file.type !== 'file' || viewerMode.value !== 'text') {
    toasts.push('error', 'Timeline compare is only available for text files')
    return
  }

  const relPath = relativeToWorkspace(file.path).trim()
  if (!relPath || relPath === '.') {
    toasts.push('error', 'Cannot open timeline for this entry')
    return
  }

  if (fileTimelineEnabled.value && fileTimelinePath.value === relPath) {
    closeFileTimeline()
    return
  }

  resetFileTimelineState()
  fileTimelineEnabled.value = true
  fileTimelinePath.value = relPath
  selection.value = null
  commentText.value = ''

  if (blameEnabled.value) {
    clearBlame()
    blameEnabled.value = false
  }

  if (gitInlineEnabled.value) {
    gitInlineEnabled.value = false
    clearGitDiff()
  }

  void loadFileTimeline(true)
}

async function copyToClipboard(text: string) {
  const ok = await copyTextToClipboard(text)
  if (ok) {
    toasts.push('success', 'Copied')
    return
  }
  toasts.push('error', 'Copy failed')
}

async function triggerDownloadForPath(path: string, fileName?: string) {
  const rootPath = root.value
  const normalized = normalizePath(String(path || '').trim())
  if (!rootPath || !normalized || !withinWorkspace(normalized)) return

  const url = `/api/fs/download?directory=${encodeURIComponent(rootPath)}&path=${encodeURIComponent(normalized)}`
  try {
    const blob = await apiBlob(url)
    const href = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = href
    if (fileName) {
      link.download = fileName
    }
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()

    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(href)
      } catch {
        // ignore
      }
    }, 30_000)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message || err.bodyText || '' : err instanceof Error ? err.message : String(err)
    toasts.push('error', msg || 'Download failed')
  }
}

async function openSelectedFileRaw() {
  const file = selectedFile.value
  if (!file) return
  await triggerDownloadForPath(file.path, file.name)
}

async function runExplorerFileAction(action: 'download' | 'copy-path', node: FileNode) {
  if (node.type !== 'file') return

  if (action === 'download') {
    triggerDownloadForPath(node.path, node.name)
    return
  }

  const relPath = relativeToWorkspace(node.path)
  const target = relPath && relPath !== '.' ? relPath : node.path
  await copyToClipboard(target)
}

function mapDirectoryEntries(dirPath: string, entries: ListEntry[]): FileNode[] {
  const includeHidden = showHidden.value
  const includeGitignored = showGitignored.value
  const buildPath = (entry: ListEntry) => normalizePath(entry.path || `${dirPath}/${entry.name}`)
  const nodes = entries
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.length > 0)
    .filter((entry) => includeHidden || !isHiddenName(entry.name))
    .filter((entry) => includeGitignored || !shouldIgnoreEntryName(entry.name))
    .filter((entry) => !isPathHiddenInFiles(buildPath(entry)))
    .map<FileNode>((entry) => {
      const name = entry.name
      const path = buildPath(entry)
      const type = entry.isDirectory ? 'directory' : 'file'
      const extension = type === 'file' ? extensionFromPath(name) : undefined
      return { name, path, type, extension }
    })

  return nodes.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function loadDirectory(dirPath: string, opts?: { force?: boolean }) {
  const workspaceRoot = root.value
  const normalized = normalizePath(dirPath.trim())
  if (!workspaceRoot || !normalized || !withinWorkspace(normalized, workspaceRoot)) return
  if (!opts?.force && loadedDirs.value.has(normalized)) return
  if (inFlightDirs.value.has(normalized)) return

  inFlightDirs.value = new Set(inFlightDirs.value)
  inFlightDirs.value.add(normalized)

  try {
    let offset = 0
    let entries: ListEntry[] = opts?.force ? [] : entriesByDir.value[normalized] || []
    let hasMore = true

    while (hasMore) {
      const resp = (await listDirectory({
        path: normalized,
        respectGitignore: respectGitignore.value,
        offset,
        limit: DIRECTORY_PAGE_SIZE,
      })) as ListResponse
      if (root.value !== workspaceRoot) return
      const page = Array.isArray(resp.entries) ? resp.entries : []

      if (offset === 0) entries = page
      else if (page.length) entries = [...entries, ...page]

      entriesByDir.value = { ...entriesByDir.value, [normalized]: entries }
      childrenByDir.value = { ...childrenByDir.value, [normalized]: mapDirectoryEntries(normalized, entries) }

      if (!page.length) break

      const nextOffset =
        typeof resp.nextOffset === 'number' && Number.isFinite(resp.nextOffset)
          ? Math.max(0, Math.floor(resp.nextOffset))
          : offset + page.length
      if (nextOffset <= offset) {
        break
      }
      const total = typeof resp.total === 'number' && Number.isFinite(resp.total) ? Math.max(0, resp.total) : null
      if (typeof resp.hasMore === 'boolean') {
        hasMore = resp.hasMore
      } else if (total !== null) {
        hasMore = nextOffset < total
      } else {
        hasMore = page.length === DIRECTORY_PAGE_SIZE
      }
      if (!hasMore) break
      offset = nextOffset
    }

    if (root.value !== workspaceRoot) return
    loadedDirs.value = new Set(loadedDirs.value)
    loadedDirs.value.add(normalized)
  } catch {
    if (root.value !== workspaceRoot) return
    entriesByDir.value = { ...entriesByDir.value, [normalized]: entriesByDir.value[normalized] || [] }
    childrenByDir.value = { ...childrenByDir.value, [normalized]: childrenByDir.value[normalized] || [] }
  } finally {
    inFlightDirs.value = new Set(inFlightDirs.value)
    inFlightDirs.value.delete(normalized)

    // Keep explorer state warm across navigation/reloads.
    if (root.value === workspaceRoot) {
      persistExplorerSoon()
    }
  }
}

async function refreshRoot() {
  if (!root.value) return

  const rootPath = root.value
  await loadDirectory(rootPath, { force: true })
  if (root.value !== rootPath) return

  // Refresh currently-expanded folders so the visible list stays coherent.
  const expanded = Array.from(expandedDirs.value)
  for (const d of expanded) {
    const dir = normalizePath(String(d || '').trim())
    if (!dir || dir === rootPath) continue
    if (!withinWorkspace(dir, rootPath)) continue
    await loadDirectory(dir, { force: true })
    if (root.value !== rootPath) return
  }
}

function collapseAllDirectories() {
  if (!expandedDirs.value.size) return
  expandedDirs.value = new Set()
  persistExplorerSoon()
}

async function toggleDirectory(dirPath: string) {
  const normalized = normalizePath(dirPath)
  const next = new Set(expandedDirs.value)
  if (next.has(normalized)) next.delete(normalized)
  else next.add(normalized)
  expandedDirs.value = next

  if (!loadedDirs.value.has(normalized)) {
    await loadDirectory(normalized)
  }

  persistExplorerSoon()
}

async function ensureDirectoryExpanded(dirPath: string) {
  const rootPath = root.value
  const normalized = normalizePath(String(dirPath || '').trim())
  if (!rootPath || !normalized || !withinWorkspace(normalized, rootPath)) return

  selectedDirectoryPath.value = normalized
  if (normalized !== rootPath && !expandedDirs.value.has(normalized)) {
    const next = new Set(expandedDirs.value)
    next.add(normalized)
    expandedDirs.value = next
    persistExplorerSoon()
  }

  await loadDirectory(normalized)
}

function toggleBlame() {
  if (!blameEnabled.value && fileTimelineEnabled.value) {
    closeFileTimeline()
  }

  blameEnabled.value = !blameEnabled.value
  if (blameEnabled.value) {
    invalidateCurrentBlameCache()
    void loadBlame({ force: true })
  }
}

function toggleGitInline() {
  gitInlineEnabled.value = !gitInlineEnabled.value
}

function toggleGitDiffMode() {
  gitDiffMode.value = gitDiffMode.value === 'staged' ? 'working' : 'staged'
}

function clearBlame() {
  const currentKey = blameKey.value
  blameRequestSeq += 1
  blameLoading.value = false
  blameLines.value = []
  blameError.value = null
  blameKey.value = ''
  if (currentKey) {
    blameInFlight.delete(currentKey)
  }
}

function normalizeBlameLines(input: GitBlameLine[]): GitBlameLine[] {
  const normalized = input
    .map((line) => ({
      line: Math.max(1, Math.floor(Number(line?.line || 0))),
      hash: String(line?.hash || '').trim(),
      author: String(line?.author || '').trim(),
      authorEmail: String(line?.authorEmail || '').trim(),
      authorTime: Number(line?.authorTime || 0),
      summary: String(line?.summary || '').trim(),
    }))
    .filter((line) => line.line > 0)
    .sort((a, b) => a.line - b.line)

  const deduped: GitBlameLine[] = []
  for (const line of normalized) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.line === line.line) {
      deduped[deduped.length - 1] = line
      continue
    }
    deduped.push(line)
  }
  return deduped
}

function currentBlameCacheKey(): string {
  const rootPath = root.value
  const file = selectedFile.value
  if (!rootPath || !file || viewerMode.value !== 'text') return ''

  const rel = relativeToWorkspace(file.path)
  if (!rel) return ''
  return `${rootPath}::${rel}`
}

function invalidateCurrentBlameCache() {
  const key = currentBlameCacheKey()
  if (!key) return
  blameCache.delete(key)
  blameInFlight.delete(key)
}

function reloadBlame() {
  invalidateCurrentBlameCache()
  void loadBlame({ force: true })
}

function clearGitDiff() {
  gitDiffText.value = ''
  gitDiffMeta.value = null
  gitDiffError.value = null
  gitDiffLoading.value = false
  gitDiffKey.value = ''
}

async function loadBlame(opts?: { force?: boolean }) {
  const rootPath = root.value
  const file = selectedFile.value
  if (!rootPath || !file || viewerMode.value !== 'text') return

  const rel = relativeToWorkspace(file.path)
  if (!rel) return
  const key = `${rootPath}::${rel}`

  const cached = !opts?.force ? blameCache.get(key) : undefined
  if (cached && cached.length > 0) {
    blameKey.value = key
    blameLines.value = cached
    blameError.value = null
    blameLoading.value = false
    return
  }

  const requestSeq = ++blameRequestSeq
  blameKey.value = key

  blameLoading.value = true
  blameError.value = null
  try {
    let inFlight = !opts?.force ? blameInFlight.get(key) : undefined
    if (!inFlight) {
      const request = getGitBlame({ directory: rootPath, path: rel })
      inFlight = request
      blameInFlight.set(key, request)
      void request.finally(() => {
        if (blameInFlight.get(key) === request) {
          blameInFlight.delete(key)
        }
      })
    }

    const resp = (await inFlight) as GitBlameResponse
    if (blameKey.value !== key || requestSeq !== blameRequestSeq) return
    const lines = normalizeBlameLines(Array.isArray(resp?.lines) ? resp.lines : [])
    blameLines.value = lines
    if (lines.length > 0) {
      setBoundedCacheEntry(blameCache, key, lines, BLAME_CACHE_MAX)
    } else {
      blameCache.delete(key)
      if (draftContent.value.trim()) {
        blameError.value = 'No blame data returned for current file. Try reloading blame.'
      }
    }
  } catch (err) {
    if (blameKey.value !== key || requestSeq !== blameRequestSeq) return
    blameLines.value = []
    blameCache.delete(key)
    blameError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (blameKey.value === key && requestSeq === blameRequestSeq) {
      blameLoading.value = false
    }
  }
}

async function loadGitDiff() {
  const rootPath = root.value
  const file = selectedFile.value
  if (!rootPath || !file || viewerMode.value !== 'text') return

  const rel = relativeToWorkspace(file.path)
  if (!rel) return

  const key = `${rootPath}::${rel}::${gitDiffMode.value}`
  gitDiffKey.value = key

  gitDiffLoading.value = true
  gitDiffError.value = null
  try {
    const resp = await getGitDiff({
      directory: rootPath,
      path: rel,
      staged: gitDiffMode.value === 'staged',
      contextLines: 3,
      includeMeta: true,
    })
    if (gitDiffKey.value !== key) return
    gitDiffText.value = typeof resp?.diff === 'string' ? resp.diff : ''
    gitDiffMeta.value = resp?.meta && typeof resp.meta === 'object' ? resp.meta : null
  } catch (err) {
    if (gitDiffKey.value !== key) return
    gitDiffText.value = ''
    gitDiffMeta.value = null
    gitDiffError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (gitDiffKey.value === key) {
      gitDiffLoading.value = false
    }
  }
}

async function applyGitPatch(patch: string, mode: GitPatchMode) {
  const rootPath = root.value
  const file = selectedFile.value
  if (!rootPath || !file || !patch.trim()) return
  if (gitPatchBusy.value) return
  if (dirty.value) {
    toasts.push('error', 'Save the file before applying git hunk actions')
    return
  }

  gitPatchBusy.value = true
  try {
    await applyGitPatchApi({ directory: rootPath, patch, mode })

    if (mode === 'discard') {
      invalidateCurrentBlameCache()
      await openFile(file)
    }

    if (blameEnabled.value) {
      void loadBlame({ force: mode === 'discard' })
    }
    void loadGitDiff()

    const label = mode === 'stage' ? 'Hunk staged' : mode === 'unstage' ? 'Hunk unstaged' : 'Hunk discarded'
    toasts.push('success', label)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
  } finally {
    gitPatchBusy.value = false
  }
}

async function runSearch() {
  const rootPath = root.value
  const q = searchQuery.value.trim()
  if (!rootPath || !q) {
    searchResults.value = []
    searching.value = false
    return
  }

  searching.value = true
  try {
    const resp = (await searchFiles({
      root: rootPath,
      query: q,
      limit: 200,
      respectGitignore: respectGitignore.value,
    })) as SearchResponse

    const includeHidden = showHidden.value
    const includeGitignored = showGitignored.value
    const filtered = (resp.files || []).filter((f) => includeHidden || !isHiddenName(f.name))
    const pruned = includeGitignored ? filtered : filtered.filter((f) => !shouldIgnorePath(f.path))
    const visible = pruned.filter((f) => !isPathHiddenInFiles(f.path))

    const normalizedQuery = q.toLowerCase()
    const ranked = visible
      .map((hit) => {
        const label = hit.relative_path || relativeToWorkspace(hit.path)
        const score = fuzzyScore(normalizedQuery, label)
        return score === null ? null : { hit, score, labelLength: label.length }
      })
      .filter(Boolean) as Array<{ hit: SearchFile; score: number; labelLength: number }>

    ranked.sort((a, b) => b.score - a.score || a.labelLength - b.labelLength || a.hit.path.localeCompare(b.hit.path))

    searchResults.value = ranked.map(({ hit }) => ({
      name: hit.name,
      path: normalizePath(hit.path),
      type: 'file',
      extension: extensionFromPath(hit.name),
      relativePath: hit.relative_path || relativeToWorkspace(hit.path),
    }))
  } catch {
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function clearFileSearch() {
  searchQuery.value = ''
  searchResults.value = []
  searching.value = false
}

function resetContentSearchResults() {
  contentSearchFiles.value = []
  contentSearchMatchCount.value = 0
  contentSearchTruncated.value = false
  contentSearchError.value = null
}

async function runContentSearch() {
  const rootPath = root.value
  const q = contentSearchQuery.value.trim()
  if (!rootPath || !q) {
    contentSearchLoading.value = false
    resetContentSearchResults()
    return
  }

  contentSearchLoading.value = true
  contentSearchError.value = null
  try {
    const scopePath = trimTrailingSlashes(normalizePath(contentSearchScopePath.value || rootPath))
    const scopeList = scopePath && scopePath !== rootPath ? [scopePath] : undefined

    const resp = await searchFileContent({
      directory: rootPath,
      query: q,
      paths: scopeList,
      includeHidden: showHidden.value,
      respectGitignore: respectGitignore.value,
      isRegex: contentSearchRegex.value,
      caseSensitive: contentSearchCaseSensitive.value,
      wholeWord: contentSearchWholeWord.value,
      maxResults: 1200,
      maxMatchesPerFile: 80,
      contextChars: 56,
    })

    const files = Array.isArray(resp.files)
      ? resp.files.map((file) => ({
          ...file,
          path: normalizePath(file.path),
          matches: Array.isArray(file.matches)
            ? file.matches.map((m) => ({
                ...m,
                startOffset: Number(m.startOffset || 0),
                endOffset: Number(m.endOffset || 0),
              }))
            : [],
        }))
      : []

    const visibleFiles = files.filter((file) => !isPathHiddenInFiles(file.path))
    contentSearchFiles.value = visibleFiles
    contentSearchMatchCount.value = visibleFiles.reduce((sum, file) => sum + Number(file.matchCount || 0), 0)
    contentSearchTruncated.value = Boolean(resp.truncated)
  } catch (err) {
    resetContentSearchResults()
    contentSearchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    contentSearchLoading.value = false
  }
}

function clearContentSearch() {
  contentSearchQuery.value = ''
  contentSearchLoading.value = false
  resetContentSearchResults()
}

async function openContentSearchResult(path: string) {
  const normalized = normalizePath(path)
  if (isPathHiddenInFiles(normalized)) return
  const name = normalized.split('/').pop() || normalized
  await requestFileSelect({
    name,
    path: normalized,
    type: 'file',
    extension: extensionFromPath(name),
    relativePath: relativeToWorkspace(normalized),
  })
}

async function replaceContentSearchMatch(file: FsContentSearchFileResult, match: FsContentSearchMatch) {
  const rootPath = root.value
  if (!rootPath) return
  if (dirty.value) {
    toasts.push('error', 'Save current file before replacing across files')
    return
  }

  contentSearchReplacing.value = true
  try {
    const resp = await replaceFileContent({
      directory: rootPath,
      replace: contentSearchReplace.value,
      match: {
        path: file.path,
        startOffset: match.startOffset,
        endOffset: match.endOffset,
        expected: match.matched,
      },
    })

    const replaced = Number(resp.replacementCount || 0)
    if (replaced > 0) {
      toasts.push('success', 'Match replaced')
    }

    if (selectedFile.value?.type === 'file' && normalizePath(selectedFile.value.path) === normalizePath(file.path)) {
      await openFile(selectedFile.value)
    }

    await runContentSearch()
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    contentSearchReplacing.value = false
  }
}

async function replaceAllContentSearchMatches() {
  const rootPath = root.value
  const q = contentSearchQuery.value.trim()
  if (!rootPath || !q || !contentSearchFiles.value.length) return
  if (dirty.value) {
    toasts.push('error', 'Save current file before replacing across files')
    return
  }

  contentSearchReplacing.value = true
  try {
    const resp = await replaceFileContent({
      directory: rootPath,
      query: q,
      replace: contentSearchReplace.value,
      includeHidden: showHidden.value,
      respectGitignore: respectGitignore.value,
      isRegex: contentSearchRegex.value,
      caseSensitive: contentSearchCaseSensitive.value,
      wholeWord: contentSearchWholeWord.value,
      paths: contentSearchFiles.value.map((file) => file.path),
    })

    const replacements = Number(resp.replacementCount || 0)
    const skipped = Number(resp.skipped || 0)
    if (replacements > 0) {
      const suffix = skipped > 0 ? `, skipped ${skipped} file${skipped === 1 ? '' : 's'}` : ''
      toasts.push('success', `Replaced ${replacements} match${replacements === 1 ? '' : 'es'}${suffix}`)
    } else {
      toasts.push('info', 'No matches replaced')
    }

    if (selectedFile.value?.type === 'file') {
      const selectedPath = normalizePath(selectedFile.value.path)
      const changed = (resp.files || []).some((item) => normalizePath(item.path) === selectedPath)
      if (changed) {
        await openFile(selectedFile.value)
      }
    }

    await runContentSearch()
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    contentSearchReplacing.value = false
  }
}

function fuzzyScore(query: string, candidate: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const c = candidate.toLowerCase()
  let score = 0
  let lastIndex = -1
  let consecutive = 0

  for (let i = 0; i < q.length; i += 1) {
    const ch = q[i]
    if (!ch || ch === ' ') continue

    const idx = c.indexOf(ch, lastIndex + 1)
    if (idx === -1) return null

    const gap = idx - lastIndex - 1
    if (gap === 0) consecutive += 1
    else consecutive = 0

    score += 10
    score += Math.max(0, 18 - idx)
    score -= Math.max(0, gap)

    if (idx === 0) {
      score += 12
    } else {
      const prev = c[idx - 1]
      if (prev === '/' || prev === '_' || prev === '-' || prev === '.' || prev === ' ') {
        score += 10
      }
    }

    score += consecutive > 0 ? 12 : 0
    lastIndex = idx
  }

  score += Math.max(0, 24 - Math.round(c.length / 3))
  return score
}

async function openFile(node: FileNode) {
  if (node.type !== 'file') return
  if (isPathHiddenInFiles(node.path)) return
  const rootPath = root.value
  if (!rootPath) {
    fileError.value = 'No project selected'
    return
  }
  const seq = ++openFileSeq
  highlightedPath.value = ''
  selectedDirectoryPath.value = ''
  clearBlame()
  clearGitDiff()
  closeFileTimeline()
  selectedFile.value = node
  fileError.value = null
  selection.value = null
  commentText.value = ''
  fileLoading.value = true

  if (isMobile.value) {
    showMobileViewer.value = true
  }

  if (isImagePath(node.path)) {
    viewerMode.value = 'image'
    fileContent.value = ''
    draftContent.value = ''
    fileLoading.value = false
    return
  }

  viewerMode.value = 'text'
  try {
    const content = await readFileText({ directory: rootPath, path: node.path })
    if (seq !== openFileSeq || root.value !== rootPath || selectedFile.value?.path !== node.path) return
    fileContent.value = content
    draftContent.value = truncateContent(content)
  } catch (err) {
    if (seq !== openFileSeq || root.value !== rootPath || selectedFile.value?.path !== node.path) return
    viewerMode.value = 'binary'
    fileContent.value = ''
    draftContent.value = ''
    fileError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (seq === openFileSeq && root.value === rootPath && selectedFile.value?.path === node.path) {
      fileLoading.value = false
    }
  }
}

async function requestFileSelect(node: FileNode) {
  if (node.type === 'file' && isPathHiddenInFiles(node.path)) return
  highlightedPath.value = ''
  selectedDirectoryPath.value = ''
  clearBlame()
  clearGitDiff()
  closeFileTimeline()
  if (dirty.value) {
    if (autoSaveEnabled.value) {
      const ok = await save({ silent: true })
      if (ok) {
        await openFile(node)
        return
      }
    }
    pendingSelect.value = node
    confirmDiscardOpen.value = true
    return
  }
  await openFile(node)
}

async function handleNodeClick(node: FileNode) {
  highlightedPath.value = ''
  clearBlame()
  clearGitDiff()
  closeFileTimeline()
  if (node.type === 'directory') {
    selectedDirectoryPath.value = normalizePath(node.path)
    await toggleDirectory(node.path)
    return
  }
  await requestFileSelect(node)
}

async function save(opts?: { silent?: boolean }): Promise<boolean> {
  const rootPath = root.value
  const path = selectedFile.value?.path
  if (!rootPath || !path || !canEdit.value) return false
  isSaving.value = true
  fileError.value = null
  try {
    await writeFile({ directory: rootPath, path, content: draftContent.value })
    fileContent.value = draftContent.value
    if (blameEnabled.value) {
      invalidateCurrentBlameCache()
      void loadBlame({ force: true })
    }
    if (gitInlineEnabled.value) {
      void loadGitDiff()
    }
    if (!opts?.silent) {
      toasts.push('success', 'Saved file')
    }
    return true
  } catch (err) {
    const msg =
      err instanceof ApiError ? err.message || err.bodyText || '' : err instanceof Error ? err.message : String(err)
    fileError.value = msg
    toasts.push('error', msg)
    return false
  } finally {
    isSaving.value = false
  }
}

async function uploadFilesToDirectory(files: FileList, targetDir?: string) {
  const rootPath = root.value
  if (!rootPath) return

  const list = Array.from(files || [])
  if (!list.length) return

  const normalizedTarget = normalizePath(String(targetDir || '').trim())
  const destination =
    normalizedTarget && withinWorkspace(normalizedTarget) ? normalizedTarget : activeUploadDir.value || rootPath

  uploading.value = true
  try {
    for (const file of list) {
      const target = joinPath(destination, file.name)
      await uploadFile({ directory: rootPath, path: target, file })
    }
    toasts.push('success', `Uploaded ${list.length} file${list.length === 1 ? '' : 's'}`)
    await refreshRoot()
  } catch (err) {
    const msg =
      err instanceof ApiError ? err.message || err.bodyText || '' : err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
  } finally {
    uploading.value = false
  }
}

watch(
  () => draftContent.value,
  () => {
    clearAutoSaveTimer()
    if (!autoSaveEnabled.value) return
    if (viewerMode.value !== 'text' || !canEdit.value) return
    if (!dirty.value || isSaving.value) return

    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = null
      if (!autoSaveEnabled.value) return
      if (!dirty.value || isSaving.value) return
      void save({ silent: true })
    }, 650)
  },
)

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  pageMounted = false
  rootRestoreSeq += 1
  openFileSeq += 1
  clearAutoSaveTimer()
  if (persistExplorerTimer !== null) {
    window.clearTimeout(persistExplorerTimer)
    persistExplorerTimer = null
  }
  persistExplorerNow()
  window.removeEventListener('keydown', handleGlobalKeydown)
})

function normalizeCreateDirectory(basePath: string): string {
  const rootPath = root.value
  if (!rootPath) return ''

  const normalizedBase = normalizePath(String(basePath || '').trim())
  if (normalizedBase && withinWorkspace(normalizedBase)) {
    return normalizedBase
  }

  return activeCreateDir.value || rootPath
}

async function createNode(kind: CreateKind, basePath: string, name: string) {
  const rootPath = root.value
  if (!rootPath) throw new Error('No project selected')

  const trimmedName = String(name || '').trim()
  if (!trimmedName) {
    throw new Error(kind === 'createFile' ? 'Filename is required' : 'Folder name is required')
  }

  const targetDir = normalizeCreateDirectory(basePath)
  const target = joinPath(targetDir, trimmedName)

  if (kind === 'createFile') {
    await writeFile({ directory: rootPath, path: target, content: '' })
    toasts.push('success', 'File created')
  } else {
    await makeDirectory({ directory: rootPath, path: target })
    toasts.push('success', 'Folder created')
  }

  await refreshRoot()
}

async function createNodeFromExplorer(kind: CreateKind, basePath: string, name: string): Promise<boolean> {
  try {
    await createNode(kind, basePath, name)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
    return false
  }
}

async function renameNodePath(oldPath: string, nextName: string) {
  const rootPath = root.value
  if (!rootPath) throw new Error('No project selected')

  const trimmedName = String(nextName || '').trim()
  if (!trimmedName) throw new Error('Name is required')

  const parent = oldPath.split('/').slice(0, -1).join('/')
  const newPath = joinPath(parent || rootPath, trimmedName)
  await renamePath({ directory: rootPath, oldPath, newPath })

  const selectedDir = normalizePath(String(selectedDirectoryPath.value || '').trim())
  if (selectedDir === oldPath || selectedDir.startsWith(`${oldPath}/`)) {
    selectedDirectoryPath.value = selectedDir === oldPath ? newPath : `${newPath}${selectedDir.slice(oldPath.length)}`
  }

  if (selectedFile.value?.path === oldPath) {
    selectedFile.value = null
    viewerMode.value = 'none'
    fileContent.value = ''
    draftContent.value = ''
    fileError.value = null
    clearBlame()
    clearGitDiff()
    closeFileTimeline()
  }

  toasts.push('success', 'Renamed')
}

async function renameNodeFromExplorer(node: FileNode, nextName: string): Promise<boolean> {
  try {
    await renameNodePath(node.path, nextName)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
    return false
  }
}

function openDialog(kind: Exclude<DialogKind, null>, node?: FileNode) {
  activeDialog.value = kind
  dialogData.value = node
    ? { path: node.path, name: node.name, type: node.type }
    : { path: activeCreateDir.value || root.value, type: 'directory' }
  dialogInput.value = kind === 'rename' ? node?.name || '' : ''
  dialogSubmitting.value = false
}

function closeDialog() {
  activeDialog.value = null
  dialogData.value = null
  dialogInput.value = ''
}

async function handleDialogSubmit() {
  if (!activeDialog.value || !dialogData.value) return
  const rootPath = root.value
  if (!rootPath) return

  dialogSubmitting.value = true
  try {
    if (activeDialog.value === 'createFile' || activeDialog.value === 'createFolder') {
      await createNode(activeDialog.value, dialogData.value.path, dialogInput.value)
    }

    if (activeDialog.value === 'rename') {
      await renameNodePath(dialogData.value.path, dialogInput.value)
    }

    closeDialog()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
  } finally {
    dialogSubmitting.value = false
  }
}

async function deleteNode(node: FileNode) {
  const rootPath = root.value
  if (!rootPath) return
  const target = String(node?.path || '').trim()
  if (!target) return

  // Prevent rapid double-deletes from issuing multiple requests.
  if (deletingPaths.value.has(target)) return
  deletingPaths.value = new Set(deletingPaths.value).add(target)

  try {
    await deletePathApi({ directory: rootPath, path: target })

    const selectedDir = normalizePath(String(selectedDirectoryPath.value || '').trim())
    if (selectedDir === target || selectedDir.startsWith(`${target}/`)) {
      selectedDirectoryPath.value = ''
    }

    if (selectedFile.value?.path === target || selectedFile.value?.path.startsWith(`${target}/`)) {
      selectedFile.value = null
      viewerMode.value = 'none'
      fileContent.value = ''
      draftContent.value = ''
      fileError.value = null
      clearBlame()
      clearGitDiff()
      closeFileTimeline()
    }
    toasts.push('success', 'Deleted')
    await refreshRoot()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toasts.push('error', msg)
  } finally {
    const next = new Set(deletingPaths.value)
    next.delete(target)
    deletingPaths.value = next
  }
}

async function insertSelectionIntoChatComposer() {
  const sel = selection.value
  const path = selectedFile.value?.path
  const sessionId = chat.selectedSessionId
  if (!sel || !sel.text.trim() || !path) {
    toasts.push('error', 'Select some lines to insert')
    return
  }
  if (!sessionId) {
    toasts.push('error', 'Select a chat session first')
    return
  }

  const rel = displaySelectedPath.value || path
  const body = sel.text.trim()
  const language = languageForPath(path)
  let text = `File excerpt from ${rel} (L${sel.start}-${sel.end}):\n\n\`\`\`${language}\n${body}\n\`\`\``
  if (commentText.value.trim()) {
    text += `\n\n${commentText.value.trim()}`
  }
  const existing = chat.getComposerDraft(sessionId)
  const glued = existing && existing.trim() ? `${existing.replace(/\s+$/g, '')}\n\n${text}` : text
  chat.setComposerDraft(sessionId, glued)
  toasts.push('success', 'Inserted into chat composer')
  selection.value = null
  commentText.value = ''
}

async function discardAndContinue() {
  const next = pendingSelect.value
  pendingSelect.value = null
  confirmDiscardOpen.value = false
  draftContent.value = displayedContent.value
  if (next) {
    await openFile(next)
  }
}

async function saveAndContinue() {
  const next = pendingSelect.value
  pendingSelect.value = null
  confirmDiscardOpen.value = false
  const ok = await save()
  if (ok && next) {
    await openFile(next)
  }
}

async function restoreForRoot(next: string) {
  if (!pageMounted) return

  const seq = ++rootRestoreSeq
  openFileSeq += 1

  closeFileTimeline()

  selectedFile.value = null
  selectedDirectoryPath.value = ''
  viewerMode.value = 'none'
  fileContent.value = ''
  draftContent.value = ''
  fileLoading.value = false
  fileError.value = null
  selection.value = null
  commentText.value = ''
  searchResults.value = []
  searchQuery.value = ''
  contentSearchQuery.value = ''
  contentSearchReplace.value = ''
  contentSearchReplaceOpen.value = false
  contentSearchCaseSensitive.value = false
  contentSearchWholeWord.value = false
  contentSearchRegex.value = false
  contentSearchLoading.value = false
  contentSearchReplacing.value = false
  resetContentSearchResults()
  showMobileViewer.value = false
  clearBlame()
  clearGitDiff()
  expandedDirs.value = new Set()
  loadedDirs.value = new Set()
  inFlightDirs.value = new Set()
  entriesByDir.value = {}
  childrenByDir.value = {}
  if (!next) return

  const restored = restoreExplorerState(next)
  if (isStaleRootRestore(seq, next)) return
  if (!restored) {
    await loadDirectory(next, { force: true }).catch(() => {})
    return
  }

  // Ensure expanded directories are hydrated (cache may only include root).
  await loadDirectory(next).catch(() => {})
  if (isStaleRootRestore(seq, next)) return
  for (const d of Array.from(expandedDirs.value)) {
    const dir = normalizePath(String(d || '').trim())
    if (!dir || dir === next) continue
    if (!withinWorkspace(dir, next)) continue
    await loadDirectory(dir).catch(() => {})
    if (isStaleRootRestore(seq, next)) return
  }
}

watch(
  () => root.value,
  (next) => {
    if (!pageMounted) return
    void restoreForRoot(next)
  },
)

watch([showHidden, respectGitignore], () => {
  if (root.value) {
    void refreshRoot()
  }
})

watch(
  () => searchQuery.value,
  (q) => {
    if (!q.trim()) {
      searchResults.value = []
      searching.value = false
    }
  },
)

watch(
  () => contentSearchQuery.value,
  (q) => {
    if (!q.trim()) {
      contentSearchLoading.value = false
      resetContentSearchResults()
    }
  },
)

onMounted(async () => {
  pageMounted = true
  await nextTick()
  await restoreForRoot(root.value).catch(() => {})
  if (!chat.sessions.length) {
    await chat.refreshSessions().catch(() => {})
  }
})
</script>

<template>
  <section class="h-full flex flex-col overflow-hidden m-0 p-0">
    <ConfirmPopover
      :open="confirmDiscardOpen"
      title="Unsaved changes"
      description="Save your edits before continuing?"
      confirm-text="Discard"
      cancel-text="Save changes"
      variant="destructive"
      :confirm-disabled="isSaving"
      :cancel-disabled="isSaving"
      @update:open="
        (v) => {
          if (!v) {
            confirmDiscardOpen = false
            pendingSelect = null
          }
        }
      "
      @cancel="saveAndContinue"
      @confirm="discardAndContinue"
    />

    <FormDialog
      :open="activeDialog !== null"
      :title="dialogTitle"
      :description="dialogDescription"
      @update:open="
        (v) => {
          if (!v) closeDialog()
        }
      "
    >
      <div class="space-y-3">
        <Input v-model="dialogInput" placeholder="Name" class="h-9 font-mono" />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" @click="closeDialog" :disabled="dialogSubmitting">Cancel</Button>
          <Button @click="handleDialogSubmit" :disabled="dialogSubmitting || !dialogInput.trim()">
            {{ dialogSubmitting ? 'Working...' : 'Confirm' }}
          </Button>
        </div>
      </div>
    </FormDialog>

    <div class="flex-1 min-h-0 m-0 p-0">
      <div v-if="!root" class="h-full">
        <div v-if="isMobile && ui.isSessionSwitcherOpen" class="h-full p-3">
          <div class="rounded-sm border border-sidebar-border/60 bg-sidebar-accent/10 p-3">
            <div class="text-sm font-medium">No Project Selected</div>
            <div class="mt-1 text-xs text-muted-foreground">
              Choose a project folder first, then the file tree will appear here.
            </div>
          </div>
        </div>
        <div v-else class="h-full grid place-items-center text-muted-foreground typography-meta">
          Select a project (or a session) to browse files.
        </div>
      </div>

      <div v-else class="h-full m-0 p-0">
        <div class="flex h-full min-h-0 flex-col m-0 p-0">
          <div class="flex min-h-0 flex-1 gap-0" :class="isMobile ? 'flex-col' : ''">
            <div
              class="relative min-h-0 overflow-hidden m-0 p-0"
              :class="isMobile ? 'flex-1' : 'flex-shrink-0'"
              :style="isMobile ? undefined : { width: `${ui.sidebarWidth}px` }"
              v-show="showFilesSidebar"
            >
              <div
                v-if="!isMobile"
                class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
                @pointerdown="startDesktopSidebarResize"
              />
              <FilesExplorerPane
                v-model:view-mode="explorerSidebarMode"
                v-model:showHidden="showHidden"
                v-model:showGitignored="showGitignored"
                :root="root"
                :is-mobile="isMobile"
                :selected-file-path="highlightedPath || selectedDirectoryPath || selectedFile?.path || ''"
                :has-root-children="hasRootChildren"
                :flattened-tree="flattenedTree"
                :deleting-paths="deletingPaths"
                :uploading="uploading"
                :handle-node-click="handleNodeClick"
                :refresh-root="refreshRoot"
                :collapse-all="collapseAllDirectories"
                :active-create-dir="activeCreateDir"
                :expand-directory="ensureDirectoryExpanded"
                :create-node="createNodeFromExplorer"
                :rename-node="renameNodeFromExplorer"
                :run-file-action="runExplorerFileAction"
                :open-dialog="openDialog"
                :delete-node="deleteNode"
                :upload-files="uploadFilesToDirectory"
              >
                <template #search>
                  <div class="flex min-h-0 flex-1 flex-col">
                    <div class="border-b border-sidebar-border/40 px-2 py-1.5">
                      <SegmentedControl class="grid-cols-2">
                        <SegmentedButton
                          :active="explorerSearchMode === 'files'"
                          size="xs"
                          class="rounded-sm"
                          @click="explorerSearchMode = 'files'"
                        >
                          Files
                        </SegmentedButton>
                        <SegmentedButton
                          :active="explorerSearchMode === 'content'"
                          size="xs"
                          class="rounded-sm"
                          @click="explorerSearchMode = 'content'"
                        >
                          Content
                        </SegmentedButton>
                      </SegmentedControl>

                      <div class="mt-2 space-y-1.5">
                        <template v-if="explorerSearchMode === 'files'">
                          <div class="flex items-center gap-1">
                            <Input
                              v-model="searchQuery"
                              placeholder="Search files"
                              class="oc-vscode-subtle-input h-[26px] flex-1 font-mono text-[12px]"
                              @keydown.enter.prevent="runSearch"
                            />
                            <Button
                              size="sm"
                              class="h-[26px] px-2 text-[11px]"
                              :disabled="searching || !hasFileSearch"
                              @click="runSearch"
                            >
                              {{ searching ? '...' : 'Search' }}
                            </Button>
                            <SidebarIconButton
                              title="Clear"
                              aria-label="Clear"
                              :disabled="!hasFileSearch"
                              @click="clearFileSearch"
                            >
                              x
                            </SidebarIconButton>
                          </div>
                          <div class="px-0.5 text-[11px] text-muted-foreground">
                            <span v-if="!hasFileSearch">Type to search file names and paths.</span>
                            <span v-else-if="searching">Searching...</span>
                            <span v-else
                              >{{ searchResults.length }} result{{ searchResults.length === 1 ? '' : 's' }}</span
                            >
                          </div>
                        </template>

                        <template v-else>
                          <div class="relative">
                            <button
                              type="button"
                              class="absolute left-0 top-0 inline-flex h-[26px] w-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground transition hover:bg-sidebar-accent/70 hover:text-foreground"
                              :title="contentSearchReplaceOpen ? 'Hide replace' : 'Show replace'"
                              :aria-label="contentSearchReplaceOpen ? 'Hide replace' : 'Show replace'"
                              @click="contentSearchReplaceOpen = !contentSearchReplaceOpen"
                            >
                              {{ contentSearchReplaceOpen ? 'v' : '>' }}
                            </button>

                            <div class="ml-[18px] flex items-center gap-1">
                              <Input
                                v-model="contentSearchQuery"
                                placeholder="Search"
                                class="oc-vscode-subtle-input h-[26px] flex-1 font-mono text-[12px]"
                                @keydown.enter.prevent="runContentSearch"
                              />
                              <Button
                                size="sm"
                                class="h-[26px] px-2 text-[11px]"
                                :disabled="contentSearchLoading || contentSearchReplacing || !hasContentSearch"
                                @click="runContentSearch"
                              >
                                {{ contentSearchLoading ? '...' : 'Search' }}
                              </Button>
                              <SidebarIconButton
                                title="Clear"
                                aria-label="Clear"
                                :disabled="!hasContentSearch"
                                @click="clearContentSearch"
                              >
                                x
                              </SidebarIconButton>
                              <button
                                type="button"
                                class="h-6 w-6 rounded-sm border text-[10px] font-mono transition"
                                :class="
                                  contentSearchCaseSensitive
                                    ? 'border-sidebar-border bg-sidebar-accent/80 text-foreground'
                                    : 'border-sidebar-border/60 bg-sidebar-accent/25 text-muted-foreground hover:text-foreground'
                                "
                                title="Match case"
                                @click="contentSearchCaseSensitive = !contentSearchCaseSensitive"
                              >
                                Aa
                              </button>
                              <button
                                type="button"
                                class="h-6 w-6 rounded-sm border text-[10px] font-mono transition"
                                :class="
                                  contentSearchWholeWord
                                    ? 'border-sidebar-border bg-sidebar-accent/80 text-foreground'
                                    : 'border-sidebar-border/60 bg-sidebar-accent/25 text-muted-foreground hover:text-foreground'
                                "
                                title="Match whole word"
                                @click="contentSearchWholeWord = !contentSearchWholeWord"
                              >
                                W
                              </button>
                              <button
                                type="button"
                                class="h-6 w-6 rounded-sm border text-[10px] font-mono transition"
                                :class="
                                  contentSearchRegex
                                    ? 'border-sidebar-border bg-sidebar-accent/80 text-foreground'
                                    : 'border-sidebar-border/60 bg-sidebar-accent/25 text-muted-foreground hover:text-foreground'
                                "
                                title="Use regular expression"
                                @click="contentSearchRegex = !contentSearchRegex"
                              >
                                .*
                              </button>
                            </div>
                          </div>

                          <div v-if="contentSearchReplaceOpen" class="ml-[18px] flex items-center gap-1">
                            <Input
                              v-model="contentSearchReplace"
                              placeholder="Replace"
                              class="oc-vscode-subtle-input h-[26px] flex-1 font-mono text-[12px]"
                            />
                            <Button
                              size="sm"
                              class="h-[26px] px-2 text-[11px]"
                              :disabled="
                                contentSearchReplacing ||
                                contentSearchLoading ||
                                !hasContentSearch ||
                                contentSearchMatchCount === 0
                              "
                              @click="replaceAllContentSearchMatches"
                            >
                              {{ contentSearchReplacing ? '...' : 'All' }}
                            </Button>
                          </div>

                          <div class="ml-[18px] px-0.5 text-[11px] text-muted-foreground">
                            <span>{{ contentSearchSummary }}</span>
                            <span v-if="activeContentSearchScope" class="ml-1"
                              >in {{ activeContentSearchScope.description }}</span
                            >
                          </div>

                          <div class="ml-[18px] flex flex-wrap items-center gap-1">
                            <button
                              v-for="scope in contentSearchScopeOptions"
                              :key="scope.id"
                              type="button"
                              class="h-5 rounded-sm border px-1.5 text-[10px] font-medium transition"
                              :class="
                                contentSearchScopeMode === scope.id
                                  ? 'border-sidebar-border bg-sidebar-accent/80 text-foreground'
                                  : 'border-sidebar-border/60 bg-sidebar-accent/25 text-muted-foreground hover:text-foreground'
                              "
                              :title="scope.description"
                              :disabled="scope.disabled"
                              @click="contentSearchScopeMode = scope.id"
                            >
                              {{ scope.label }}
                            </button>
                          </div>
                        </template>
                      </div>
                    </div>

                    <ScrollArea class="min-h-0 flex-1">
                      <div class="px-1 py-1">
                        <template v-if="explorerSearchMode === 'files'">
                          <div v-if="!hasFileSearch" class="px-2 py-2 text-xs text-muted-foreground">
                            No search query.
                          </div>
                          <div v-else-if="searching" class="px-2 py-2 text-xs text-muted-foreground">Searching...</div>
                          <div v-else-if="searchResults.length === 0" class="px-2 py-2 text-xs text-muted-foreground">
                            No files found.
                          </div>
                          <div v-else class="space-y-0.5">
                            <button
                              v-for="node in searchResults"
                              :key="node.path"
                              type="button"
                              class="oc-vscode-row h-[22px] w-full border-transparent px-2 text-left"
                              @click="requestFileSelect(node)"
                            >
                              <span class="truncate font-mono text-[11px]" :title="node.path">{{
                                node.relativePath || node.path
                              }}</span>
                            </button>
                          </div>
                        </template>

                        <template v-else>
                          <div
                            v-if="contentSearchError"
                            class="mx-1 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs"
                          >
                            {{ contentSearchError }}
                          </div>
                          <div v-if="!hasContentSearch" class="px-2 py-2 text-xs text-muted-foreground">
                            Type to search in file contents.
                          </div>
                          <div
                            v-else-if="contentSearchLoading && !contentSearchFiles.length"
                            class="px-2 py-2 text-xs text-muted-foreground"
                          >
                            Searching...
                          </div>
                          <div v-else-if="!contentSearchFiles.length" class="px-2 py-2 text-xs text-muted-foreground">
                            No matches found.
                          </div>
                          <div v-else class="space-y-0">
                            <div
                              v-for="file in contentSearchFiles"
                              :key="file.path"
                              class="border-t border-sidebar-border/30 first:border-t-0"
                            >
                              <div class="flex items-center justify-between gap-2 px-2 py-0.5">
                                <button
                                  type="button"
                                  class="oc-vscode-row h-[22px] min-w-0 flex-1 border-transparent px-1"
                                  :title="file.path"
                                  @click="openContentSearchResult(file.path)"
                                >
                                  <span class="truncate font-mono text-[11px]">{{ file.relativePath }}</span>
                                </button>
                                <span class="oc-vscode-count-badge">{{ file.matchCount }}</span>
                              </div>
                              <div class="pb-0.5">
                                <div
                                  v-for="match in file.matches"
                                  :key="`${file.path}:${match.startOffset}:${match.endOffset}`"
                                  class="flex items-center gap-1 pl-2 pr-1"
                                >
                                  <button
                                    type="button"
                                    class="oc-vscode-row h-[22px] min-w-0 flex-1 border-transparent px-1"
                                    @click="openContentSearchResult(file.path)"
                                  >
                                    <span class="w-10 shrink-0 pr-1 text-right text-[10px] text-muted-foreground">{{
                                      match.line
                                    }}</span>
                                    <span class="min-w-0 truncate font-mono text-[11px]">
                                      <span class="text-muted-foreground">{{ match.before }}</span>
                                      <span
                                        class="rounded-sm border border-primary/35 bg-primary/20 px-0.5 text-foreground"
                                        >{{ match.matched }}</span
                                      >
                                      <span class="text-muted-foreground">{{ match.after }}</span>
                                    </span>
                                  </button>
                                  <button
                                    v-if="contentSearchReplaceOpen"
                                    type="button"
                                    class="oc-vscode-icon-button h-5 w-12 text-[10px]"
                                    :disabled="contentSearchReplacing"
                                    @click="replaceContentSearchMatch(file, match)"
                                  >
                                    Replace
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </template>
                      </div>
                    </ScrollArea>
                  </div>
                </template>
              </FilesExplorerPane>
            </div>

            <div class="flex-1 min-h-0 overflow-hidden m-0 p-0" v-show="!isMobile || !ui.isSessionSwitcherOpen">
              <FileViewerPane
                v-model:showMobileViewer="showMobileViewer"
                v-model:autoSaveEnabled="autoSaveEnabled"
                v-model:wrapLines="wrapLines"
                v-model:draftContent="draftContent"
                v-model:selection="selection"
                v-model:commentText="commentText"
                :is-mobile="isMobile"
                :selected-file="selectedFile"
                :display-selected-path="displaySelectedPath"
                :viewer-mode="viewerMode"
                :can-edit="canEdit"
                :dirty="dirty"
                :is-saving="isSaving"
                :displayed-content="displayedContent"
                :raw-url="rawUrl"
                :open-raw="openSelectedFileRaw"
                :selected-path="selectedPath"
                :file-loading="fileLoading"
                :file-error="fileError"
                :file-status-label="fileStatusLabel"
                :blame-enabled="blameEnabled"
                :blame-loading="blameLoading"
                :blame-error="blameError"
                :blame-lines="blameLines"
                :timeline-enabled="fileTimelineEnabled"
                :timeline-path="fileTimelinePath"
                :timeline-loading="fileTimelineLoading"
                :timeline-error="fileTimelineError"
                :timeline-commits="fileTimelineCommits"
                :timeline-has-more="fileTimelineHasMore"
                :timeline-left-commit="fileTimelineLeftCommit"
                :timeline-left-content="fileTimelineLeftContent"
                :timeline-left-loading="fileTimelineLeftLoading"
                :timeline-left-error="fileTimelineLeftError"
                :timeline-right-commit="fileTimelineRightCommit"
                :timeline-right-content="fileTimelineRightContent"
                :timeline-right-loading="fileTimelineRightLoading"
                :timeline-right-error="fileTimelineRightError"
                :git-inline-enabled="gitInlineEnabled"
                :git-diff-loading="gitDiffLoading"
                :git-diff-error="gitDiffError"
                :git-diff-text="gitDiffText"
                :git-diff-meta="gitDiffMeta"
                :git-diff-mode="gitDiffMode"
                :git-patch-busy="gitPatchBusy"
                :toggle-blame="toggleBlame"
                :reload-blame="reloadBlame"
                :toggle-git-inline="toggleGitInline"
                :toggle-git-diff-mode="toggleGitDiffMode"
                :apply-git-patch="applyGitPatch"
                :load-more-timeline="loadMoreFileTimeline"
                :select-timeline-commit="selectFileTimelineCommit"
                :open-timeline="openFileTimeline"
                :open-sidebar="() => ui.setSessionSwitcherOpen(true)"
                :save="() => save()"
                :copy-to-clipboard="copyToClipboard"
                @insert-selection="insertSelectionIntoChatComposer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
