<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'

import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui-base'
import { ColorSchemeType } from 'diff2html/lib-esm/types'
import 'diff2html/bundles/css/diff2html.min.css'

import { hljs } from '@/lib/highlight'

const props = withDefaults(
  defineProps<{
    diff: string // Unified diff string
    outputFormat?: 'line-by-line' | 'side-by-side'
    drawFileList?: boolean
    highlight?: boolean
    wrap?: boolean
  }>(),
  {
    wrap: false,
  },
)

const container = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)

const themeTick = ref(0)
let themeObserver: MutationObserver | null = null

onMounted(() => {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  themeObserver = new MutationObserver(() => {
    themeTick.value += 1
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  if (pendingFrame !== null) {
    window.cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }
  themeObserver?.disconnect()
  themeObserver = null
})

const trimmed = computed(() => (props.diff || '').trim())

let pendingFrame: number | null = null

watchEffect(() => {
  const target = container.value
  if (!target) return

  // Re-render when the app theme toggles.
  void themeTick.value

  error.value = null

  const diff = trimmed.value
  if (!diff) {
    target.innerHTML = ''
    return
  }

  // Coalesce rapid changes (e.g. clicking multiple files quickly) into a single
  // render on the next frame.
  if (pendingFrame !== null) {
    window.cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }

  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = null
    try {
      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      const ui = new Diff2HtmlUI(
        target,
        diff,
        {
          drawFileList: Boolean(props.drawFileList),
          colorScheme: isDark ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
          matching: 'lines',
          outputFormat: props.outputFormat || 'side-by-side',
          renderNothingWhenEmpty: false,
          // Keep the widget focused: no extra toggles or sticky headers.
          fileListToggle: false,
          fileContentToggle: false,
          stickyFileHeaders: false,
          smartSelection: false,
          highlight: Boolean(props.highlight),
          synchronisedScroll: (props.outputFormat || 'side-by-side') === 'side-by-side',
        },
        hljs,
      )
      ui.draw()
    } catch (e) {
      console.error(e)
      error.value = 'Failed to render diff'
      target.innerHTML = ''
    }
  })
})
</script>

<template>
  <div class="diff-container">
    <div v-if="!trimmed" class="p-4 text-center text-muted-foreground">No diff content.</div>
    <div v-else-if="error" class="p-4 text-red-500 bg-red-500/10 rounded">{{ error }}</div>
    <div v-else ref="container" class="diff-content" :class="{ 'diff-content--wrapped': props.wrap }" />
  </div>
</template>

<style>
.diff-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.diff-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;

  /* Local diff2html tuning knobs */
  /* Keep diffs compact (tighter than diff2html defaults). */
  --oc-diff-line-height: 1.25;
  /* Line-by-line view uses a combined (old+new) gutter; default is very wide. */
  --oc-diff-linenumber-width: 6em;
  --oc-diff-code-pad: 6.6em;
}
/*
  diff2html styling
  Goal: keep diff2html's layout rules intact (it relies on absolute-positioned
  line-number cells + matching paddings), and only tune typography/theme.
  The previous overrides tried to "fix" layout by forcing table-cells and
  rewriting padding/white-space, which commonly breaks line number alignment.
*/

.diff-content .d2h-wrapper {
  margin: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;

  /* Theme bridge via diff2html CSS variables (light + dark). */
  --d2h-bg-color: oklch(var(--background));
  --d2h-border-color: oklch(var(--border));
  --d2h-line-border-color: oklch(var(--border) / 0.6);
  --d2h-dim-color: oklch(var(--muted-foreground) / 0.65);
  --d2h-file-header-bg-color: oklch(var(--muted) / 0.35);
  --d2h-file-header-border-color: oklch(var(--border));
  --d2h-selected-color: oklch(var(--primary) / 0.16);

  --d2h-dark-color: oklch(var(--foreground));
  --d2h-dark-bg-color: oklch(var(--background));
  --d2h-dark-border-color: oklch(var(--border));
  --d2h-dark-line-border-color: oklch(var(--border) / 0.6);
  --d2h-dark-dim-color: oklch(var(--muted-foreground) / 0.65);
  --d2h-dark-file-header-bg-color: oklch(var(--muted) / 0.2);
  --d2h-dark-file-header-border-color: oklch(var(--border));
  --d2h-dark-selected-color: oklch(var(--primary) / 0.16);
}

.diff-content .d2h-file-list-wrapper,
.diff-content .d2h-file-wrapper {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

/* Keep the view focused (no list/stats/headers); the caller can enable if needed. */
.diff-content .d2h-file-header {
  display: none !important;
}
.diff-content .d2h-file-stats {
  display: none;
}

/* Make multiple file diffs feel like one continuous surface. */
.diff-content .d2h-file-wrapper {
  border: none;
  border-radius: 0;
  margin: 0;
  background: transparent;
}
.diff-content .d2h-file-wrapper + .d2h-file-wrapper {
  border-top: 1px solid oklch(var(--border) / 0.7);
}

/* Typography + alignment: use one line-height everywhere. */
.diff-content .d2h-diff-table {
  font-family: var(--font-mono) !important;
  font-size: var(--text-code);

  /*
    Make long lines readable on narrow viewports:
    let the table grow to its content width, and rely on the container's
    horizontal scrolling instead of wrapping every character.
  */
  width: max-content;
  min-width: 100%;
}

/*
  Keep code lines intact; use horizontal scroll rather than wrapping.

  Important: do NOT set `white-space: pre` on `.d2h-code-line` itself.
  diff2html's markup contains whitespace between prefix/content nodes; if we
  preserve it, the +/- prefix can render on its own line.
*/
.diff-content .d2h-code-line,
.diff-content .d2h-code-side-line {
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}
.diff-content .d2h-code-line-prefix,
.diff-content .d2h-code-line-ctn,
.diff-content .d2h-code-side-line-ctn {
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.diff-content.diff-content--wrapped .d2h-code-line,
.diff-content.diff-content--wrapped .d2h-code-side-line,
.diff-content.diff-content--wrapped .d2h-code-line-prefix,
.diff-content.diff-content--wrapped .d2h-code-line-ctn,
.diff-content.diff-content--wrapped .d2h-code-side-line-ctn {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.diff-content .d2h-diff-table,
.diff-content .d2h-code-line,
.diff-content .d2h-code-side-line,
.diff-content .d2h-code-linenumber,
.diff-content .d2h-code-side-linenumber {
  line-height: var(--oc-diff-line-height);
}
.diff-content .d2h-code-linenumber,
.diff-content .d2h-code-side-linenumber,
.diff-content .line-num1,
.diff-content .line-num2 {
  font-variant-numeric: tabular-nums;
}

/* Reduce gutter + code padding (diff2html defaults are extremely roomy). */
.diff-content .line-num1,
.diff-content .line-num2 {
  width: 2.9em;
  padding: 0 0.25em;
}

.diff-content .d2h-code-linenumber {
  width: var(--oc-diff-linenumber-width);
}

.diff-content .d2h-code-line {
  padding: 0 var(--oc-diff-code-pad);
  width: calc(100% - (var(--oc-diff-code-pad) + var(--oc-diff-code-pad)));
}

/*
  Scroll fix (without rewriting diff2html layout)
  diff2html positions line number cells as `position: absolute`. If no
  positioned ancestor exists, they can end up anchored to the viewport.
  Give each table row a containing block so gutters scroll with the code.
*/
.diff-content .d2h-diff-tbody > tr {
  position: relative;
}

/* Side-by-side polish: clearer split and less "two separate scroll views" feel. */
.diff-content .d2h-files-diff {
  width: 100%;
}
.diff-content .d2h-file-side-diff {
  overflow-x: auto;
}
.diff-content .d2h-file-side-diff + .d2h-file-side-diff {
  border-left: 1px solid oklch(var(--border) / 0.7);
}

/* Reduce visual noise from diff2html icons. */
.diff-content .d2h-icon-wrapper {
  display: none;
}

/* Mobile: prefer horizontal swipe/scroll for diffs (no forced wrapping). */
</style>
