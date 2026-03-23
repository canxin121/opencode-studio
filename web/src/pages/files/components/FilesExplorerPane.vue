<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownload2Line,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileAddLine,
  RiFileCopy2Line,
  RiFolder3Fill,
  RiFolderAddLine,
  RiFolderOpenFill,
  RiGitBranchLine,
  RiListCheck3,
  RiLoader4Line,
  RiMore2Line,
  RiRefreshLine,
  RiUpload2Line,
} from '@remixicon/vue'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import ListItemSelectionIndicator from '@/components/ui/ListItemSelectionIndicator.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import { fileIconClass, fileIconComponent } from '../fileKinds'
import type { DialogKind, FileNode, FlatRow } from '../types'

type ExplorerViewMode = 'tree' | 'search'
type InlineCreateKind = 'createFile' | 'createFolder'
type FileActionId = 'download' | 'copy-path' | 'copy-absolute-path'
type NodeClickModifiers = { toggle: boolean; range: boolean }
type ExplorerTreeRow =
  | { kind: 'node'; key: string; row: FlatRow }
  | { kind: 'inline-create'; key: '__inline-create__'; depth: number; createKind: InlineCreateKind }

const viewMode = defineModel<ExplorerViewMode>('viewMode', { default: 'tree' })
const showHidden = defineModel<boolean>('showHidden', { default: false })
const showGitignored = defineModel<boolean>('showGitignored', { default: false })

const props = defineProps<{
  root: string
  isCompactLayout: boolean
  isMobileFormFactor?: boolean
  isMobilePointer?: boolean
  selectedFilePath: string
  activeCreateDir: string
  hasRootChildren: boolean
  flattenedTree: FlatRow[]
  deletingPaths: Set<string>
  selectedPaths: Set<string>
  multiSelectEnabled: boolean
  uploading: boolean
  toggleMultiSelectMode: () => void
  selectAllVisibleNodes: () => void | Promise<void>
  invertVisibleNodeSelection: () => void | Promise<void>
  handleNodeClick: (node: FileNode, modifiers: NodeClickModifiers) => void | Promise<void>
  handleNodeLongPress: (node: FileNode) => void | Promise<void>
  refreshRoot: () => void | Promise<void>
  collapseAll: () => void
  expandDirectory: (dirPath: string) => void | Promise<void>
  createNode: (kind: InlineCreateKind, basePath: string, name: string) => Promise<boolean>
  renameNode: (node: FileNode, name: string) => Promise<boolean>
  moveNodeByDrag: (sourcePath: string, targetDir: string) => Promise<boolean>
  runFileAction: (action: FileActionId, node: FileNode) => void | Promise<void>
  openDialog: (kind: Exclude<DialogKind, null>, node?: FileNode) => void
  deleteNode: (node: FileNode) => void | Promise<void>
  deleteSelectedNodes: (paths: string[]) => void | Promise<void>
  openMoveSelectedDialog: (paths: string[]) => void | Promise<void>
  clearSelectedPaths: () => void
  uploadFiles: (files: readonly File[], targetDir?: string) => void | Promise<void>
}>()

const isMobileFormFactor = computed(() => Boolean(props.isMobileFormFactor ?? props.isMobilePointer))

const uploadInputRef = ref<HTMLInputElement | null>(null)
const dropTargetDir = ref('')
const rootDropActive = ref(false)
const actionMenuOpen = ref(false)
const actionMenuQuery = ref('')
const fileActionMenuPath = ref('')
const fileActionMenuQuery = ref('')
const inlineCreateKind = ref<InlineCreateKind | null>(null)
const inlineCreateParentPath = ref('')
const inlineCreateName = ref('')
const inlineCreateBusy = ref(false)
const inlineCreateInputRef = ref<HTMLInputElement | null>(null)

const { t } = useI18n()
const inlineRenamePath = ref('')
const inlineRenameName = ref('')
const inlineRenameBusy = ref(false)
const inlineRenameInputRef = ref<HTMLInputElement | null>(null)
const LONG_PRESS_DELAY_TOUCH_MS = 420
const LONG_PRESS_DELAY_POINTER_MS = 540
const LONG_PRESS_MOVE_TOLERANCE_PX = 8
const DRAG_CANCEL_FEEDBACK_MS = 180
const DRAG_SUCCESS_FEEDBACK_MS = 320
const DRAG_AUTO_EXPAND_DELAY_MS = 680

type LongPressState = {
  pointerId: number
  startX: number
  startY: number
  node: FileNode
  triggered: boolean
}

const longPressState = ref<LongPressState | null>(null)
const longPressTimer = ref<number | null>(null)
const suppressClickPath = ref('')
const suppressClickUntil = ref(0)
const moveDropTargetDir = ref('')
const moveRootDropActive = ref(false)
const dragSourcePath = ref('')
const dragFeedbackPath = ref('')
const dragFeedbackKind = ref<'invalid' | 'success' | ''>('')
const dragHoverExpandTimer = ref<number | null>(null)
const dragHoverExpandPath = ref('')

type DragSession = {
  pointerId: number
  node: FileNode
  sourcePath: string
  sourceParentDir: string
  currentX: number
  currentY: number
  targetDir: string
  targetDirectoryPath: string
  validTarget: boolean
}

const dragSession = ref<DragSession | null>(null)

async function setActionMenuOpen(next: boolean) {
  if (!next) {
    actionMenuOpen.value = false
    actionMenuQuery.value = ''
    return
  }

  if (fileActionMenuPath.value) {
    fileActionMenuPath.value = ''
    await nextTick()
  }

  actionMenuOpen.value = true
  actionMenuQuery.value = ''
}

function toggleActionMenu() {
  void setActionMenuOpen(!actionMenuOpen.value)
}

async function setFileActionMenuOpen(path: string, open: boolean) {
  const targetPath = String(path || '').trim()
  if (!targetPath) {
    fileActionMenuPath.value = ''
    fileActionMenuQuery.value = ''
    return
  }

  if (!open) {
    if (fileActionMenuPath.value === targetPath) fileActionMenuPath.value = ''
    fileActionMenuQuery.value = ''
    return
  }

  if (fileActionMenuPath.value === targetPath) return

  const shouldWait = Boolean(fileActionMenuPath.value) || actionMenuOpen.value
  if (fileActionMenuPath.value) fileActionMenuPath.value = ''
  if (actionMenuOpen.value) actionMenuOpen.value = false
  if (shouldWait) await nextTick()

  fileActionMenuPath.value = targetPath
  fileActionMenuQuery.value = ''
}

const selectedDirectoryNode = computed<FileNode | null>(() => {
  const selectedPath = (props.selectedFilePath || '').trim()
  if (!selectedPath) return null
  const fromTree = props.flattenedTree.find((row) => row.node.path === selectedPath)?.node
  return fromTree?.type === 'directory' ? fromTree : null
})

const selectedCount = computed(() => props.selectedPaths.size)
const selectableRowCount = computed(() => props.flattenedTree.length)
const hasDeletingSelected = computed(() =>
  Array.from(props.selectedPaths).some((path) => props.deletingPaths.has(path)),
)

function isNodeSelected(path: string): boolean {
  return props.selectedPaths.has(path)
}

const inlineCreateDepth = computed(() => {
  const kind = inlineCreateKind.value
  if (!kind) return 0

  const parentPath = inlineCreateParentPath.value
  if (!parentPath || parentPath === props.root) return 0
  const parentRow = props.flattenedTree.find((row) => row.node.type === 'directory' && row.node.path === parentPath)
  return parentRow ? parentRow.depth + 1 : 0
})

const treeRows = computed<ExplorerTreeRow[]>(() => {
  const baseRows: ExplorerTreeRow[] = props.flattenedTree.map((row) => ({
    kind: 'node',
    key: row.node.path,
    row,
  }))

  const kind = inlineCreateKind.value
  if (!kind) return baseRows

  const parentPath = inlineCreateParentPath.value
  let insertIndex = 0
  if (parentPath && parentPath !== props.root) {
    const parentIndex = baseRows.findIndex(
      (entry) => entry.kind === 'node' && entry.row.node.type === 'directory' && entry.row.node.path === parentPath,
    )
    if (parentIndex >= 0) {
      insertIndex = parentIndex + 1
    }
  }

  baseRows.splice(insertIndex, 0, {
    kind: 'inline-create',
    key: '__inline-create__',
    depth: inlineCreateDepth.value,
    createKind: kind,
  })

  return baseRows
})

function normalizePath(path: string): string {
  const raw = String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
  if (!raw) return ''
  if (raw === '/') return raw
  return raw.replace(/\/+$/g, '')
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  if (!normalized || normalized === '/') return ''
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return ''
  return normalized.slice(0, index)
}

function rowForPath(path: string): FlatRow | null {
  return props.flattenedTree.find((row) => row.node.path === path) || null
}

function clearDragHoverExpandTimer() {
  if (dragHoverExpandTimer.value !== null) {
    window.clearTimeout(dragHoverExpandTimer.value)
    dragHoverExpandTimer.value = null
  }
  dragHoverExpandPath.value = ''
}

function clearDragFeedback() {
  dragFeedbackPath.value = ''
  dragFeedbackKind.value = ''
}

function clearDragSession() {
  dragSession.value = null
  dragSourcePath.value = ''
  moveDropTargetDir.value = ''
  moveRootDropActive.value = false
  clearDragHoverExpandTimer()
}

function queueDirectoryAutoExpand(path: string) {
  const targetPath = normalizePath(path)
  if (!targetPath || targetPath === dragHoverExpandPath.value) return

  clearDragHoverExpandTimer()
  dragHoverExpandPath.value = targetPath
  dragHoverExpandTimer.value = window.setTimeout(() => {
    const row = rowForPath(targetPath)
    if (!row || row.node.type !== 'directory' || row.isExpanded || row.isLoading) return
    void props.expandDirectory(targetPath)
  }, DRAG_AUTO_EXPAND_DELAY_MS)
}

function resolveDragTarget(
  clientX: number,
  clientY: number,
): {
  targetDir: string
  targetDirectoryPath: string
  overExplorer: boolean
} {
  const target = document.elementFromPoint(clientX, clientY)
  const element = target instanceof Element ? target : null
  const overExplorer = Boolean(element?.closest('[data-explorer-tree="true"]'))
  if (!overExplorer) {
    return { targetDir: '', targetDirectoryPath: '', overExplorer: false }
  }

  const rowElement = element?.closest<HTMLElement>('[data-node-path]')
  if (!rowElement) {
    return { targetDir: props.root, targetDirectoryPath: '', overExplorer: true }
  }

  const rowPath = normalizePath(String(rowElement.dataset.nodePath || '').trim())
  const rowType = String(rowElement.dataset.nodeType || '')
  if (!rowPath) {
    return { targetDir: props.root, targetDirectoryPath: '', overExplorer: true }
  }

  if (rowType === 'directory') {
    return { targetDir: rowPath, targetDirectoryPath: rowPath, overExplorer: true }
  }

  const parent = dirname(rowPath)
  const targetDir = parent || props.root
  return { targetDir, targetDirectoryPath: targetDir, overExplorer: true }
}

function isValidMoveTarget(session: DragSession, targetDir: string): boolean {
  const normalizedTarget = normalizePath(targetDir)
  if (!normalizedTarget) return false
  if (normalizedTarget === session.sourceParentDir) return false
  if (normalizedTarget === session.sourcePath) return false
  if (session.node.type === 'directory' && normalizedTarget.startsWith(`${session.sourcePath}/`)) return false
  return true
}

function updateDragTarget(clientX: number, clientY: number) {
  const session = dragSession.value
  if (!session) return

  const nextTarget = resolveDragTarget(clientX, clientY)
  session.currentX = clientX
  session.currentY = clientY
  session.targetDir = nextTarget.targetDir
  session.targetDirectoryPath = nextTarget.targetDirectoryPath
  session.validTarget = nextTarget.overExplorer && isValidMoveTarget(session, nextTarget.targetDir)

  moveDropTargetDir.value = session.validTarget ? session.targetDirectoryPath : ''
  moveRootDropActive.value = session.validTarget && session.targetDir === props.root

  if (session.validTarget && session.targetDirectoryPath && session.targetDirectoryPath !== session.sourcePath) {
    queueDirectoryAutoExpand(session.targetDirectoryPath)
  } else {
    clearDragHoverExpandTimer()
  }
}

function flashDragFeedback(kind: 'invalid' | 'success', path: string) {
  dragFeedbackKind.value = kind
  dragFeedbackPath.value = path
  const duration = kind === 'success' ? DRAG_SUCCESS_FEEDBACK_MS : DRAG_CANCEL_FEEDBACK_MS
  window.setTimeout(() => {
    if (dragFeedbackPath.value === path && dragFeedbackKind.value === kind) {
      clearDragFeedback()
    }
  }, duration)
}

function resetInlineCreate() {
  inlineCreateKind.value = null
  inlineCreateParentPath.value = ''
  inlineCreateName.value = ''
  inlineCreateBusy.value = false
}

function resetInlineRename() {
  inlineRenamePath.value = ''
  inlineRenameName.value = ''
  inlineRenameBusy.value = false
}

function setInlineCreateInputRef(el: Element | ComponentPublicInstance | null) {
  const raw = el instanceof Element ? el : el && '$el' in el ? (el.$el as Element | null) : null
  inlineCreateInputRef.value = raw instanceof HTMLInputElement ? raw : null
}

function setInlineRenameInputRef(el: Element | ComponentPublicInstance | null) {
  const raw = el instanceof Element ? el : el && '$el' in el ? (el.$el as Element | null) : null
  inlineRenameInputRef.value = raw instanceof HTMLInputElement ? raw : null
}

function isWithinInlineCreate(target: Node | null): boolean {
  if (!target) return false
  const element = target instanceof Element ? target : target.parentElement
  if (!element) return false
  return Boolean(element.closest('[data-inline-create-root="true"]'))
}

function isWithinInlineRename(target: Node | null): boolean {
  if (!target) return false
  const element = target instanceof Element ? target : target.parentElement
  if (!element) return false
  return Boolean(element.closest('[data-inline-rename-root="true"]'))
}

async function startCreate(kind: InlineCreateKind) {
  if (props.isCompactLayout) {
    props.openDialog(kind, selectedDirectoryNode.value || undefined)
    return
  }

  viewMode.value = 'tree'
  actionMenuOpen.value = false
  if (inlineRenamePath.value && !inlineRenameBusy.value) {
    resetInlineRename()
  }
  const target = normalizePath(props.activeCreateDir || props.root)
  if (!target) return

  inlineCreateKind.value = kind
  inlineCreateParentPath.value = target
  inlineCreateName.value = ''
  inlineCreateBusy.value = false

  await props.expandDirectory(target)
  await nextTick()
  inlineCreateInputRef.value?.focus()
  inlineCreateInputRef.value?.select()
}

async function startRename(node: FileNode) {
  if (props.isCompactLayout) {
    props.openDialog('rename', node)
    return
  }

  viewMode.value = 'tree'
  actionMenuOpen.value = false
  fileActionMenuPath.value = ''
  if (inlineCreateKind.value && !inlineCreateBusy.value) {
    resetInlineCreate()
  }

  inlineRenamePath.value = node.path
  inlineRenameName.value = node.name
  inlineRenameBusy.value = false

  await nextTick()
  inlineRenameInputRef.value?.focus()
  inlineRenameInputRef.value?.select()
}

async function submitInlineCreate() {
  const kind = inlineCreateKind.value
  if (!kind || inlineCreateBusy.value) return

  const name = inlineCreateName.value.trim()
  if (!name) {
    inlineCreateInputRef.value?.focus()
    return
  }

  inlineCreateBusy.value = true
  try {
    const ok = await props.createNode(kind, inlineCreateParentPath.value || props.root, name)
    if (ok) {
      resetInlineCreate()
    }
  } finally {
    inlineCreateBusy.value = false
    if (inlineCreateKind.value) {
      await nextTick()
      inlineCreateInputRef.value?.focus()
      inlineCreateInputRef.value?.select()
    }
  }
}

async function submitInlineRename(node: FileNode) {
  if (inlineRenameBusy.value) return
  if (inlineRenamePath.value !== node.path) return

  const name = inlineRenameName.value.trim()
  if (!name) {
    inlineRenameInputRef.value?.focus()
    return
  }

  inlineRenameBusy.value = true
  try {
    const ok = await props.renameNode(node, name)
    if (ok) {
      resetInlineRename()
    }
  } finally {
    inlineRenameBusy.value = false
    if (inlineRenamePath.value === node.path) {
      await nextTick()
      inlineRenameInputRef.value?.focus()
      inlineRenameInputRef.value?.select()
    }
  }
}

async function handleTreeNodeClick(ev: MouseEvent, node: FileNode) {
  if (suppressClickPath.value === node.path && Date.now() < suppressClickUntil.value) {
    ev.preventDefault()
    ev.stopPropagation()
    return
  }

  if (inlineCreateKind.value && !inlineCreateBusy.value) {
    resetInlineCreate()
  }
  if (inlineRenamePath.value && !inlineRenameBusy.value) {
    resetInlineRename()
  }
  if (fileActionMenuPath.value) {
    fileActionMenuPath.value = ''
  }
  await props.handleNodeClick(node, {
    toggle: ev.metaKey || ev.ctrlKey,
    range: ev.shiftKey,
  })
}

function clearLongPressTimer() {
  if (longPressTimer.value !== null) {
    window.clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
}

function removeLongPressListeners() {
  window.removeEventListener('pointermove', onLongPressPointerMove, true)
  window.removeEventListener('pointerup', onLongPressPointerUp, true)
  window.removeEventListener('pointercancel', onLongPressPointerCancel, true)
}

function resetLongPressState() {
  clearLongPressTimer()
  removeLongPressListeners()
  longPressState.value = null
}

function shouldIgnoreLongPressTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [role="button"], [data-file-action-root="true"], [data-inline-create-root="true"], [data-inline-rename-root="true"]',
    ),
  )
}

function onLongPressPointerMove(ev: PointerEvent) {
  const state = longPressState.value
  if (!state || state.pointerId !== ev.pointerId) return

  if (state.triggered && dragSession.value?.pointerId === ev.pointerId) {
    ev.preventDefault()
    updateDragTarget(ev.clientX, ev.clientY)
    return
  }

  const deltaX = ev.clientX - state.startX
  const deltaY = ev.clientY - state.startY
  if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
    resetLongPressState()
  }
}

async function onLongPressPointerUp(ev: PointerEvent) {
  const state = longPressState.value
  if (!state || state.pointerId !== ev.pointerId) return

  const activeDrag = dragSession.value
  if (state.triggered && activeDrag?.pointerId === ev.pointerId) {
    const sourcePath = activeDrag.sourcePath
    const targetDir = activeDrag.targetDir
    const targetPath = activeDrag.targetDirectoryPath
    const canDrop = activeDrag.validTarget && Boolean(targetDir)

    resetLongPressState()

    if (!canDrop) {
      flashDragFeedback('invalid', targetPath || sourcePath)
      clearDragSession()
      return
    }

    const moved = await props.moveNodeByDrag(sourcePath, targetDir)
    if (moved) {
      flashDragFeedback('success', targetPath || targetDir)
    } else {
      flashDragFeedback('invalid', targetPath || sourcePath)
    }
    clearDragSession()
    return
  }

  resetLongPressState()
}

function onLongPressPointerCancel(ev: PointerEvent) {
  const state = longPressState.value
  if (!state || state.pointerId !== ev.pointerId) return

  if (state.triggered && dragSession.value?.pointerId === ev.pointerId) {
    flashDragFeedback('invalid', dragSession.value.targetDirectoryPath || dragSession.value.sourcePath)
    clearDragSession()
  }

  resetLongPressState()
}

function onRowPointerDown(ev: PointerEvent, node: FileNode) {
  if (ev.button !== 0) return
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return
  if (shouldIgnoreLongPressTarget(ev.target)) return

  resetLongPressState()
  clearDragFeedback()
  longPressState.value = {
    pointerId: ev.pointerId,
    startX: ev.clientX,
    startY: ev.clientY,
    node,
    triggered: false,
  }

  const delay = ev.pointerType === 'touch' ? LONG_PRESS_DELAY_TOUCH_MS : LONG_PRESS_DELAY_POINTER_MS
  longPressTimer.value = window.setTimeout(() => {
    const state = longPressState.value
    if (!state || state.pointerId !== ev.pointerId || state.triggered) return
    state.triggered = true
    suppressClickPath.value = state.node.path
    suppressClickUntil.value = Date.now() + 650
    void props.handleNodeLongPress(state.node)

    if (!props.isCompactLayout && ev.pointerType !== 'touch') {
      const sourcePath = normalizePath(String(state.node.path || '').trim())
      const sourceParentDir = dirname(sourcePath) || props.root
      dragSourcePath.value = sourcePath
      dragSession.value = {
        pointerId: state.pointerId,
        node: state.node,
        sourcePath,
        sourceParentDir,
        currentX: ev.clientX,
        currentY: ev.clientY,
        targetDir: '',
        targetDirectoryPath: '',
        validTarget: false,
      }
      updateDragTarget(ev.clientX, ev.clientY)
    }
  }, delay)

  window.addEventListener('pointermove', onLongPressPointerMove, true)
  window.addEventListener('pointerup', onLongPressPointerUp, true)
  window.addEventListener('pointercancel', onLongPressPointerCancel, true)
}

async function runDeleteSelected() {
  const targets = Array.from(props.selectedPaths)
  if (!targets.length) return
  await props.deleteSelectedNodes(targets)
}

const explorerActionGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'actions',
    title: t('files.explorer.actionMenu.groups.actions'),
    items: [
      {
        id: 'upload',
        label: props.uploading ? t('files.explorer.actionMenu.uploading') : t('files.explorer.actionMenu.uploadFiles'),
        disabled: props.uploading,
        icon: props.uploading ? RiLoader4Line : RiUpload2Line,
      },
      {
        id: 'collapse',
        label: t('files.explorer.actionMenu.collapseFolders'),
        description: t('files.explorer.actionMenu.collapseFoldersDescription'),
        icon: RiArrowUpLine,
      },
    ],
  },
  {
    id: 'visibility',
    title: t('files.explorer.actionMenu.groups.visibility'),
    items: [
      {
        id: 'toggle-hidden',
        label: t('files.explorer.actionMenu.showHiddenFiles'),
        description: t('files.explorer.actionMenu.showHiddenFilesDescription'),
        checked: showHidden.value,
        icon: showHidden.value ? RiEyeLine : RiEyeOffLine,
      },
      {
        id: 'toggle-gitignored',
        label: t('files.explorer.actionMenu.showGitignoredFiles'),
        description: t('files.explorer.actionMenu.showGitignoredFilesDescription'),
        checked: showGitignored.value,
        icon: RiGitBranchLine,
      },
    ],
  },
])

const fileActionGroups: OptionMenuGroup[] = [
  {
    id: 'file-actions',
    items: [
      { id: 'download', label: t('files.actions.download'), icon: RiDownload2Line },
      { id: 'copy-path', label: t('files.actions.copyPath'), icon: RiFileCopy2Line },
      { id: 'copy-absolute-path', label: t('files.actions.copyAbsolutePath'), icon: RiFileCopy2Line },
    ],
  },
]

const folderActionGroups: OptionMenuGroup[] = [
  {
    id: 'folder-actions',
    items: [
      { id: 'copy-path', label: t('files.actions.copyPath'), icon: RiFileCopy2Line },
      { id: 'copy-absolute-path', label: t('files.actions.copyAbsolutePath'), icon: RiFileCopy2Line },
    ],
  },
]

function rowActionMenuTitle(node: FileNode): string {
  return node.type === 'directory' ? t('files.explorer.actions.folderActions') : t('files.explorer.actions.fileActions')
}

function rowActionMenuGroups(node: FileNode): OptionMenuGroup[] {
  const items: OptionMenuItem[] = []

  if (node.type === 'file') {
    items.push({ id: 'download', label: t('files.actions.download'), icon: RiDownload2Line })
  }

  items.push(
    { id: 'copy-path', label: t('files.actions.copyPath'), icon: RiFileCopy2Line },
    { id: 'copy-absolute-path', label: t('files.actions.copyAbsolutePath'), icon: RiFileCopy2Line },
  )

  items.push({ id: 'rename', label: t('files.explorer.actions.rename'), icon: RiEditLine })
  items.push({
    id: 'delete',
    label: t('files.explorer.actions.delete'),
    icon: RiDeleteBinLine,
    variant: 'destructive',
    disabled: props.deletingPaths.has(node.path),
    confirmTitle:
      node.type === 'directory'
        ? t('files.explorer.actions.deleteFolderTitle')
        : t('files.explorer.actions.deleteFileTitle'),
    confirmDescription: t('files.explorer.actions.deleteDescription', { name: node.name }),
    confirmText: t('files.explorer.actions.delete'),
    cancelText: t('common.cancel'),
  })

  return [
    {
      id: 'tree-row-actions',
      items,
    },
  ]
}

function triggerUpload() {
  if (props.uploading) return
  const el = uploadInputRef.value
  if (!el) return
  el.value = ''
  el.click()
}

async function onUploadChange(ev: Event) {
  const input = ev.target as HTMLInputElement | null
  const list = Array.from(input?.files || [])
  if (input) input.value = ''
  if (!list.length) return
  await props.uploadFiles(list)
}

function hasDroppedFiles(ev: DragEvent): boolean {
  const dt = ev.dataTransfer
  if (!dt) return false
  if (dt.files && dt.files.length > 0) return true
  return Array.from(dt.types || []).includes('Files')
}

async function runExplorerAction(item: OptionMenuItem) {
  switch (item.id) {
    case 'upload':
      triggerUpload()
      break
    case 'collapse':
      props.collapseAll()
      break
    case 'toggle-hidden':
      showHidden.value = !showHidden.value
      break
    case 'toggle-gitignored':
      showGitignored.value = !showGitignored.value
      break
    default:
      break
  }
}

function toggleFileActionMenu(path: string) {
  const targetPath = String(path || '').trim()
  if (!targetPath) {
    fileActionMenuPath.value = ''
    fileActionMenuQuery.value = ''
    return
  }

  if (fileActionMenuPath.value === targetPath) {
    fileActionMenuPath.value = ''
    fileActionMenuQuery.value = ''
    return
  }

  void setFileActionMenuOpen(targetPath, true)
}

async function runFileActionMenu(node: FileNode, item: OptionMenuItem) {
  const action = item.id as FileActionId
  if (action !== 'download' && action !== 'copy-path' && action !== 'copy-absolute-path') return
  await props.runFileAction(action, node)
  fileActionMenuPath.value = ''
}

async function runTreeRowActionMenu(node: FileNode, item: OptionMenuItem) {
  if (item.id === 'rename') {
    await startRename(node)
    fileActionMenuPath.value = ''
    return
  }

  if (item.id === 'delete') {
    await props.deleteNode(node)
    fileActionMenuPath.value = ''
    return
  }

  const action = item.id as FileActionId
  if (action === 'download' || action === 'copy-path' || action === 'copy-absolute-path') {
    await props.runFileAction(action, node)
    fileActionMenuPath.value = ''
  }
}

function onExplorerDragOver(ev: DragEvent) {
  if (!hasDroppedFiles(ev)) return
  ev.preventDefault()
  if (dropTargetDir.value) return
  rootDropActive.value = true
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function onExplorerDragLeave(ev: DragEvent) {
  const current = ev.currentTarget as HTMLElement | null
  const next = ev.relatedTarget as Node | null
  if (current && next && current.contains(next)) return
  rootDropActive.value = false
}

async function onExplorerDrop(ev: DragEvent) {
  if (!hasDroppedFiles(ev)) return
  ev.preventDefault()
  rootDropActive.value = false
  if (dropTargetDir.value) return

  const files = ev.dataTransfer?.files
  const list = Array.from(files || [])
  if (!list.length) return
  await props.uploadFiles(list, props.root)
}

function onRowDragOver(ev: DragEvent, row: FlatRow) {
  if (row.node.type !== 'directory') return
  if (!hasDroppedFiles(ev)) return
  ev.preventDefault()
  ev.stopPropagation()
  rootDropActive.value = false
  dropTargetDir.value = row.node.path
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function onRowDragLeave(ev: DragEvent, row: FlatRow) {
  if (row.node.type !== 'directory') return
  const current = ev.currentTarget as HTMLElement | null
  const next = ev.relatedTarget as Node | null
  if (current && next && current.contains(next)) return
  if (dropTargetDir.value === row.node.path) {
    dropTargetDir.value = ''
  }
}

async function onRowDrop(ev: DragEvent, row: FlatRow) {
  if (row.node.type !== 'directory') return
  if (!hasDroppedFiles(ev)) return
  ev.preventDefault()
  ev.stopPropagation()
  rootDropActive.value = false
  dropTargetDir.value = ''

  const files = ev.dataTransfer?.files
  const list = Array.from(files || [])
  if (!list.length) return
  await props.uploadFiles(list, row.node.path)
}

function handleGlobalPointerDown(ev: PointerEvent) {
  const target = ev.target as Node | null
  if (!target) return

  if (inlineRenamePath.value && !inlineRenameBusy.value) {
    if (!isWithinInlineRename(target)) {
      resetInlineRename()
    }
  }

  if (inlineCreateKind.value && !inlineCreateBusy.value) {
    if (!isWithinInlineCreate(target)) {
      resetInlineCreate()
    }
  }
}

function handleGlobalKeydown(ev: KeyboardEvent) {
  if (ev.key !== 'Escape') return
  if (dragSession.value) {
    flashDragFeedback('invalid', dragSession.value.targetDirectoryPath || dragSession.value.sourcePath)
    clearDragSession()
  }
  resetLongPressState()
}

watch(
  () => viewMode.value,
  (mode) => {
    if (mode !== 'tree') {
      resetInlineCreate()
      resetInlineRename()
      fileActionMenuPath.value = ''
    }
  },
)

watch(
  () => actionMenuOpen.value,
  (open) => {
    if (!open) actionMenuQuery.value = ''
  },
)

watch(
  () => fileActionMenuPath.value,
  (path) => {
    if (!path) fileActionMenuQuery.value = ''
  },
)

watch(
  () => props.root,
  () => {
    resetInlineCreate()
    resetInlineRename()
    fileActionMenuPath.value = ''
  },
)

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('keydown', handleGlobalKeydown, true)
})

onBeforeUnmount(() => {
  resetLongPressState()
  clearDragSession()
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('keydown', handleGlobalKeydown, true)
})
</script>

<template>
  <section class="oc-vscode-pane" :class="isCompactLayout ? 'border-0 rounded-none' : ''">
    <div class="oc-vscode-pane-header">
      <div class="oc-vscode-pane-title">{{ t('files.explorer.title') }}</div>
      <div class="flex items-center gap-1">
        <SidebarIconButton :title="t('files.explorer.toolbar.newFile')" @click="startCreate('createFile')">
          <RiFileAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
        <SidebarIconButton :title="t('files.explorer.toolbar.newFolder')" @click="startCreate('createFolder')">
          <RiFolderAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <SidebarIconButton
          :title="t('files.explorer.toolbar.refreshTree')"
          :aria-label="t('files.explorer.toolbar.refreshTree')"
          @click="refreshRoot"
        >
          <RiRefreshLine class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <SidebarIconButton
          :active="multiSelectEnabled"
          :title="
            multiSelectEnabled
              ? t('files.explorer.selection.exitMultiSelect')
              : t('files.explorer.selection.enterMultiSelect')
          "
          :aria-label="
            multiSelectEnabled
              ? t('files.explorer.selection.exitMultiSelect')
              : t('files.explorer.selection.enterMultiSelect')
          "
          @click="toggleMultiSelectMode"
        >
          <RiCloseLine v-if="multiSelectEnabled" class="h-3.5 w-3.5" />
          <RiListCheck3 v-else class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <div class="relative">
          <SidebarIconButton
            :active="actionMenuOpen"
            :title="t('files.explorer.toolbar.actions')"
            :aria-label="t('files.explorer.toolbar.actions')"
            @mousedown.prevent
            @click.stop="toggleActionMenu"
          >
            <RiMore2Line class="h-3.5 w-3.5" />
          </SidebarIconButton>
          <OptionMenu
            :open="actionMenuOpen"
            :query="actionMenuQuery"
            :groups="explorerActionGroups"
            :title="t('files.explorer.toolbar.actions')"
            :mobile-title="t('files.explorer.toolbar.actions')"
            :searchable="true"
            filter-mode="internal"
            :is-mobile-pointer="isMobileFormFactor"
            :desktop-fixed="true"
            desktop-placement="bottom-start"
            desktop-class="w-72"
            @update:open="(v) => void setActionMenuOpen(v)"
            @update:query="(v) => (actionMenuQuery = v)"
            @select="runExplorerAction"
          />
        </div>
      </div>
    </div>

    <div v-if="multiSelectEnabled" class="border-b border-sidebar-border/60 px-2 py-1.5">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <div class="flex min-w-0 items-center">
          <span
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-foreground/80"
            :title="String(t('files.explorer.selection.selectedCount', { count: selectedCount }))"
            :aria-label="String(t('files.explorer.selection.selectedCount', { count: selectedCount }))"
          >
            {{ selectedCount }}
          </span>
        </div>

        <div class="flex items-center gap-1">
          <SidebarIconButton
            size="sm"
            :title="t('common.selectAll')"
            :aria-label="t('common.selectAll')"
            :disabled="selectableRowCount === 0 || selectedCount === selectableRowCount"
            @click="selectAllVisibleNodes"
          >
            <RiListCheck3 class="h-3 w-3" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :title="t('common.invertSelection')"
            :aria-label="t('common.invertSelection')"
            :disabled="selectableRowCount === 0"
            @click="invertVisibleNodeSelection"
          >
            <RiRefreshLine class="h-3 w-3" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :title="t('files.explorer.selection.bulkMove')"
            :aria-label="t('files.explorer.selection.bulkMove')"
            :disabled="selectedCount === 0"
            @click="openMoveSelectedDialog(Array.from(selectedPaths))"
          >
            <RiFolderOpenFill class="h-3 w-3" />
          </SidebarIconButton>
          <ConfirmPopover
            :title="t('files.explorer.selection.bulkDeleteTitle')"
            :description="t('files.explorer.selection.bulkDeleteDescription', { count: selectedCount })"
            :confirm-text="t('files.explorer.selection.bulkDelete')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="runDeleteSelected"
          >
            <SidebarIconButton
              size="sm"
              destructive
              :title="t('files.explorer.selection.bulkDelete')"
              :disabled="hasDeletingSelected || selectedCount === 0"
              @click.stop
            >
              <RiLoader4Line v-if="hasDeletingSelected" class="h-3 w-3 animate-spin" />
              <RiDeleteBinLine v-else class="h-3 w-3" />
            </SidebarIconButton>
          </ConfirmPopover>
          <SidebarIconButton
            size="sm"
            :title="t('files.explorer.selection.clearSelection')"
            :aria-label="t('files.explorer.selection.clearSelection')"
            :disabled="selectedCount === 0"
            @click="clearSelectedPaths"
          >
            <RiCloseLine class="h-3 w-3" />
          </SidebarIconButton>
          <SidebarIconButton
            size="sm"
            :title="t('files.explorer.selection.exitMultiSelect')"
            :aria-label="t('files.explorer.selection.exitMultiSelect')"
            @click="toggleMultiSelectMode"
          >
            <RiCheckLine class="h-3 w-3" />
          </SidebarIconButton>
        </div>
      </div>
    </div>

    <div class="border-b border-sidebar-border/60 px-1.5 py-1">
      <SegmentedControl class="grid-cols-2">
        <SegmentedButton :active="viewMode === 'tree'" @click="viewMode = 'tree'">{{
          t('files.explorer.view.tree')
        }}</SegmentedButton>
        <SegmentedButton :active="viewMode === 'search'" @click="viewMode = 'search'">{{
          t('files.explorer.view.search')
        }}</SegmentedButton>
      </SegmentedControl>
    </div>

    <input ref="uploadInputRef" class="hidden" type="file" multiple @change="onUploadChange" />

    <div v-if="viewMode === 'tree'" class="oc-vscode-section flex min-h-0 flex-1 flex-col border-b-0">
      <ScrollArea
        class="flex-1 min-h-0"
        :class="[
          rootDropActive || moveRootDropActive ? 'bg-sidebar-accent/20' : '',
          dragFeedbackPath === root && dragFeedbackKind === 'success' ? 'oc-tree-drop-success' : '',
          dragFeedbackPath === root && dragFeedbackKind === 'invalid' ? 'oc-tree-drop-invalid' : '',
        ]"
        @dragover="onExplorerDragOver"
        @dragleave="onExplorerDragLeave"
        @drop="onExplorerDrop"
      >
        <div data-explorer-tree="true" class="px-1 pb-2 pt-1">
          <div v-if="!hasRootChildren" class="space-y-1.5 px-1 py-1.5">
            <div v-for="i in 8" :key="`tree-skeleton-${i}`" class="rounded-sm px-1.5 py-1">
              <div class="flex items-center gap-2" :style="{ paddingLeft: `${((i - 1) % 3) * 14}px` }">
                <Skeleton class="h-3.5 w-3.5 shrink-0 rounded-sm" />
                <Skeleton class="h-3" :class="i % 3 === 0 ? 'w-1/3' : i % 2 === 0 ? 'w-1/2' : 'w-2/3'" />
              </div>
            </div>
          </div>

          <ul v-else class="space-y-0.5">
            <li v-for="entry in treeRows" :key="entry.key">
              <template v-if="entry.kind === 'node'">
                <SidebarListItem
                  v-if="inlineRenamePath === entry.row.node.path"
                  as="div"
                  :active="isNodeSelected(entry.row.node.path) || selectedFilePath === entry.row.node.path"
                  :indent="8 + entry.row.depth * 14"
                  :actions-always-visible="true"
                  data-inline-rename-root="true"
                  class="h-[22px] rounded-sm border border-sidebar-border/60 bg-sidebar-accent/40 !py-0 !pr-1 !text-[12px]"
                  :data-node-path="entry.row.node.path"
                  :data-node-type="entry.row.node.type"
                  :class="[
                    selectedFilePath === entry.row.node.path ? '!border-sidebar-border/70' : '',
                    isNodeSelected(entry.row.node.path) ? '!border-primary/60 !bg-primary/18 !text-foreground' : '',
                    dropTargetDir === entry.row.node.path || moveDropTargetDir === entry.row.node.path
                      ? '!border-primary/60 !bg-primary/12 !text-foreground'
                      : '',
                    dragSourcePath === entry.row.node.path ? 'oc-tree-drag-source' : '',
                    dragFeedbackPath === entry.row.node.path && dragFeedbackKind === 'invalid'
                      ? 'oc-tree-drop-invalid'
                      : '',
                    dragFeedbackPath === entry.row.node.path && dragFeedbackKind === 'success'
                      ? 'oc-tree-drop-success'
                      : '',
                  ]"
                >
                  <template #icon>
                    <ListItemSelectionIndicator
                      v-if="multiSelectEnabled"
                      :selected="isNodeSelected(entry.row.node.path)"
                    />
                    <template v-if="entry.row.node.type === 'directory'">
                      <RiLoader4Line v-if="entry.row.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <RiFolderOpenFill v-else-if="entry.row.isExpanded" class="h-3.5 w-3.5 shrink-0 text-primary/75" />
                      <RiFolder3Fill v-else class="h-3.5 w-3.5 shrink-0 text-primary/75" />
                    </template>
                    <template v-else>
                      <component
                        :is="fileIconComponent(entry.row.node.extension)"
                        class="h-3.5 w-3.5 shrink-0"
                        :class="fileIconClass(entry.row.node.extension)"
                      />
                    </template>
                  </template>

                  <input
                    :ref="setInlineRenameInputRef"
                    v-model="inlineRenameName"
                    class="h-5 min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                    :placeholder="t('files.dialog.namePlaceholder')"
                    :disabled="inlineRenameBusy"
                    @keydown.enter.prevent="submitInlineRename(entry.row.node)"
                    @keydown.esc.prevent="resetInlineRename"
                  />

                  <template #actions>
                    <SidebarIconButton
                      size="sm"
                      :title="t('common.cancel')"
                      :aria-label="t('common.cancel')"
                      :disabled="inlineRenameBusy"
                      @click.stop="resetInlineRename"
                    >
                      <RiCloseLine class="h-3 w-3" />
                    </SidebarIconButton>
                    <SidebarIconButton
                      size="sm"
                      :title="t('files.explorer.actions.rename')"
                      :aria-label="t('files.explorer.actions.rename')"
                      :disabled="inlineRenameBusy || !inlineRenameName.trim()"
                      @click.stop="submitInlineRename(entry.row.node)"
                    >
                      <RiLoader4Line v-if="inlineRenameBusy" class="h-3 w-3 animate-spin" />
                      <RiCheckLine v-else class="h-3 w-3" />
                    </SidebarIconButton>
                  </template>
                </SidebarListItem>

                <SidebarListItem
                  v-else
                  :active="isNodeSelected(entry.row.node.path) || selectedFilePath === entry.row.node.path"
                  :indent="8 + entry.row.depth * 14"
                  :actions-always-visible="isCompactLayout"
                  class="h-[22px] rounded-sm border border-transparent !py-0 !pr-1 !text-[12px]"
                  :data-node-path="entry.row.node.path"
                  :data-node-type="entry.row.node.type"
                  :class="[
                    selectedFilePath === entry.row.node.path ? '!border-sidebar-border/70' : '',
                    isNodeSelected(entry.row.node.path) ? '!border-primary/60 !bg-primary/18 !text-foreground' : '',
                    dropTargetDir === entry.row.node.path || moveDropTargetDir === entry.row.node.path
                      ? '!border-primary/60 !bg-primary/12 !text-foreground'
                      : '',
                    dragSourcePath === entry.row.node.path ? 'oc-tree-drag-source' : '',
                    dragFeedbackPath === entry.row.node.path && dragFeedbackKind === 'invalid'
                      ? 'oc-tree-drop-invalid'
                      : '',
                    dragFeedbackPath === entry.row.node.path && dragFeedbackKind === 'success'
                      ? 'oc-tree-drop-success'
                      : '',
                  ]"
                  @click="handleTreeNodeClick($event, entry.row.node)"
                  @pointerdown="onRowPointerDown($event, entry.row.node)"
                  @dragstart.prevent
                  @dragover="onRowDragOver($event, entry.row)"
                  @dragleave="onRowDragLeave($event, entry.row)"
                  @drop="onRowDrop($event, entry.row)"
                >
                  <template #icon>
                    <ListItemSelectionIndicator
                      v-if="multiSelectEnabled"
                      :selected="isNodeSelected(entry.row.node.path)"
                    />
                    <template v-if="entry.row.node.type === 'directory'">
                      <RiLoader4Line v-if="entry.row.isLoading" class="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <RiFolderOpenFill v-else-if="entry.row.isExpanded" class="h-3.5 w-3.5 shrink-0 text-primary/75" />
                      <RiFolder3Fill v-else class="h-3.5 w-3.5 shrink-0 text-primary/75" />
                    </template>
                    <template v-else>
                      <component
                        :is="fileIconComponent(entry.row.node.extension)"
                        class="h-3.5 w-3.5 shrink-0"
                        :class="fileIconClass(entry.row.node.extension)"
                      />
                    </template>
                  </template>

                  <span class="min-w-0 flex-1 truncate" :title="entry.row.node.path">{{ entry.row.node.name }}</span>

                  <template #actions>
                    <div v-if="isCompactLayout" class="relative" data-file-action-root="true">
                      <SidebarIconButton
                        size="sm"
                        :title="t('files.explorer.actions.actions')"
                        :active="fileActionMenuPath === entry.row.node.path"
                        @click.stop="void toggleFileActionMenu(entry.row.node.path)"
                      >
                        <RiMore2Line class="h-3 w-3" />
                      </SidebarIconButton>
                      <OptionMenu
                        :open="fileActionMenuPath === entry.row.node.path"
                        :query="fileActionMenuQuery"
                        :groups="rowActionMenuGroups(entry.row.node)"
                        :title="rowActionMenuTitle(entry.row.node)"
                        :mobile-title="rowActionMenuTitle(entry.row.node)"
                        :searchable="true"
                        filter-mode="internal"
                        :is-mobile-pointer="isMobileFormFactor"
                        :desktop-fixed="true"
                        desktop-placement="bottom-start"
                        desktop-class="w-56"
                        @update:open="(v) => void setFileActionMenuOpen(entry.row.node.path, v)"
                        @update:query="(v) => (fileActionMenuQuery = v)"
                        @select="(item) => runTreeRowActionMenu(entry.row.node, item)"
                      />
                    </div>

                    <div v-else class="flex items-center gap-0.5">
                      <div class="relative" data-file-action-root="true">
                        <SidebarIconButton
                          size="sm"
                          :title="
                            entry.row.node.type === 'directory'
                              ? t('files.explorer.actions.folderActions')
                              : t('files.explorer.actions.fileActions')
                          "
                          :active="fileActionMenuPath === entry.row.node.path"
                          @click.stop="void toggleFileActionMenu(entry.row.node.path)"
                        >
                          <RiMore2Line class="h-3 w-3" />
                        </SidebarIconButton>
                        <OptionMenu
                          :open="fileActionMenuPath === entry.row.node.path"
                          :query="fileActionMenuQuery"
                          :groups="entry.row.node.type === 'directory' ? folderActionGroups : fileActionGroups"
                          :title="rowActionMenuTitle(entry.row.node)"
                          :mobile-title="rowActionMenuTitle(entry.row.node)"
                          :searchable="true"
                          filter-mode="internal"
                          :is-mobile-pointer="isMobileFormFactor"
                          :desktop-fixed="true"
                          desktop-placement="bottom-start"
                          desktop-class="w-44"
                          @update:open="(v) => void setFileActionMenuOpen(entry.row.node.path, v)"
                          @update:query="(v) => (fileActionMenuQuery = v)"
                          @select="(item) => runFileActionMenu(entry.row.node, item)"
                        />
                      </div>

                      <SidebarIconButton
                        size="sm"
                        :title="t('files.explorer.actions.rename')"
                        @click.stop="startRename(entry.row.node)"
                      >
                        <RiEditLine class="h-3 w-3" />
                      </SidebarIconButton>
                      <ConfirmPopover
                        :title="
                          entry.row.node.type === 'directory'
                            ? t('files.explorer.actions.deleteFolderTitle')
                            : t('files.explorer.actions.deleteFileTitle')
                        "
                        :description="t('files.explorer.actions.deleteDescription', { name: entry.row.node.name })"
                        :confirm-text="t('files.explorer.actions.delete')"
                        :cancel-text="t('common.cancel')"
                        variant="destructive"
                        @confirm="deleteNode(entry.row.node)"
                      >
                        <SidebarIconButton
                          size="sm"
                          destructive
                          :title="t('files.explorer.actions.delete')"
                          :aria-label="t('files.explorer.actions.delete')"
                          :disabled="deletingPaths.has(entry.row.node.path)"
                          @click.stop
                        >
                          <RiLoader4Line v-if="deletingPaths.has(entry.row.node.path)" class="h-3 w-3 animate-spin" />
                          <RiDeleteBinLine v-else class="h-3 w-3" />
                        </SidebarIconButton>
                      </ConfirmPopover>
                    </div>
                  </template>
                </SidebarListItem>
              </template>

              <SidebarListItem
                v-else
                as="div"
                :indent="8 + entry.depth * 14"
                :actions-always-visible="true"
                data-inline-create-root="true"
                class="h-[22px] rounded-sm border border-sidebar-border/60 bg-sidebar-accent/50 !py-0 !pr-1 !text-[12px]"
              >
                <template #icon>
                  <RiFolderAddLine
                    v-if="entry.createKind === 'createFolder'"
                    class="h-3.5 w-3.5 shrink-0 text-primary/75"
                  />
                  <RiFileAddLine v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </template>
                <input
                  :ref="setInlineCreateInputRef"
                  v-model="inlineCreateName"
                  class="h-5 min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                  :placeholder="
                    entry.createKind === 'createFolder'
                      ? t('files.explorer.inlineCreate.folderName')
                      : t('files.explorer.inlineCreate.fileName')
                  "
                  :disabled="inlineCreateBusy"
                  @keydown.enter.prevent="submitInlineCreate"
                  @keydown.esc.prevent="resetInlineCreate"
                />
                <template #actions>
                  <SidebarIconButton
                    size="sm"
                    :title="t('common.create')"
                    :aria-label="t('common.create')"
                    :disabled="inlineCreateBusy || !inlineCreateName.trim()"
                    @click.stop="submitInlineCreate"
                  >
                    <RiLoader4Line v-if="inlineCreateBusy" class="h-3 w-3 animate-spin" />
                    <RiCheckLine v-else class="h-3 w-3" />
                  </SidebarIconButton>
                  <SidebarIconButton
                    size="sm"
                    :title="t('common.cancel')"
                    :aria-label="t('common.cancel')"
                    :disabled="inlineCreateBusy"
                    @click.stop="resetInlineCreate"
                  >
                    <RiCloseLine class="h-3 w-3" />
                  </SidebarIconButton>
                </template>
              </SidebarListItem>
            </li>
          </ul>
        </div>
      </ScrollArea>
    </div>

    <div v-else class="oc-vscode-section flex min-h-0 flex-1 flex-col border-b-0">
      <slot name="search">
        <div class="oc-vscode-empty">{{ t('files.explorer.searchUnavailable') }}</div>
      </slot>
    </div>

    <Teleport to="body">
      <div
        v-if="dragSession"
        class="oc-tree-drag-ghost fixed left-0 top-0 z-[120] flex h-[24px] max-w-[260px] items-center gap-1.5 rounded-sm border border-primary/35 bg-sidebar px-2 text-[11px] text-foreground shadow-xl shadow-black/20"
        :class="dragSession.validTarget ? 'opacity-100' : 'opacity-85 border-destructive/60 text-destructive'"
        :style="{ transform: `translate3d(${dragSession.currentX + 12}px, ${dragSession.currentY + 10}px, 0)` }"
      >
        <RiFolder3Fill v-if="dragSession.node.type === 'directory'" class="h-3.5 w-3.5 shrink-0 text-primary/80" />
        <component
          :is="fileIconComponent(dragSession.node.extension)"
          v-else
          class="h-3.5 w-3.5 shrink-0"
          :class="fileIconClass(dragSession.node.extension)"
        />
        <span class="truncate">{{ dragSession.node.name }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.oc-tree-drag-source {
  transform: scale(0.985);
  opacity: 0.7;
}

.oc-tree-drag-ghost {
  pointer-events: none;
  animation: oc-tree-drag-lift 120ms ease-out;
}

.oc-tree-drop-invalid {
  animation: oc-tree-drop-invalid 170ms ease-out;
}

.oc-tree-drop-success {
  animation: oc-tree-drop-success 220ms ease-out;
}

@keyframes oc-tree-drag-lift {
  from {
    opacity: 0;
    transform: translate3d(0, 0, 0) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@keyframes oc-tree-drop-invalid {
  0% {
    transform: translateX(0);
  }
  33% {
    transform: translateX(-2px);
  }
  66% {
    transform: translateX(2px);
  }
  100% {
    transform: translateX(0);
  }
}

@keyframes oc-tree-drop-success {
  0% {
    box-shadow: 0 0 0 0 rgb(59 130 246 / 0);
  }
  40% {
    box-shadow: 0 0 0 1px rgb(59 130 246 / 0.38);
  }
  100% {
    box-shadow: 0 0 0 0 rgb(59 130 246 / 0);
  }
}
</style>
