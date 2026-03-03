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
