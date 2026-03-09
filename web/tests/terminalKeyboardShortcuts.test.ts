import assert from 'node:assert/strict'
import test from 'node:test'
import { handleTerminalKeyboardShortcut } from '../src/features/terminal/lib/terminalKeyboardShortcuts'

type EventShape = {
  event: KeyboardEvent
  prevented: () => boolean
  stopped: () => boolean
}

function makeKeydownEvent(
  key: string,
  mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; code?: string },
): EventShape {
  let preventCount = 0
  let stopCount = 0
  const event = {
    type: 'keydown',
    key,
    code: mods?.code || '',
    ctrlKey: Boolean(mods?.ctrl),
    shiftKey: Boolean(mods?.shift),
    altKey: Boolean(mods?.alt),
    metaKey: Boolean(mods?.meta),
    preventDefault: () => {
      preventCount += 1
    },
    stopPropagation: () => {
      stopCount += 1
    },
  } as unknown as KeyboardEvent
  return {
    event,
    prevented: () => preventCount > 0,
    stopped: () => stopCount > 0,
  }
}

function createTerminal(selection: string) {
  let pasted = ''
  return {
    pasted: () => pasted,
    terminal: {
      hasSelection: () => Boolean(selection),
      getSelection: () => selection,
      paste: (text: string) => {
        pasted = text
      },
    },
  }
}

test('Ctrl+C copies when terminal has selection', async () => {
  const { terminal } = createTerminal('hello')
  let copied = ''
  let interrupted = false
  const key = makeKeydownEvent('c', { ctrl: true })

  const handled = handleTerminalKeyboardShortcut(key.event, {
    terminal: terminal as any,
    copyTextToClipboard: async (text) => {
      copied = text
      return true
    },
    readTextFromClipboard: async () => '',
    sendInterrupt: () => {
      interrupted = true
    },
  })

  await Promise.resolve()
  assert.equal(handled, true)
  assert.equal(copied, 'hello')
  assert.equal(interrupted, false)
  assert.equal(key.prevented(), true)
  assert.equal(key.stopped(), true)
})

test('Ctrl+C sends ETX when no selection', () => {
  const { terminal } = createTerminal('')
  let interrupted = false
  const key = makeKeydownEvent('c', { ctrl: true })

  const handled = handleTerminalKeyboardShortcut(key.event, {
    terminal: terminal as any,
    copyTextToClipboard: async () => true,
    readTextFromClipboard: async () => '',
    sendInterrupt: () => {
      interrupted = true
    },
  })

  assert.equal(handled, true)
  assert.equal(interrupted, true)
  assert.equal(key.prevented(), true)
  assert.equal(key.stopped(), true)
})

test('Ctrl+Shift+V and Shift+Insert paste clipboard content', async () => {
  const first = createTerminal('')
  const second = createTerminal('')
  const ctrlShiftV = makeKeydownEvent('v', { ctrl: true, shift: true })
  const shiftInsert = makeKeydownEvent('Insert', { shift: true, code: 'Insert' })

  const handledCtrlShiftV = handleTerminalKeyboardShortcut(ctrlShiftV.event, {
    terminal: first.terminal as any,
    copyTextToClipboard: async () => true,
    readTextFromClipboard: async () => 'alpha',
    sendInterrupt: () => {},
  })
  const handledShiftInsert = handleTerminalKeyboardShortcut(shiftInsert.event, {
    terminal: second.terminal as any,
    copyTextToClipboard: async () => true,
    readTextFromClipboard: async () => 'beta',
    sendInterrupt: () => {},
  })

  await Promise.resolve()
  assert.equal(handledCtrlShiftV, true)
  assert.equal(handledShiftInsert, true)
  assert.equal(first.pasted(), 'alpha')
  assert.equal(second.pasted(), 'beta')
})

test('Cmd+C and Cmd+V handle copy/paste on macOS', async () => {
  const copyTerminal = createTerminal('mac-copy')
  const pasteTerminal = createTerminal('')
  const cmdC = makeKeydownEvent('c', { meta: true })
  const cmdV = makeKeydownEvent('v', { meta: true })
  let copied = ''
  let interrupted = false

  const handledCmdC = handleTerminalKeyboardShortcut(cmdC.event, {
    terminal: copyTerminal.terminal as any,
    copyTextToClipboard: async (text) => {
      copied = text
      return true
    },
    readTextFromClipboard: async () => '',
    sendInterrupt: () => {
      interrupted = true
    },
  })

  const handledCmdV = handleTerminalKeyboardShortcut(cmdV.event, {
    terminal: pasteTerminal.terminal as any,
    copyTextToClipboard: async () => true,
    readTextFromClipboard: async () => 'mac-paste',
    sendInterrupt: () => {
      interrupted = true
    },
  })

  await Promise.resolve()
  assert.equal(handledCmdC, true)
  assert.equal(handledCmdV, true)
  assert.equal(copied, 'mac-copy')
  assert.equal(pasteTerminal.pasted(), 'mac-paste')
  assert.equal(interrupted, false)
  assert.equal(cmdC.prevented(), true)
  assert.equal(cmdC.stopped(), true)
  assert.equal(cmdV.prevented(), true)
  assert.equal(cmdV.stopped(), true)
})

test('non-matching modifier combos are not handled', () => {
  const combos = [
    makeKeydownEvent('c', { ctrl: true, alt: true }),
    makeKeydownEvent('c', { meta: true, shift: true }),
    makeKeydownEvent('v', { meta: true, shift: true }),
    makeKeydownEvent('v', { ctrl: true, meta: true }),
  ]

  for (const combo of combos) {
    const { terminal } = createTerminal('ignored')
    const handled = handleTerminalKeyboardShortcut(combo.event, {
      terminal: terminal as any,
      copyTextToClipboard: async () => true,
      readTextFromClipboard: async () => 'ignored',
      sendInterrupt: () => {},
    })

    assert.equal(handled, false)
    assert.equal(combo.prevented(), false)
    assert.equal(combo.stopped(), false)
  }
})
