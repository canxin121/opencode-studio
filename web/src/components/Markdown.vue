<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { RiListUnordered } from '@remixicon/vue'
import { renderMarkdown } from '@/lib/markdown'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useToastsStore } from '@/stores/toasts'

const props = withDefaults(
  defineProps<{
    content: string
    mode?: 'markdown' | 'plain'
    // When true, debounce markdown parsing to avoid re-rendering on every SSE chunk.
    stream?: boolean
    streamDebounceMs?: number
  }>(),
  {
    mode: 'markdown',
    stream: false,
    streamDebounceMs: 60,
  },
)

const html = ref('')
const rootEl = ref<HTMLElement | null>(null)
let timer: number | null = null
let copiedTimer: number | null = null
let mermaidTimer: number | null = null

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

function scrollToHeading(id: string) {
  showToc.value = false
  const heading = rootEl.value?.querySelector(`[data-oc-id="${id}"]`)
  if (heading) {
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const toasts = useToastsStore()

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function updateNow() {
  html.value = renderMarkdown(props.content)
  // Scan TOC after rendering
  nextTick(() => scanToc())
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

      // Decode URI components to handle Chinese/special characters in URL hashes
      const id = decodeURIComponent(rawId)

      // Try exact match first (standard slug)
      let heading = rootEl.value?.querySelector(`[data-oc-id="${id.replace(/"/g, '\\"')}"]`)

      // If not found, try a "loose" match.
      // The slug algorithm might differ between what generated the link (e.g. LLM)
      // and our strict slugify function (e.g. regarding punctuation).
      // We strip everything down to just letters/numbers for comparison.
      if (!heading) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
        const target = normalize(id)

        if (target) {
          const headings = rootEl.value?.querySelectorAll('[data-oc-id]')
          if (headings) {
            for (const h of headings) {
              const hid = h.getAttribute('data-oc-id') || ''
              if (normalize(hid) === target) {
                heading = h as HTMLElement
                break
              }
            }
          }
        }
      }

      if (heading) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
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
      toasts.push('error', 'Copy failed')
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

onMounted(() => {
  // Event delegation: rendered markdown comes from v-html.
  rootEl.value?.addEventListener('click', handleRootClick)
  scheduleHydrateMermaid()
})

watch(
  () => [props.mode, props.content, props.stream, props.streamDebounceMs] as const,
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
            title="Table of Contents"
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
