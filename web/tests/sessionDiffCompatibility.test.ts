import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSessionDiffPayload } from '../src/stores/chat/api'
import { extractSessionId } from '../src/stores/chat/reducers'

test('normalizeSessionDiffPayload: accepts wrapped payload and alternate field names', () => {
  const payload = {
    data: {
      files: [
        {
          path: 'src/main.ts',
          old: 'const before = true\n',
          new: 'const after = true\n',
          added: 1,
          removed: 1,
        },
      ],
    },
  }

  assert.deepEqual(normalizeSessionDiffPayload(payload), [
    {
      file: 'src/main.ts',
      before: 'const before = true\n',
      after: 'const after = true\n',
      additions: 1,
      deletions: 1,
    },
  ])
})

test('normalizeSessionDiffPayload: accepts direct entry object shape', () => {
  const payload = {
    filename: 'README.md',
    before: '# old\n',
    after: '# new\n',
    linesAdded: 2,
    linesDeleted: 0,
  }

  assert.deepEqual(normalizeSessionDiffPayload(payload), [
    {
      file: 'README.md',
      before: '# old\n',
      after: '# new\n',
      additions: 2,
      deletions: 0,
    },
  ])
})

test('normalizeSessionDiffPayload: accepts filePath and relativePath aliases', () => {
  const payload = [
    {
      filePath: '/repo/src/index.ts',
      before: 'a\n',
      after: 'b\n',
      additions: 1,
      deletions: 1,
    },
    {
      relativePath: 'docs/guide.md',
      before: 'old\n',
      after: 'new\n',
      additions: 3,
      deletions: 2,
    },
  ]

  assert.deepEqual(normalizeSessionDiffPayload(payload), [
    {
      file: '/repo/src/index.ts',
      before: 'a\n',
      after: 'b\n',
      additions: 1,
      deletions: 1,
    },
    {
      file: 'docs/guide.md',
      before: 'old\n',
      after: 'new\n',
      additions: 3,
      deletions: 2,
    },
  ])
})

test('extractSessionId: accepts camelCase and snake_case session keys', () => {
  assert.equal(
    extractSessionId({
      type: 'session.diff',
      properties: { sessionId: 'session-camel' },
    }),
    'session-camel',
  )

  assert.equal(
    extractSessionId({
      type: 'session.diff',
      properties: { part: { session_id: 'session-snake' } },
    }),
    'session-snake',
  )
})
