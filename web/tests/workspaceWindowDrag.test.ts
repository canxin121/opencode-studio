import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WORKSPACE_WINDOW_DRAG_MIME,
  hasWorkspaceWindowDragDataTransfer,
  readWorkspaceWindowDragIdFromDataTransfer,
  readWorkspaceWindowTemplateFromDataTransfer,
  writeWorkspaceWindowTemplateToDataTransfer,
} from '../src/layout/workspaceWindowDrag.ts'

class MockDataTransfer {
  private readonly store = new Map<string, string>()

  get types(): string[] {
    return Array.from(this.store.keys())
  }

  setData(type: string, value: string) {
    this.store.set(type, value)
  }

  getData(type: string): string {
    return this.store.get(type) || ''
  }
}

test('workspace drag helpers ignore arbitrary plain text payloads', () => {
  const transfer = new MockDataTransfer()
  transfer.setData('text/plain', 'hello world')

  assert.equal(hasWorkspaceWindowDragDataTransfer(transfer as unknown as DataTransfer), false)
  assert.equal(readWorkspaceWindowDragIdFromDataTransfer(transfer as unknown as DataTransfer), '')
  assert.equal(readWorkspaceWindowTemplateFromDataTransfer(transfer as unknown as DataTransfer), null)
})

test('workspace drag helpers ignore legacy-like plain text that is not a valid workspace payload', () => {
  const transfer = new MockDataTransfer()
  transfer.setData('text/plain', 'files:not-json')

  assert.equal(hasWorkspaceWindowDragDataTransfer(transfer as unknown as DataTransfer), false)
  assert.equal(readWorkspaceWindowTemplateFromDataTransfer(transfer as unknown as DataTransfer), null)
})

test('workspace drag helpers still accept workspace template plain text fallback', () => {
  const transfer = new MockDataTransfer()
  const wrote = writeWorkspaceWindowTemplateToDataTransfer(transfer as unknown as DataTransfer, {
    tab: 'files',
    query: { filePath: 'src/main.ts' },
    title: 'main.ts',
    matchKeys: ['filePath'],
  })

  assert.equal(wrote, true)
  assert.equal(hasWorkspaceWindowDragDataTransfer(transfer as unknown as DataTransfer), true)
  assert.deepEqual(readWorkspaceWindowTemplateFromDataTransfer(transfer as unknown as DataTransfer), {
    tab: 'files',
    query: { filePath: 'src/main.ts' },
    title: 'main.ts',
    matchKeys: ['filePath'],
  })
})

test('workspace drag id reader only trusts dedicated workspace mime data', () => {
  const transfer = new MockDataTransfer()
  transfer.setData('text/plain', 'workspace-window-123')
  assert.equal(readWorkspaceWindowDragIdFromDataTransfer(transfer as unknown as DataTransfer), '')

  const workspaceTransfer = new MockDataTransfer()
  workspaceTransfer.setData(WORKSPACE_WINDOW_DRAG_MIME, 'workspace-window-123')
  assert.equal(
    readWorkspaceWindowDragIdFromDataTransfer(workspaceTransfer as unknown as DataTransfer),
    'workspace-window-123',
  )
})
