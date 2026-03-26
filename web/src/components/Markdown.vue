<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { onClickOutside } from '@vueuse/core'
import { RiListUnordered } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'
import { renderMarkdown, type MarkdownUiLabels } from '@/lib/markdown'
import { copyTextToClipboard } from '@/lib/clipboard'
import { resolveWorkspaceFileLink, resolveWorkspaceMediaUrl } from '@/lib/workspaceLinks'
import { useDirectoryStore } from '@/stores/directory'
import { useToastsStore } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    content: string
    mode?: 'markdown' | 'plain'
    sourcePath?: string
    revealAnchor?: string
    revealRequestSeq?: number
    // When true, debounce markdown parsing to avoid re-rendering on every SSE chunk.
    stream?: boolean
    streamDebounceMs?: number
  }>(),
  {
    mode: 'markdown',
    sourcePath: '',
    revealAnchor: '',
    revealRequestSeq: 0,
    stream: false,
    streamDebounceMs: 60,
  },
)

const html = ref('')
const rootEl = ref<HTMLElement | null>(null)
let timer: number | null = null
let copiedTimer: number | null = null
let mermaidTimer: number | null = null
let lastRevealAnchorKey = ''

// Table of Contents
type TocItem = { id: string; text: string; level: number }
const toc = ref<TocItem[]>([])
const showToc = ref(false)
const tocMenuRef = ref<HTMLElement | null>(null)

onClickOutside(tocMenuRef, () => {
  showToc.value = false
})

function scanToc() {
  if (!rootEl.value) {
    toc.value = []
    return
  }
  const headings = rootEl.value.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const items: TocItem[] = []

  headings.forEach((h) => {
    // Only include headings that have our generated ID (meaning they have valid content)
    const id = h.getAttribute('data-oc-id')
    if (id) {
      items.push({
        id,
        text: h.textContent || '',
        level: parseInt(h.tagName.substring(1), 10),
      })
    }
  })

  toc.value = items
}

function decodeAnchorId(rawId: string): string {
  const input = String(rawId || '').trim()
  if (!input) return ''
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function findHeadingByAnchor(rawId: string): HTMLElement | null {
  const id = decodeAnchorId(rawId)
  if (!id) return null

  const escaped = id.replace(/"/g, '\\"')
  let heading = rootEl.value?.querySelector(`[data-oc-id="${escaped}"]`) as HTMLElement | null
  if (heading) return heading

  // Loose match: normalize punctuation differences between external sluggers and ours.
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const target = normalize(id)
  if (!target) return null

  const headings = rootEl.value?.querySelectorAll('[data-oc-id]')
  if (!headings) return null
  for (const h of headings) {
    const hid = h.getAttribute('data-oc-id') || ''
    if (normalize(hid) === target) {
      heading = h as HTMLElement
      break
    }
  }

  return heading
}

function scrollToAnchor(rawId: string): boolean {
  const heading = findHeadingByAnchor(rawId)
  if (!heading) return false
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

function scrollToHeading(id: string) {
  showToc.value = false
  scrollToAnchor(id)
}

const toasts = useToastsStore()
const directoryStore = useDirectoryStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

function buildMarkdownLabels(): Partial<MarkdownUiLabels> {
  return {
    copyTitle: t('codeBlock.copy'),
    copyCodeAria: t('codeBlock.copyAria'),
    copyDiagramSourceAria: t('codeBlock.copyDiagramSourceAria'),
    toggleCodeAria: t('codeBlock.toggleCodeAria'),
    toggleDiagramAria: t('codeBlock.toggleDiagramAria'),
    expandTitle: t('codeBlock.expand'),
    expandCodeAria: t('codeBlock.expandAria'),
    expandDiagramAria: t('codeBlock.expandDiagramAria'),
    expandLinesTitle: (lines: number) => t('codeBlock.expandLines', { lines }),
  }
}

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function updateNow() {
  html.value = renderMarkdown(props.content, buildMarkdownLabels())
  // Scan TOC and rewrite local media links after rendering.
  nextTick(() => {
    scanToc()
    hydrateWorkspaceMedia()
  })
}

function hydrateWorkspaceMedia() {
  const root = rootEl.value
  const workspaceRoot = String(directoryStore.currentDirectory || '').trim()
  if (!root || !workspaceRoot) return

  const mediaNodes = root.querySelectorAll<HTMLElement>(
    'img[src], video[src], audio[src], video source[src], audio source[src]',
  )
  for (const node of mediaNodes) {
    const src = String(node.getAttribute('src') || '').trim()
    if (!src) continue

    const next = resolveWorkspaceMediaUrl(src, {
      workspaceRoot,
      baseFilePath: props.sourcePath,
    })
    if (!next || next === src) continue
    node.setAttribute('src', next)
  }
}

function openWorkspaceLink(href: string): boolean {
  const workspaceRoot = String(directoryStore.currentDirectory || '').trim()
  if (!workspaceRoot) return false

  const resolved = resolveWorkspaceFileLink(href, {
    workspaceRoot,
    baseFilePath: props.sourcePath,
  })
  if (!resolved?.path) return false

  if (route.path === '/files') {
    const nextQuery: Record<string, string | string[] | null | undefined> = { ...route.query }
    nextQuery.gitPath = resolved.path
    nextQuery.gitAction = 'open'
    if (resolved.line) nextQuery.gitLine = String(resolved.line)
    else delete nextQuery.gitLine
    if (resolved.column) nextQuery.gitColumn = String(resolved.column)
    else delete nextQuery.gitColumn
    if (resolved.anchor) nextQuery.gitAnchor = String(resolved.anchor)
    else delete nextQuery.gitAnchor
    void router.push({ path: '/files', query: nextQuery })
    return true
  }

  ui.requestWorkspaceDockFile(resolved.path, 'open', {
    line: resolved.line,
    column: resolved.column,
    anchor: resolved.anchor,
  })
  return true
}

function hashString(input: string): string {
  // Small non-cryptographic hash for caching rendered diagrams.
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

type MermaidRenderResult =
  | string
  | {
      svg?: string
      bindFunctions?: (element: Element) => void
    }

type MarkdownValue = unknown
type MarkdownRecord = Record<string, MarkdownValue>

type MermaidApi = {
  initialize: (config: MarkdownRecord) => void
  render: (id: string, source: string) => Promise<MermaidRenderResult>
}

type MermaidModule = MermaidApi & { default?: MermaidApi }
type MermaidImport = unknown

function isRecord(value: MarkdownValue): value is MarkdownRecord {
  return typeof value === 'object' && value !== null
}

function hasMermaidApi(value: MarkdownValue): value is MermaidApi {
  if (!isRecord(value)) return false
  return typeof value.initialize === 'function' && typeof value.render === 'function'
}

let mermaidImportPromise: Promise<MermaidImport> | null = null
let mermaidInitializedTheme: string | null = null
let mermaidIdSeq = 0

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidImportPromise) {
    mermaidImportPromise = import('mermaid')
  }
  const mod = await mermaidImportPromise
  if (hasMermaidApi(mod)) return mod
  if (isRecord(mod)) {
    const defaultExport = (mod as MermaidModule).default
    if (hasMermaidApi(defaultExport)) return defaultExport
  }
  throw new Error('Mermaid API unavailable')
}

function currentMermaidTheme(): string {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'neutral'
}

async function hydrateMermaid() {
  const root = rootEl.value
  if (!root) return

  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-oc-mermaidblock]'))
  if (!blocks.length) return

  const theme = currentMermaidTheme()
  const mermaid = await getMermaid()

  if (mermaidInitializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
    })
    mermaidInitializedTheme = theme
  }

  for (const block of blocks) {
    const srcEl = block.querySelector<HTMLElement>('[data-oc-mermaid-source]')
    const renderEl = block.querySelector<HTMLElement>('[data-oc-mermaid-render]')
    if (!srcEl || !renderEl) continue

    const source = (srcEl.textContent || '').trim()
    if (!source) continue

    const cacheKey = `${theme}:${hashString(source)}`
    if (block.dataset.ocMermaidHash === cacheKey && block.dataset.ocMermaidStatus === 'rendered') {
      continue
    }

    block.dataset.ocMermaidStatus = 'pending'
    renderEl.innerHTML = ''

    try {
      const id = `oc-mermaid-${++mermaidIdSeq}`
      const out = await mermaid.render(id, source)
      const svg = typeof out === 'string' ? out : out.svg
      if (typeof svg !== 'string' || !svg.trim()) {
        throw new Error('Mermaid render returned empty output')
      }
      renderEl.innerHTML = svg
      if (typeof out !== 'string') {
        out.bindFunctions?.(renderEl)
      }

      block.dataset.ocMermaidHash = cacheKey
      block.dataset.ocMermaidStatus = 'rendered'
    } catch {
      block.dataset.ocMermaidStatus = 'error'
    }
  }
}

function scheduleHydrateMermaid() {
  if (mermaidTimer) window.clearTimeout(mermaidTimer)
  mermaidTimer = window.setTimeout(() => {
    mermaidTimer = null
    void nextTick(() => hydrateMermaid())
  }, 50)
}

async function handleRootClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return

  // Handle TOC anchor links
  const link = target.closest('a')
  if (link) {
    const href = link.getAttribute('href')
    if (href && href.startsWith('#')) {
      event.preventDefault()
      const rawId = href.substring(1)
      if (!rawId) return

      if (scrollToAnchor(rawId)) return
      const decoded = decodeAnchorId(rawId)
      if (props.sourcePath && /^(?:L\d+(?:C\d+)?|\d+(?::\d+)?)$/i.test(decoded)) {
        // Support line-style fragments in markdown previews (e.g. #L42 / #42:3)
        // by treating them as "open current file at location".
        void openWorkspaceLink(`${props.sourcePath}#${decoded}`)
      }
      return
    }

    if (href && openWorkspaceLink(href)) {
      event.preventDefault()
      return
    }
  }

  const btn = target.closest?.('button[data-oc-code-action]') as HTMLButtonElement | null
  if (!btn) return
  const action = btn.getAttribute('data-oc-code-action') || ''
  const block = btn.closest?.('[data-oc-codeblock], [data-oc-mermaidblock]') as HTMLElement | null
  if (!block) return

  if (action === 'toggle') {
    const next = block.getAttribute('data-oc-expanded') === '1' ? '0' : '1'
    block.setAttribute('data-oc-expanded', next)
    return
  }

  if (action === 'copy') {
    const mermaidSrcEl = block.querySelector<HTMLElement>('[data-oc-mermaid-source]')
    const codeEl = block.querySelector('pre code') as HTMLElement | null
    const code = mermaidSrcEl?.textContent ?? codeEl?.textContent ?? ''
    const ok = await copyTextToClipboard(code)
    if (!ok) {
      toasts.push('error', t('common.copyFailed'))
      return
    }

    btn.setAttribute('data-oc-state', 'copied')
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      btn.removeAttribute('data-oc-state')
      copiedTimer = null
    }, 1200)
  }
}

function positiveInt(raw: unknown): number | undefined {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function applyRequestedAnchorReveal() {
  const anchor = String(props.revealAnchor || '').trim()
  if (!anchor) return

  const seq = positiveInt(props.revealRequestSeq) || 0
  const sourcePath = String(props.sourcePath || '').trim()
  const key = `${seq}:${sourcePath}:${anchor}`
  if (key === lastRevealAnchorKey) return

  if (scrollToAnchor(anchor)) {
    lastRevealAnchorKey = key
    return
  }

  if (sourcePath && /^(?:L\d+(?:C\d+)?|\d+(?::\d+)?)$/i.test(anchor) && openWorkspaceLink(`${sourcePath}#${anchor}`)) {
    lastRevealAnchorKey = key
  }
}

onMounted(() => {
  // Event delegation: rendered markdown comes from v-html.
  rootEl.value?.addEventListener('click', handleRootClick)
  scheduleHydrateMermaid()
})

watch(
  () => [props.mode, props.content, props.sourcePath, props.stream, props.streamDebounceMs] as const,
  () => {
    clearTimer()
    if (props.mode !== 'markdown') {
      html.value = ''
      return
    }
    if (!props.stream) {
      updateNow()
      scheduleHydrateMermaid()
      return
    }
    const delay = Math.max(0, Math.floor(props.streamDebounceMs || 0))
    timer = window.setTimeout(() => {
      updateNow()
      scheduleHydrateMermaid()
    }, delay)
  },
  { immediate: true },
)

watch(
  () => [directoryStore.currentDirectory, props.sourcePath] as const,
  () => {
    void nextTick(() => hydrateWorkspaceMedia())
  },
)

watch(
  () => [props.revealRequestSeq, props.revealAnchor, html.value] as const,
  () => {
    void nextTick(() => applyRequestedAnchorReveal())
  },
)

onBeforeUnmount(() => {
  clearTimer()
  if (copiedTimer) {
    window.clearTimeout(copiedTimer)
    copiedTimer = null
  }
  if (mermaidTimer) {
    window.clearTimeout(mermaidTimer)
    mermaidTimer = null
  }
  rootEl.value?.removeEventListener('click', handleRootClick)
})
</script>

<template>
  <div v-if="mode === 'plain'" class="whitespace-pre-wrap break-words">{{ content }}</div>
  <div v-else class="relative group">
    <!-- TOC Overlay: Absolute wrapper to ensure it doesn't take up layout space, but stays sticky -->
    <div v-if="toc.length > 0" class="absolute inset-0 pointer-events-none z-10 h-full">
      <div class="sticky top-0 flex justify-end p-2">
        <div
          class="relative pointer-events-auto transition-opacity duration-200"
          :class="[showToc ? 'opacity-100' : 'opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-100']"
          ref="tocMenuRef"
        >
          <button
            type="button"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border bg-background/80 backdrop-blur shadow-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            @click="showToc = !showToc"
            :title="t('markdown.tableOfContents')"
          >
            <RiListUnordered class="w-4 h-4" />
          </button>

          <!-- TOC Dropdown -->
          <div
            v-if="showToc"
            class="absolute top-full right-0 mt-1 w-56 max-w-[80vw] max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg p-1.5 z-50 text-sm origin-top-right animate-in fade-in zoom-in-95 duration-100"
          >
            <nav class="flex flex-col">
              <button
                v-for="item in toc"
                :key="item.id"
                type="button"
                class="text-left px-2 py-1.5 rounded-sm hover:bg-accent hover:text-accent-foreground truncate transition-colors"
                :class="{ 'font-medium': item.level === 1 }"
                :style="{ paddingLeft: `${(item.level - 1) * 0.75 + 0.5}rem` }"
                @click="scrollToHeading(item.id)"
                :title="item.text"
              >
                {{ item.text }}
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <div ref="rootEl" class="prose prose-sm max-w-none break-words" v-html="html" />
  </div>
</template>
