import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractSessionId,
  normalizeMessageInfoFromPartEvent,
  normalizeMessageInfoFromSse,
  normalizeMessagePartFromSse,
} from '../src/stores/chat/reducers'
import type { SseEvent } from '../src/lib/sse'

test('normalizeMessageInfoFromSse accepts camelCase session id alias', () => {
  const evt: SseEvent = {
    type: 'message.updated',
    properties: {
      info: {
        id: 'msg_1',
        sessionId: 'ses_camel',
        role: 'assistant',
        time: { created: 10 },
      },
    },
  }

  const info = normalizeMessageInfoFromSse(evt)
  assert.ok(info)
  assert.equal(info?.id, 'msg_1')
  assert.equal(info?.sessionID, 'ses_camel')
})

test('normalizeMessageInfoFromSse accepts snake_case session id alias', () => {
  const evt: SseEvent = {
    type: 'message.updated',
    properties: {
      info: {
        id: 'msg_2',
        session_id: 'ses_snake',
        role: 'assistant',
        time: { created: 20 },
      },
    },
  }

  const info = normalizeMessageInfoFromSse(evt)
  assert.ok(info)
  assert.equal(info?.sessionID, 'ses_snake')
})

test('normalizeMessageInfoFromPartEvent accepts messageId/sessionId aliases', () => {
  const evt: SseEvent = {
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'part_1',
        sessionId: 'ses_part',
        messageId: 'msg_part',
        time: { created: 30 },
      },
    },
  }

  const info = normalizeMessageInfoFromPartEvent(evt)
  assert.ok(info)
  assert.equal(info?.id, 'msg_part')
  assert.equal(info?.sessionID, 'ses_part')
})

test('normalizeMessagePartFromSse accepts partId fallback', () => {
  const evt: SseEvent = {
    type: 'message.part.updated',
    properties: {
      partId: 'part_camel',
      delta: 'hello',
    },
  }

  const part = normalizeMessagePartFromSse(evt, 'msg_delta', 'ses_delta')
  assert.ok(part)
  assert.equal(part?.id, 'part_camel')
  assert.equal(part?.messageID, 'msg_delta')
  assert.equal(part?.sessionID, 'ses_delta')
})

test('extractSessionId accepts sessionId alias at properties root', () => {
  const evt: SseEvent = {
    type: 'session.updated',
    properties: {
      sessionId: 'ses_root_alias',
    },
  }

  assert.equal(extractSessionId(evt), 'ses_root_alias')
})
