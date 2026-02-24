import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import katex from 'katex'

import { highlightCodeToHtml } from '@/lib/highlight'

function safeLangClass(lang: string | undefined | null): string {
  const raw = typeof lang === 'string' ? lang.trim().toLowerCase() : ''
  if (!raw) return ''
  // Keep class safe + predictable.
  return raw.replace(/[^a-z0-9_+-]/g, '')
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function countLines(code: string): number {
  const normalized = normalizeNewlines(code)
  if (!normalized) return 0
  return normalized.split('\n').length
}

function isLargeBlock(code: string): boolean {
  const normalized = normalizeNewlines(code)
  return countLines(normalized) > 18 || normalized.length > 1400
}

function inlineIcon(name: 'copy' | 'check' | 'chevronDown' | 'chevronUp'): string {
  // Inline SVGs so markdown output stays self-contained (v-html).
  // Keep them simple + consistent with the rest of the UI.
  switch (name) {
    case 'copy':
      return `
<svg class="oc-md-codeblock__icon oc-md-codeblock__icon--copy" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 8V6.2C8 5.54 8.54 5 9.2 5H17.8C18.46 5 19 5.54 19 6.2V14.8C19 15.46 18.46 16 17.8 16H16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M7.2 9H14.8C15.46 9 16 9.54 16 10.2V17.8C16 18.46 15.46 19 14.8 19H7.2C6.54 19 6 18.46 6 17.8V10.2C6 9.54 6.54 9 7.2 9Z" stroke="currentColor" stroke-width="1.8"/>
</svg>`.trim()
    case 'check':
      return `
<svg class="oc-md-codeblock__icon oc-md-codeblock__icon--check" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M20 7L10.5 16.5L4 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`.trim()
    case 'chevronDown':
      return `
<svg class="oc-md-codeblock__icon oc-md-codeblock__icon--down" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`.trim()
    case 'chevronUp':
      return `
<svg class="oc-md-codeblock__icon oc-md-codeblock__icon--up" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 15L12 9L18 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`.trim()
  }
}

export type MarkdownUiLabels = {
  copyTitle: string
  copyCodeAria: string
  copyDiagramSourceAria: string
  toggleCodeAria: string
  toggleDiagramAria: string
  expandTitle: string
  expandCodeAria: string
  expandDiagramAria: string
  expandLinesTitle: (lines: number) => string
}

const DEFAULT_LABELS: MarkdownUiLabels = {
  copyTitle: 'Copy',
  copyCodeAria: 'Copy code',
  copyDiagramSourceAria: 'Copy diagram source',
  toggleCodeAria: 'Toggle code block',
  toggleDiagramAria: 'Toggle diagram',
  expandTitle: 'Expand',
  expandCodeAria: 'Expand code block',
  expandDiagramAria: 'Expand diagram',
  expandLinesTitle: (lines: number) => `Expand (${lines} lines)`,
}

let currentLabels: MarkdownUiLabels = DEFAULT_LABELS

function renderMermaidBlock(code: string): string {
  const normalized = normalizeNewlines(String(code ?? '')).trimEnd()
  const lines = countLines(normalized)
  const large = lines > 24 || normalized.length > 1800
  const expanded = !large

  const srcEsc = escapeHtml(normalized)
  const linesEsc = escapeHtml(String(lines))

  const toggleBtn = large
    ? `
<button type="button" class="oc-md-codeblock__iconbtn" data-oc-code-action="toggle" aria-label="${escapeHtml(currentLabels.toggleDiagramAria)}" title="${escapeHtml(currentLabels.expandLinesTitle(lines))}">
  ${inlineIcon('chevronDown')}
  ${inlineIcon('chevronUp')}
</button>`.trim()
    : ''

  const moreBtn = large
    ? `
<div class="oc-md-mermaid__morewrap">
  <button type="button" class="oc-md-codeblock__more" data-oc-code-action="toggle" aria-label="${escapeHtml(currentLabels.expandDiagramAria)}" title="${escapeHtml(currentLabels.expandTitle)}">
    ${inlineIcon('chevronDown')}
  </button>
</div>`.trim()
    : ''

  return `
<div class="not-prose oc-md-mermaid" data-oc-mermaidblock="1" data-oc-expanded="${expanded ? '1' : '0'}" data-oc-large="${large ? '1' : '0'}" data-oc-lines="${linesEsc}" data-oc-mermaid-status="pending">
  <div class="oc-md-codeblock__header">
    <span class="oc-md-codeblock__lang" title="mermaid">mermaid</span>
    <div class="oc-md-codeblock__actions">
      ${toggleBtn}
      <button type="button" class="oc-md-codeblock__iconbtn" data-oc-code-action="copy" aria-label="${escapeHtml(currentLabels.copyDiagramSourceAria)}" title="${escapeHtml(currentLabels.copyTitle)}">
        ${inlineIcon('copy')}
        ${inlineIcon('check')}
      </button>
    </div>
  </div>
  <div class="oc-md-mermaid__body">
    <div class="oc-md-mermaid__render" data-oc-mermaid-render="1"></div>
    <pre class="oc-md-mermaid__fallback" data-oc-mermaid-fallback="1"><code>${srcEsc}</code></pre>
    <pre class="oc-md-mermaid__source" data-oc-mermaid-source="1">${srcEsc}</pre>
    <div class="oc-md-mermaid__fade" aria-hidden="true"></div>
    ${moreBtn}
  </div>
</div>`.trim()
}

function renderFencedCodeBlock(code: string, lang?: string): string {
  const langClass = safeLangClass(lang)
  const label = langClass || 'text'
  const normalized = normalizeNewlines(String(code ?? ''))
  const lines = countLines(normalized)
  const large = isLargeBlock(normalized)
  const expanded = !large
  const highlighted = highlightCodeToHtml(normalized, langClass)
  const classAttr = langClass ? `language-${langClass}` : ''

  const langEsc = escapeHtml(label)
  const titleEsc = escapeHtml(label)
  const linesEsc = escapeHtml(String(lines))

  const toggleBtn = large
    ? `
<button type="button" class="oc-md-codeblock__iconbtn" data-oc-code-action="toggle" aria-label="${escapeHtml(currentLabels.toggleCodeAria)}" title="${escapeHtml(currentLabels.expandLinesTitle(lines))}">
  ${inlineIcon('chevronDown')}
  ${inlineIcon('chevronUp')}
</button>`.trim()
    : ''

  const moreBtn = large
    ? `
<div class="oc-md-codeblock__morewrap">
  <button type="button" class="oc-md-codeblock__more" data-oc-code-action="toggle" aria-label="${escapeHtml(currentLabels.expandCodeAria)}" title="${escapeHtml(currentLabels.expandTitle)}">
    ${inlineIcon('chevronDown')}
  </button>
</div>`.trim()
    : ''

  return `
<div class="not-prose oc-md-codeblock" data-oc-codeblock="1" data-oc-expanded="${expanded ? '1' : '0'}" data-oc-large="${large ? '1' : '0'}" data-oc-lang="${langEsc}" data-oc-lines="${linesEsc}">
  <div class="oc-md-codeblock__header">
    <span class="oc-md-codeblock__lang" title="${titleEsc}">${langEsc}</span>
    <div class="oc-md-codeblock__actions">
      ${toggleBtn}
      <button type="button" class="oc-md-codeblock__iconbtn" data-oc-code-action="copy" aria-label="${escapeHtml(currentLabels.copyCodeAria)}" title="${escapeHtml(currentLabels.copyTitle)}">
        ${inlineIcon('copy')}
        ${inlineIcon('check')}
      </button>
    </div>
  </div>
  <div class="oc-md-codeblock__body">
    <pre class="oc-md-pre"><code class="hljs ${classAttr}">${highlighted}</code></pre>
    <div class="oc-md-codeblock__fade" aria-hidden="true"></div>
    ${moreBtn}
  </div>
</div>`.trim()
}

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// Math: render $...$ and $$...$$ using KaTeX.
// Keep throwOnError disabled so partial/invalid math doesn't break rendering.
md.use(texmath, {
  engine: katex,
  // Support both $...$/$$...$$ and \(...\)/\[...\].
  delimiters: ['dollars', 'brackets'],
  katexOptions: { throwOnError: false },
})

// Render fenced/indented code blocks with a custom UI (lang label, copy, expand).
// This returns fully-formed HTML (safe: markdown-it `html:false` prevents raw HTML injection).
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx]
  const info = typeof t?.info === 'string' ? t.info : ''
  const lang = info.trim().split(/\s+/).filter(Boolean)[0] || ''
  if (String(lang).trim().toLowerCase() === 'mermaid') {
    return renderMermaidBlock(String(t?.content || ''))
  }
  return renderFencedCodeBlock(String(t?.content || ''), lang)
}
md.renderer.rules.code_block = (tokens, idx) => {
  const t = tokens[idx]
  return renderFencedCodeBlock(String(t?.content || ''), '')
}

// Open links safely by default.
const defaultLinkOpen = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token) {
    const href = token.attrGet('href')
    if (href && !href.startsWith('#')) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noreferrer noopener')
    }
  }
  if (defaultLinkOpen) return defaultLinkOpen(tokens, idx, options, env, self)
  return self.renderToken(tokens, idx, options)
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      // Remove all non-word characters (including ASCII and Unicode punctuation)
      // Keep letters (L), numbers (N), marks (M), and hyphens
      .replace(/[^\p{L}\p{N}\p{M}\-]/gu, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

// Add IDs to headings for TOC navigation.
md.core.ruler.push('add_heading_ids', (state) => {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token?.type === 'heading_open') {
      const inline = tokens[i + 1]
      if (inline && inline.type === 'inline') {
        const text = inline.content
        const slug = slugify(text)
        if (slug) {
          token.attrSet('data-oc-id', slug)
          // We don't set 'id' to avoid potential global collisions in the DOM,
          // instead we handle clicks on anchors manually in Markdown.vue.
        }
      }
    }
  }
})

export function renderMarkdown(content: string, labels?: Partial<MarkdownUiLabels>): string {
  currentLabels = { ...DEFAULT_LABELS, ...(labels || {}) }
  try {
    return md.render(String(content ?? ''))
  } finally {
    currentLabels = DEFAULT_LABELS
  }
}

// Convert markdown into plain text (used for thinking/justification parts).
// We intentionally drop fenced/code blocks and images to avoid noisy UI.
export function stripMarkdownToText(content: string): string {
  const src = String(content ?? '')
  if (!src.trim()) return ''

  const tokens = md.parse(src, {})
  const out: string[] = []

  const push = (v: string) => {
    if (!v) return
    out.push(v)
  }

  for (const t of tokens) {
    if (!t) continue
    if (t.type === 'fence' || t.type === 'code_block') continue

    if (t.type === 'inline' && Array.isArray(t.children)) {
      for (const c of t.children) {
        if (!c) continue
        if (c.type === 'text' || c.type === 'code_inline') push(String(c.content || ''))
        if (c.type === 'softbreak' || c.type === 'hardbreak') push('\n')
        // Skip images; link text is already captured by text nodes.
      }
      continue
    }

    // Insert breaks after block-level boundaries.
    if (
      t.type === 'paragraph_close' ||
      t.type === 'heading_close' ||
      t.type === 'blockquote_close' ||
      t.type === 'list_item_close'
    ) {
      push('\n')
    }
  }

  return out
    .join('')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
