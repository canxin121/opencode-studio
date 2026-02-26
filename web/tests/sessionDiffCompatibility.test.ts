import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeSessionDiffPagePayload, normalizeSessionDiffPayload } from '../src/stores/chat/api'
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

test('normalizeSessionDiffPayload: keeps optional diff metadata for virtual rendering', () => {
  const payload = [
    {
      file: 'src/main.ts',
      additions: 1,
      deletions: 1,
      patch: 'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n',
      meta: {
        fileHeader: ['diff --git a/src/main.ts b/src/main.ts', '--- a/src/main.ts', '+++ b/src/main.ts'],
        hasPatchHeader: true,
        hunks: [],
        summary: { files: 1, hunks: 0, changedLines: 2 },
      },
    },
  ]

  assert.deepEqual(normalizeSessionDiffPayload(payload), [
    {
      file: 'src/main.ts',
      before: '',
      after: '',
      additions: 1,
      deletions: 1,
      diff: 'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n',
      meta: {
        fileHeader: ['diff --git a/src/main.ts b/src/main.ts', '--- a/src/main.ts', '+++ b/src/main.ts'],
        hasPatchHeader: true,
        hunks: [],
        summary: { files: 1, hunks: 0, changedLines: 2 },
      },
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

test('normalizeSessionDiffPagePayload: honors paging metadata and hasMore', () => {
  const page = normalizeSessionDiffPagePayload({
    items: [
      {
        path: 'src/main.ts',
        old: 'before\n',
        new: 'after\n',
        added: 1,
        removed: 1,
      },
    ],
    total: 12,
    offset: 0,
    limit: 1,
    hasMore: true,
    nextOffset: 1,
  })

  assert.equal(page.items.length, 1)
  assert.equal(page.offset, 0)
  assert.equal(page.limit, 1)
  assert.equal(page.hasMore, true)
  assert.equal(page.nextOffset, 1)
  assert.equal(page.total, 12)
})

test('normalizeSessionDiffPagePayload: infers next page for bare arrays', () => {
  const page = normalizeSessionDiffPagePayload(
    [
      {
        file: 'README.md',
        before: 'old\n',
        after: 'new\n',
        additions: 1,
        deletions: 1,
      },
      {
        file: 'src/a.ts',
        before: 'a\n',
        after: 'b\n',
        additions: 1,
        deletions: 1,
      },
    ],
    { fallbackOffset: 0, fallbackLimit: 2 },
  )

  assert.equal(page.items.length, 2)
  assert.equal(page.hasMore, true)
  assert.equal(page.nextOffset, 2)
})
