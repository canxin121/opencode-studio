<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiJson } from '@/lib/api'
import { normalizeFsPath, trimTrailingFsSlashes } from '@/lib/path'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import { useUiStore } from '@/stores/ui'
import {
  RiArrowRightSLine,
  RiAddLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileTextLine,
  RiFolder3Line,
  RiGitBranchLine,
} from '@remixicon/vue'

type ListEntry = {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink?: boolean
}

type ListResponse = {
  path: string
  entries: ListEntry[]
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    placeholder?: string
    basePath?: string
    mode?: 'file' | 'directory' | 'any'
    // `compact`: input + Browse toggle; `browser`: show only the browser panel.
    view?: 'compact' | 'browser'
    browserTitle?: string
    browserDescription?: string
    preferRelative?: boolean
    resolveToAbsolute?: boolean
    showOptions?: boolean
    showHidden?: boolean
    showGitignored?: boolean
    disabled?: boolean
    inputClass?: string
    buttonClass?: string
    buttonLabel?: string
    browserClass?: string
    allowCreateDirectory?: boolean
  }>(),
  {
    mode: 'any',
    view: 'compact',
    preferRelative: false,
    resolveToAbsolute: false,
    showOptions: false,
    showHidden: false,
    buttonLabel: '',
    allowCreateDirectory: false,
  },
)

const { t } = useI18n()
const ui = useUiStore()

const effectiveButtonLabel = computed(
  () => String(props.buttonLabel || '').trim() || String(t('ui.pathPicker.actions.browse')),
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const value = computed<string>({
  get: () => props.modelValue ?? '',
  set: (v: string) => {
    emit('update:modelValue', v)
    emit('change', v)
  },
})

const browserOpen = ref(false)
const browserPath = ref('')
const browserQuery = ref('')
const browserFoldersOnly = ref(false)
const browserEntries = ref<ListEntry[]>([])
const browserLoading = ref(false)
const browserError = ref<string | null>(null)
const createFolderName = ref('')
const createFolderLoading = ref(false)
const createFolderError = ref<string | null>(null)

const showHidden = ref(Boolean(props.showHidden))
const showGitignored = ref(Boolean(props.showGitignored))
const effectiveRespectGitignore = computed(() => !showGitignored.value)

function trimTrailingSlash(path: string): string {
  return trimTrailingFsSlashes(path)
}

function isAbsolutePath(path: string): boolean {
  const normalized = normalizeFsPath(path)
  if (!normalized) return false
  if (normalized.startsWith('/') || normalized.startsWith('~')) return true
  return /^[A-Za-z]:\//.test(normalized)
}

function joinPath(base: string, suffix: string): string {
  const leftRaw = normalizeFsPath(base)
  const rightRaw = normalizeFsPath(suffix)
  if (!leftRaw) return rightRaw
  if (!rightRaw) return leftRaw
  const left = trimTrailingSlash(leftRaw)
  const right = rightRaw.replace(/^\/+/, '')
  return `${left}/${right}`
}

function splitInput(raw: string) {
  const clean = normalizeFsPath(raw)
  const lastSlash = clean.lastIndexOf('/')
  if (lastSlash >= 0) {
    return {
      raw: clean,
      dirPart: clean.slice(0, lastSlash + 1),
      prefix: clean.slice(lastSlash + 1),
    }
  }
  return { raw: clean, dirPart: '', prefix: clean }
}

const context = computed(() => {
  const base = trimTrailingSlash(props.basePath || '')
  const { raw, dirPart, prefix } = splitInput(value.value)
  const absolute = isAbsolutePath(raw)
  let effectiveDir = ''
  if (absolute) {
    effectiveDir = dirPart || raw
  } else if (base) {
    effectiveDir = joinPath(base, dirPart)
  } else {
    effectiveDir = dirPart
  }
  return {
    raw,
    dirPart,
    prefix,
    absolute,
    effectiveDir,
    base,
  }
})

const browserBreadcrumbs = computed(() => {
  const path = normalizeFsPath(browserPath.value)
  if (!path) return [] as Array<{ label: string; path: string }>
  const driveMatch = path.match(/^[A-Za-z]:\//)
  const driveRoot = driveMatch ? driveMatch[0] : ''
  const rest = driveRoot ? path.slice(driveRoot.length) : path
  const parts = rest.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = driveRoot
    ? [{ label: driveRoot, path: driveRoot }]
    : [{ label: '/', path: '/' }]
  let current = driveRoot ? driveRoot.replace(/\/$/, '') : ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : `/${part}`
    crumbs.push({ label: part, path: current })
  }
  return crumbs
})

function formatOutputPath(absPath: string): string {
  const base = context.value.base
  if (props.resolveToAbsolute || !base) return absPath
  if (props.preferRelative && absPath.startsWith(`${base}/`)) {
    return absPath.slice(base.length + 1)
  }
  return absPath
}

async function fetchList(path: string): Promise<ListResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const gitignore = effectiveRespectGitignore.value ? `${query ? '&' : '?'}respectGitignore=true` : ''
  return apiJson<ListResponse>(`/api/fs/list${query}${gitignore}`)
}

function updateValue(next: string) {
  value.value = next
}

function resolveBrowserDraftPath(raw: string): string {
  const t = trimTrailingSlash((raw || '').trim())
  if (!t) return ''
  if (isAbsolutePath(t)) return t
  const base = trimTrailingSlash(props.basePath || '')
  if (base) return joinPath(base, t)
  return t
}

async function loadBrowser(path: string) {
  browserLoading.value = true
  browserError.value = null
  try {
    const resp = await fetchList(path)
    browserPath.value = resp.path
    // For directory pickers, the "current folder" is the selection.
    if (props.mode === 'directory') {
      updateValue(formatOutputPath(resp.path))
    }
    const list = (resp.entries || [])
      .filter((entry) => (showHidden.value ? true : !entry.name.startsWith('.')))
      .slice()
      .sort((a, b) => {
        // Put non-hidden first for better UX.
        const ah = a.name.startsWith('.')
        const bh = b.name.startsWith('.')
        if (ah !== bh) return ah ? 1 : -1
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    browserEntries.value = list
  } catch (err) {
    browserError.value = err instanceof Error ? err.message : String(err)
    browserEntries.value = []
  } finally {
    browserLoading.value = false
  }
}

function normalizeNewFolderName(raw: string): string {
  return String(raw || '').trim()
}

function validateNewFolderName(raw: string): string | null {
  const name = normalizeNewFolderName(raw)
  if (!name) return String(t('ui.pathPicker.errors.invalidFolderName'))
  if (name === '.' || name === '..') return String(t('ui.pathPicker.errors.invalidFolderName'))
  if (name.includes('/') || name.includes('\\')) return String(t('ui.pathPicker.errors.invalidFolderName'))
  return null
}

const canCreateFolder = computed(() => {
  if (!props.allowCreateDirectory) return false
  if (createFolderLoading.value) return false
  if (!browserPath.value) return false
  return normalizeNewFolderName(createFolderName.value).length > 0
})

async function createFolderInCurrentPath() {
  if (!props.allowCreateDirectory) return
  createFolderError.value = null

  const validationError = validateNewFolderName(createFolderName.value)
  if (validationError) {
    createFolderError.value = validationError
    return
  }

  const parentPath = trimTrailingSlash(browserPath.value)
  if (!parentPath) {
    createFolderError.value = String(t('ui.pathPicker.errors.selectDirectoryFirst'))
    return
  }

  const folderName = normalizeNewFolderName(createFolderName.value)
  try {
    createFolderLoading.value = true
    await apiJson<{ success: boolean }>(`/api/fs/mkdir?directory=${encodeURIComponent(parentPath)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: folderName }),
    })
    const nextPath = joinPath(parentPath, folderName)
    createFolderName.value = ''
    await loadBrowser(parentPath)
    applyBrowserPath(nextPath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    createFolderError.value = String(t('ui.pathPicker.errors.createFolderFailed', { error: reason }))
  } finally {
    createFolderLoading.value = false
  }
}

async function openBrowser() {
  if (props.disabled) return
  browserOpen.value = true
  browserQuery.value = ''
  createFolderName.value = ''
  createFolderError.value = null
  browserFoldersOnly.value = false
  const ctx = context.value
  let start = ''
  if (ctx.absolute && ctx.raw) {
    // Directory pickers are usually pointed at a directory; for file pickers we
    // want to start from the parent directory.
    start = props.mode === 'directory' ? ctx.raw : ctx.effectiveDir || ctx.raw
  } else {
    start = ctx.base || ''
  }
  await loadBrowser(start)
}

function closeBrowser() {
  browserOpen.value = false
}

function applyBrowserPath(path: string) {
  updateValue(formatOutputPath(path))
  // In compact mode, selecting is usually a one-off.
  if (props.view === 'compact') {
    closeBrowser()
  }
}

function goToBrowserDraft() {
  const next = resolveBrowserDraftPath(value.value)
  if (!next) return
  void loadBrowser(next)
}

function selectBrowserEntry(entry: ListEntry) {
  if (entry.isDirectory) {
    void loadBrowser(entry.path)
    return
  }
  if (props.mode === 'directory') return
  applyBrowserPath(entry.path)
}

const effectiveFoldersOnly = computed(() => {
  if (props.mode === 'directory') return true
  if (props.mode === 'file') return false
  return browserFoldersOnly.value
})

const filteredBrowserEntries = computed(() => {
  const q = (browserQuery.value || '').trim().toLowerCase()
  return (browserEntries.value || [])
    .filter((e) => (effectiveFoldersOnly.value ? e.isDirectory : true))
    .filter((e) => {
      if (!q) return true
      return e.name.toLowerCase().includes(q)
    })
})

watch(
  () => [showHidden.value, showGitignored.value],
  () => {
    if (browserOpen.value) {
      void loadBrowser(browserPath.value || '')
    }
  },
)

const browserVisible = computed(() => props.view === 'browser' || browserOpen.value)

watch(
  () => [props.view, props.basePath],
  () => {
    if (props.view === 'browser' && !browserOpen.value) {
      void openBrowser()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="relative">
    <div v-if="props.view === 'compact'" class="flex items-center gap-2">
      <Input v-model="value" :placeholder="placeholder" :disabled="disabled" class="min-w-0" :class="inputClass" />
      <Button
        variant="outline"
        size="sm"
        type="button"
        @click="browserOpen ? closeBrowser() : openBrowser()"
        :disabled="disabled"
        :class="buttonClass"
      >
        {{ browserOpen ? t('common.hide') : effectiveButtonLabel }}
      </Button>
    </div>

    <div v-if="browserVisible" class="mt-3">
      <div v-if="browserTitle || browserDescription" class="mb-2">
        <div v-if="browserTitle" class="typography-ui-label font-semibold">{{ browserTitle }}</div>
        <div v-if="browserDescription" class="typography-micro text-muted-foreground">{{ browserDescription }}</div>
      </div>

      <div class="flex flex-col gap-3" :class="browserClass || 'min-h-[50vh] max-h-[50vh]'">
        <div class="flex items-center gap-2 flex-wrap">
          <Input
            v-model="value"
            :placeholder="placeholder || t('ui.pathPicker.placeholders.path')"
            class="min-w-0 flex-1 font-mono"
            @keydown.enter.prevent="goToBrowserDraft"
          />

          <Button
            variant="outline"
            size="sm"
            type="button"
            @click="goToBrowserDraft"
            :disabled="!value.trim()"
            :class="buttonClass"
          >
            {{ t('ui.pathPicker.actions.go') }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-1 text-xs">
          <button
            v-for="crumb in browserBreadcrumbs"
            :key="crumb.path"
            type="button"
            class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent"
            @click="loadBrowser(crumb.path)"
          >
            <span>{{ crumb.label }}</span>
            <RiArrowRightSLine class="h-3 w-3" />
          </button>
        </div>

        <div class="flex items-center justify-between gap-2 flex-wrap">
          <Input v-model="browserQuery" :placeholder="t('ui.pathPicker.placeholders.filter')" class="min-w-0 flex-1" />

          <div class="flex items-center gap-1">
            <template v-if="showOptions">
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                class="h-8 w-8"
                :class="showHidden ? 'bg-secondary/60' : ''"
                :tooltip="showHidden ? t('ui.pathPicker.titles.hiddenShown') : t('ui.pathPicker.titles.hiddenHidden')"
                :is-mobile-pointer="ui.isMobilePointer"
                :title="showHidden ? t('ui.pathPicker.titles.hiddenShown') : t('ui.pathPicker.titles.hiddenHidden')"
                :aria-pressed="showHidden"
                :aria-label="t('ui.pathPicker.aria.toggleHidden')"
                @click="showHidden = !showHidden"
              >
                <RiEyeLine v-if="showHidden" class="h-4 w-4" />
                <RiEyeOffLine v-else class="h-4 w-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                class="h-8 w-8"
                :class="showGitignored ? 'bg-secondary/60' : ''"
                :tooltip="
                  showGitignored
                    ? t('ui.pathPicker.titles.gitignoredShown')
                    : t('ui.pathPicker.titles.gitignoredHidden')
                "
                :is-mobile-pointer="ui.isMobilePointer"
                :title="
                  showGitignored
                    ? t('ui.pathPicker.titles.gitignoredShown')
                    : t('ui.pathPicker.titles.gitignoredHidden')
                "
                :aria-pressed="showGitignored"
                :aria-label="t('ui.pathPicker.aria.toggleGitignored')"
                @click="showGitignored = !showGitignored"
              >
                <RiGitBranchLine class="h-4 w-4" :class="showGitignored ? '' : 'opacity-50'" />
              </IconButton>
            </template>

            <Button
              v-if="mode === 'any'"
              variant="outline"
              size="sm"
              type="button"
              :aria-pressed="browserFoldersOnly"
              @click="browserFoldersOnly = !browserFoldersOnly"
              :class="buttonClass"
            >
              {{ browserFoldersOnly ? t('ui.pathPicker.actions.foldersOnly') : t('common.all') }}
            </Button>
          </div>
        </div>

        <div v-if="allowCreateDirectory" class="grid gap-1">
          <div class="flex items-center gap-2">
            <Input
              v-model="createFolderName"
              :placeholder="t('ui.pathPicker.placeholders.newFolderName')"
              class="min-w-0 flex-1"
              @keydown.enter.prevent="createFolderInCurrentPath"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              :disabled="!canCreateFolder"
              :class="buttonClass"
              @click="createFolderInCurrentPath"
            >
              <RiAddLine class="h-4 w-4" />
              <span>{{ t('ui.pathPicker.actions.createFolder') }}</span>
            </Button>
          </div>
          <div v-if="createFolderError" class="text-xs text-destructive">{{ createFolderError }}</div>
        </div>

        <div class="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
          <div v-if="browserLoading" class="px-3 py-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
          <div v-else-if="browserError" class="px-3 py-3 text-xs text-destructive">{{ browserError }}</div>
          <div v-else class="h-full overflow-auto">
            <button
              v-for="entry in filteredBrowserEntries"
              :key="entry.path"
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              @click="selectBrowserEntry(entry)"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span class="text-muted-foreground">
                  <RiFolder3Line v-if="entry.isDirectory" class="h-4 w-4" />
                  <RiFileTextLine v-else class="h-4 w-4" />
                </span>
                <span class="min-w-0 truncate" :title="entry.name">{{ entry.name }}</span>
              </div>
              <span v-if="entry.isDirectory" class="text-xs text-muted-foreground">{{ t('common.open') }}</span>
            </button>
            <div v-if="filteredBrowserEntries.length === 0" class="px-3 py-3 text-xs text-muted-foreground">
              {{ t('ui.pathPicker.empty.noMatches') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
