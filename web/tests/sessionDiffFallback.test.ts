import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSessionDiffFallbackFromMessages } from '../src/stores/chat/sessionDiffFallback'

test('buildSessionDiffFallbackFromMessages: parses unified diff metadata and normalizes directory path', () => {
  const messages = [
    {
      info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_1', time: { created: 1, completed: 1 } },
      parts: [
        {
          id: 'part_1',
          type: 'tool',
          state: {
            metadata: {
              diff: [
                'Index: /repo/docs/guide.md',
                '===================================================================',
                '--- /repo/docs/guide.md',
                '+++ /repo/docs/guide.md',
                '@@ -1,2 +1,3 @@',
                ' intro',
                '-old line',
                '+new line',
                '+added line',
              ].join('\n'),
            },
          },
        },
      ],
    },
  ] as any

  const out = buildSessionDiffFallbackFromMessages(messages, '/repo')
  assert.deepEqual(out, [
    {
      file: 'docs/guide.md',
      before: '',
      after: '',
      additions: 2,
      deletions: 1,
      diff: [
        'Index: /repo/docs/guide.md',
        '===================================================================',
        '--- /repo/docs/guide.md',
        '+++ /repo/docs/guide.md',
        '@@ -1,2 +1,3 @@',
        ' intro',
        '-old line',
        '+new line',
        '+added line',
      ].join('\n'),
    },
  ])
})

test('buildSessionDiffFallbackFromMessages: latest patch updates counts and keeps snapshots', () => {
  const messages = [
    {
      info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_1', time: { created: 1, completed: 1 } },
      parts: [
        {
          id: 'part_1',
          type: 'tool',
          state: {
            metadata: {
              files: [
                {
                  path: '/repo/src/main.ts',
                  before: 'const a = 1\n',
                  after: 'const a = 2\n',
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
    },
    {
      info: { id: 'msg_2', role: 'assistant', sessionID: 'ses_1', time: { created: 2, completed: 2 } },
      parts: [
        {
          id: 'part_2',
          type: 'tool',
          state: {
            metadata: {
              diff: [
                'diff --git a/src/main.ts b/src/main.ts',
                '--- a/src/main.ts',
                '+++ b/src/main.ts',
                '@@ -1 +1,3 @@',
                '-const a = 2',
                '+const a = 2',
                '+const b = 3',
                '+const c = 4',
              ].join('\n'),
            },
          },
        },
      ],
    },
  ] as any

  const out = buildSessionDiffFallbackFromMessages(messages, '/repo')
  assert.deepEqual(out, [
    {
      file: 'src/main.ts',
      before: 'const a = 1\n',
      after: 'const a = 2\n',
      additions: 3,
      deletions: 1,
      diff: [
        'diff --git a/src/main.ts b/src/main.ts',
        '--- a/src/main.ts',
        '+++ b/src/main.ts',
        '@@ -1 +1,3 @@',
        '-const a = 2',
        '+const a = 2',
        '+const b = 3',
        '+const c = 4',
      ].join('\n'),
    },
  ])
})

test('buildSessionDiffFallbackFromMessages: accepts filePath/relativePath metadata fields', () => {
  const messages = [
    {
      info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_1', time: { created: 1, completed: 1 } },
      parts: [
        {
          id: 'part_1',
          type: 'tool',
          state: {
            metadata: {
              files: [
                {
                  filePath: '/repo/docs/index.md',
                  relativePath: 'docs/index.md',
                  before: 'old\n',
                  after: 'new\n',
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
    },
  ] as any

  const out = buildSessionDiffFallbackFromMessages(messages, '/repo')
  assert.deepEqual(out, [
    {
      file: 'docs/index.md',
      before: 'old\n',
      after: 'new\n',
      additions: 1,
      deletions: 1,
    },
  ])
})
