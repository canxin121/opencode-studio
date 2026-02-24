import test from 'node:test'
import assert from 'node:assert/strict'

import { nextTick } from 'vue'

import { createTestHarness } from './testRuntime'

test('useChatModelSelection: restores per-session manual model after session switch', () => {
  const { chat, selection } = createTestHarness({ selectedSessionId: 'session-1' })

  selection.chooseModelSlug('manual-provider/manual-model')
  assert.equal(selection.selectedProviderId.value, 'manual-provider')
  assert.equal(selection.selectedModelId.value, 'manual-model')

  chat.selectedSessionId = 'session-2'
  chat.selectedSessionRunConfig = {
    providerID: 'session-provider',
    modelID: 'session-model',
    at: 1,
  }
  selection.resetSelectionForSessionSwitch()
  selection.applySessionSelection()

  assert.equal(selection.selectedProviderId.value, 'session-provider')
  assert.equal(selection.selectedModelId.value, 'session-model')

  chat.selectedSessionId = 'session-1'
  chat.selectedSessionRunConfig = { at: 2 }
  chat.messages = []
  selection.resetSelectionForSessionSwitch()
  selection.applySessionSelection()

  assert.equal(selection.selectedProviderId.value, 'manual-provider')
  assert.equal(selection.selectedModelId.value, 'manual-model')
})

test('useChatModelSelection: manual model overrides newer session run-config', () => {
  const { chat, selection } = createTestHarness({
    selectedSessionId: 'session-1',
    selectedSessionRunConfig: {
      providerID: 'session-provider',
      modelID: 'session-model',
      at: 1,
    },
  })

  selection.applySessionSelection()
  assert.equal(selection.selectedProviderId.value, 'session-provider')
  assert.equal(selection.selectedModelId.value, 'session-model')

  selection.chooseModelSlug('manual-provider/manual-model')
  chat.selectedSessionRunConfig = {
    providerID: 'new-session-provider',
    modelID: 'new-session-model',
    at: 2,
  }
  selection.applySessionSelection()

  assert.equal(selection.selectedProviderId.value, 'manual-provider')
  assert.equal(selection.selectedModelId.value, 'manual-model')
})

test('useChatModelSelection: chooseModelDefault clears manual history and falls back to defaults', () => {
  const { chat, selection } = createTestHarness({ selectedSessionId: 'session-1' })

  selection.providers.value = [
    {
      id: 'fallback-provider',
      name: 'Fallback Provider',
      models: [{ id: 'fallback-model' }],
    },
  ]

  selection.chooseModelSlug('manual-provider/manual-model')
  assert.equal(selection.selectedProviderId.value, 'manual-provider')
  assert.equal(selection.selectedModelId.value, 'manual-model')

  selection.chooseModelDefault()
  assert.equal(selection.selectedProviderId.value, 'fallback-provider')
  assert.equal(selection.selectedModelId.value, 'fallback-model')

  chat.selectedSessionRunConfig = { at: 3 }
  chat.messages = []
  selection.resetSelectionForSessionSwitch()
  selection.applySessionSelection()

  assert.equal(selection.selectedProviderId.value, 'fallback-provider')
  assert.equal(selection.selectedModelId.value, 'fallback-model')
})

test('useChatModelSelection: watch selectedSessionRunConfig.at triggers session apply', async () => {
  const { chat, selection } = createTestHarness({
    selectedSessionId: 'session-watch-run-config',
    selectedSessionRunConfig: {
      providerID: 'run-provider-1',
      modelID: 'run-model-1',
      at: 1,
    },
  })

  await nextTick()
  assert.equal(selection.selectedProviderId.value, 'run-provider-1')
  assert.equal(selection.selectedModelId.value, 'run-model-1')

  if (chat.selectedSessionRunConfig) {
    chat.selectedSessionRunConfig.providerID = 'run-provider-2'
    chat.selectedSessionRunConfig.modelID = 'run-model-2'
    chat.selectedSessionRunConfig.at = 2
  }

  await nextTick()
  assert.equal(selection.selectedProviderId.value, 'run-provider-2')
  assert.equal(selection.selectedModelId.value, 'run-model-2')
})

test('useChatModelSelection: watch messages.length triggers derived session apply', async () => {
  const { chat, selection } = createTestHarness({
    selectedSessionId: 'session-watch-messages',
    selectedSessionRunConfig: { at: 1 },
  })

  await nextTick()
  assert.equal(selection.selectedProviderId.value, '')
  assert.equal(selection.selectedModelId.value, '')

  chat.messages.push({
    info: {
      providerID: 'msg-provider-1',
      modelID: 'msg-model-1',
    },
  })

  await nextTick()
  assert.equal(selection.selectedProviderId.value, 'msg-provider-1')
  assert.equal(selection.selectedModelId.value, 'msg-model-1')

  chat.messages.push({
    info: {
      providerID: 'msg-provider-2',
      modelID: 'msg-model-2',
    },
  })

  await nextTick()
  assert.equal(selection.selectedProviderId.value, 'msg-provider-2')
  assert.equal(selection.selectedModelId.value, 'msg-model-2')
})
