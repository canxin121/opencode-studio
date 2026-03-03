import type { Terminal } from '@xterm/xterm'

type TerminalShortcutDeps = {
  terminal: Terminal | null
  copyTextToClipboard: (text: string) => Promise<boolean>
  readTextFromClipboard: () => Promise<string>
  sendInterrupt: () => void
}

type ShortcutAction = 'copy' | 'interrupt' | 'paste'

function keyOf(event: KeyboardEvent): string {
  return String(event.key || '').toLowerCase()
}

function isInsertKey(event: KeyboardEvent): boolean {
  return keyOf(event) === 'insert' || event.code === 'Insert'
}

function classifyShortcut(event: KeyboardEvent, hasSelection: boolean): ShortcutAction | null {
  const key = keyOf(event)
  const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey
  const metaOnly = event.metaKey && !event.ctrlKey && !event.altKey
  const noCtrlMetaAlt = !event.ctrlKey && !event.metaKey && !event.altKey

  if (ctrlOnly && event.shiftKey && key === 'c') return 'copy'
  if (ctrlOnly && isInsertKey(event) && !event.shiftKey) return 'copy'
  if (ctrlOnly && key === 'c' && !event.shiftKey) return hasSelection ? 'copy' : 'interrupt'

  if (ctrlOnly && key === 'v') return 'paste'
  if (noCtrlMetaAlt && event.shiftKey && isInsertKey(event)) return 'paste'
  if (metaOnly && (key === 'c' || key === 'v')) return key === 'c' ? 'copy' : 'paste'

  return null
}

function stopEvent(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
}

async function runCopy(deps: TerminalShortcutDeps) {
  const selected = String(deps.terminal?.getSelection() || '')
  if (!selected) return
  await deps.copyTextToClipboard(selected)
}

async function runPaste(deps: TerminalShortcutDeps) {
  const target = deps.terminal
  if (!target) return
  const text = String((await deps.readTextFromClipboard()) || '')
  if (!text) return
  target.paste(text)
}

export function handleTerminalKeyboardShortcut(event: KeyboardEvent, deps: TerminalShortcutDeps): boolean {
  const target = deps.terminal
  const hasSelection = Boolean(target?.hasSelection() && target.getSelection())
  const action = classifyShortcut(event, hasSelection)
  if (!action) return false

  stopEvent(event)

  if (action === 'copy') {
    void runCopy(deps)
    return true
  }

  if (action === 'interrupt') {
    deps.sendInterrupt()
    return true
  }

  void runPaste(deps)
  return true
}
