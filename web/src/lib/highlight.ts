import hljs from 'highlight.js/lib/core'

import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

// Register common languages once. This module is imported in multiple renderers
// (markdown/code/diff) and should stay lightweight.
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('go', go)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

export { hljs }

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function highlightCodeToHtml(code: string, lang?: string): string {
  const value = String(code ?? '')
  if (!value) return ''

  const requested = typeof lang === 'string' ? lang.trim().toLowerCase() : ''
  if (requested === 'text' || requested === 'plain' || requested === 'plaintext') {
    return escapeHtml(value)
  }
  try {
    if (requested && hljs.getLanguage(requested)) {
      return hljs.highlight(value, { language: requested, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(value).value
  } catch {
    return escapeHtml(value)
  }
}
