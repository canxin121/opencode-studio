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
  RiLoader4Line,
  RiMore2Line,
  RiRefreshLine,
  RiUpload2Line,
} from '@remixicon/vue'

import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import SegmentedButton from '@/components/ui/SegmentedButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import SidebarIconButton from '@/components/ui/SidebarIconButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import { fileIconClass, fileIconComponent } from '../fileKinds'
import type { DialogKind, FileNode, FlatRow } from '../types'

type ExplorerViewMode = 'tree' | 'search'
type InlineCreateKind = 'createFile' | 'createFolder'
type FileActionId = 'download' | 'copy-path'
type ExplorerTreeRow =
  | { kind: 'node'; key: string; row: FlatRow }
  | { kind: 'inline-create'; key: '__inline-create__'; depth: number; createKind: InlineCreateKind }

const viewMode = defineModel<ExplorerViewMode>('viewMode', { default: 'tree' })
const showHidden = defineModel<boolean>('showHidden', { default: false })
const showGitignored = defineModel<boolean>('showGitignored', { default: false })

const props = defineProps<{
  root: string
  isMobile: boolean
  selectedFilePath: string
  activeCreateDir: string
  hasRootChildren: boolean
  flattenedTree: FlatRow[]
  deletingPaths: Set<string>
  uploading: boolean
  handleNodeClick: (node: FileNode) => void | Promise<void>
  refreshRoot: () => void | Promise<void>
  collapseAll: () => void
  expandDirectory: (dirPath: string) => void | Promise<void>
  createNode: (kind: InlineCreateKind, basePath: string, name: string) => Promise<boolean>
  renameNode: (node: FileNode, name: string) => Promise<boolean>
  runFileAction: (action: FileActionId, node: FileNode) => void | Promise<void>
  openDialog: (kind: Exclude<DialogKind, null>, node?: FileNode) => void
  deleteNode: (node: FileNode) => void | Promise<void>
  uploadFiles: (files: FileList, targetDir?: string) => void | Promise<void>
}>()

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

const selectedDirectoryNode = computed<FileNode | null>(() => {
  const selectedPath = (props.selectedFilePath || '').trim()
  if (!selectedPath) return null
  const fromTree = props.flattenedTree.find((row) => row.node.path === selectedPath)?.node
  return fromTree?.type === 'directory' ? fromTree : null
})

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
  if (props.isMobile) {
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
  if (props.isMobile) {
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

async function handleTreeNodeClick(node: FileNode) {
  if (inlineCreateKind.value && !inlineCreateBusy.value) {
    resetInlineCreate()
  }
  if (inlineRenamePath.value && !inlineRenameBusy.value) {
    resetInlineRename()
  }
  if (fileActionMenuPath.value) {
    fileActionMenuPath.value = ''
  }
  await props.handleNodeClick(node)
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
    ],
  },
]

function rowActionMenuTitle(node: FileNode): string {
  return node.type === 'directory' ? t('files.explorer.actions.folderActions') : t('files.explorer.actions.fileActions')
}

function rowActionMenuGroups(node: FileNode): OptionMenuGroup[] {
  const items: OptionMenuItem[] = []

  if (node.type === 'file') {
    items.push(
      { id: 'download', label: t('files.actions.download'), icon: RiDownload2Line },
      { id: 'copy-path', label: t('files.actions.copyPath'), icon: RiFileCopy2Line },
    )
  }

  items.push({ id: 'rename', label: t('files.explorer.actions.rename'), icon: RiEditLine })
  items.push({
    id: 'delete',
    label: t('files.explorer.actions.delete'),
    icon: RiDeleteBinLine,
    variant: 'destructive',
    disabled: props.deletingPaths.has(node.path),
    confirmTitle:
      node.type === 'directory' ? t('files.explorer.actions.deleteFolderTitle') : t('files.explorer.actions.deleteFileTitle'),
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
  const files = input?.files
  if (!files || files.length === 0) return
  await props.uploadFiles(files)
  if (input) input.value = ''
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
  if (fileActionMenuPath.value === path) {
    fileActionMenuPath.value = ''
    fileActionMenuQuery.value = ''
    return
  }
  fileActionMenuPath.value = path
  fileActionMenuQuery.value = ''
}

async function runFileActionMenu(node: FileNode, item: OptionMenuItem) {
  const action = item.id as FileActionId
  if (action !== 'download' && action !== 'copy-path') return
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
  if (action === 'download' || action === 'copy-path') {
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
  if (!files || files.length === 0) return
  await props.uploadFiles(files, props.root)
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
  if (!files || files.length === 0) return
  await props.uploadFiles(files, row.node.path)
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
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
})
</script>

<template>
  <section class="oc-vscode-pane" :class="isMobile ? 'border-0 rounded-none' : ''">
    <div class="oc-vscode-pane-header">
      <div class="oc-vscode-pane-title">{{ t('files.explorer.title') }}</div>
      <div class="flex items-center gap-1">
        <SidebarIconButton :title="t('files.explorer.toolbar.newFile')" @click="startCreate('createFile')">
          <RiFileAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>
        <SidebarIconButton :title="t('files.explorer.toolbar.newFolder')" @click="startCreate('createFolder')">
          <RiFolderAddLine class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <SidebarIconButton :title="t('files.explorer.toolbar.refreshTree')" :aria-label="t('files.explorer.toolbar.refreshTree')" @click="refreshRoot">
          <RiRefreshLine class="h-3.5 w-3.5" />
        </SidebarIconButton>

        <div class="relative">
          <SidebarIconButton
            :active="actionMenuOpen"
            :title="t('files.explorer.toolbar.actions')"
            :aria-label="t('files.explorer.toolbar.actions')"
            @mousedown.prevent
            @click.stop="actionMenuOpen = !actionMenuOpen"
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
            :is-mobile-pointer="isMobile"
            :desktop-fixed="true"
            desktop-placement="bottom-start"
            desktop-class="w-72"
            @update:open="(v) => (actionMenuOpen = v)"
            @update:query="(v) => (actionMenuQuery = v)"
            @select="runExplorerAction"
          />
        </div>
      </div>
    </div>

    <div class="border-b border-sidebar-border/60 px-1.5 py-1">
      <SegmentedControl class="grid-cols-2">
        <SegmentedButton :active="viewMode === 'tree'" @click="viewMode = 'tree'">{{ t('files.explorer.view.tree') }}</SegmentedButton>
        <SegmentedButton :active="viewMode === 'search'" @click="viewMode = 'search'">{{ t('files.explorer.view.search') }}</SegmentedButton>
      </SegmentedControl>
    </div>

    <input ref="uploadInputRef" class="hidden" type="file" multiple @change="onUploadChange" />

    <div v-if="viewMode === 'tree'" class="oc-vscode-section flex min-h-0 flex-1 flex-col border-b-0">
      <ScrollArea
        class="flex-1 min-h-0"
        :class="rootDropActive ? 'bg-sidebar-accent/20' : ''"
        @dragover="onExplorerDragOver"
        @dragleave="onExplorerDragLeave"
        @drop="onExplorerDrop"
      >
        <div class="px-1 pb-2 pt-1">
          <div v-if="!hasRootChildren" class="oc-vscode-empty">{{ t('common.loading') }}</div>

          <ul v-else class="space-y-0.5">
            <li v-for="entry in treeRows" :key="entry.key">
              <template v-if="entry.kind === 'node'">
                <SidebarListItem
                  v-if="inlineRenamePath === entry.row.node.path"
                  as="div"
                  :active="selectedFilePath === entry.row.node.path"
                  :indent="8 + entry.row.depth * 14"
                  :actions-always-visible="true"
                  data-inline-rename-root="true"
                  class="h-[22px] rounded-sm border border-sidebar-border/60 bg-sidebar-accent/40 !py-0 !pr-1 !text-[12px]"
                  :class="[
                    selectedFilePath === entry.row.node.path ? '!border-sidebar-border/70' : '',
                    dropTargetDir === entry.row.node.path ? '!border-primary/60 !bg-primary/12 !text-foreground' : '',
                  ]"
                >
                  <template #icon>
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
                  :active="selectedFilePath === entry.row.node.path"
                  :indent="8 + entry.row.depth * 14"
                  :actions-always-visible="isMobile"
                  class="h-[22px] rounded-sm border border-transparent !py-0 !pr-1 !text-[12px]"
                  :class="[
                    selectedFilePath === entry.row.node.path ? '!border-sidebar-border/70' : '',
                    dropTargetDir === entry.row.node.path ? '!border-primary/60 !bg-primary/12 !text-foreground' : '',
                  ]"
                  @click="handleTreeNodeClick(entry.row.node)"
                  @dragover="onRowDragOver($event, entry.row)"
                  @dragleave="onRowDragLeave($event, entry.row)"
                  @drop="onRowDrop($event, entry.row)"
                >
                  <template #icon>
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
                    <div v-if="isMobile" class="relative" data-file-action-root="true">
                      <SidebarIconButton
                        size="sm"
                        :title="t('files.explorer.actions.actions')"
                        :active="fileActionMenuPath === entry.row.node.path"
                        @click.stop="toggleFileActionMenu(entry.row.node.path)"
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
                        :is-mobile-pointer="isMobile"
                        :desktop-fixed="true"
                        desktop-placement="bottom-start"
                        desktop-class="w-56"
                        @update:open="(v) => (fileActionMenuPath = v ? entry.row.node.path : '')"
                        @update:query="(v) => (fileActionMenuQuery = v)"
                        @select="(item) => runTreeRowActionMenu(entry.row.node, item)"
                      />
                    </div>

                    <div v-else class="flex items-center gap-0.5">
                      <div v-if="entry.row.node.type === 'file'" class="relative" data-file-action-root="true">
                        <SidebarIconButton
                          size="sm"
                          :title="t('files.explorer.actions.fileActions')"
                          :active="fileActionMenuPath === entry.row.node.path"
                          @click.stop="toggleFileActionMenu(entry.row.node.path)"
                        >
                          <RiMore2Line class="h-3 w-3" />
                        </SidebarIconButton>
                        <OptionMenu
                          :open="fileActionMenuPath === entry.row.node.path"
                          :query="fileActionMenuQuery"
                          :groups="fileActionGroups"
                          :title="t('files.explorer.actions.fileActions')"
                          :mobile-title="t('files.explorer.actions.fileActions')"
                          :searchable="true"
                          filter-mode="internal"
                          :is-mobile-pointer="isMobile"
                          :desktop-fixed="true"
                          desktop-placement="bottom-start"
                          desktop-class="w-44"
                          @update:open="(v) => (fileActionMenuPath = v ? entry.row.node.path : '')"
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
  </section>
</template>
