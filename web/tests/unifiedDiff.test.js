import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildUnifiedDiffModel,
  buildUnifiedMonacoDiffModel,
  buildVirtualMonacoDiffModel,
} from '../src/features/git/diff/unifiedDiff.ts'

const SAMPLE_DIFF =
  'diff --git a/a.txt b/a.txt\n' +
  'index 1111111..2222222 100644\n' +
  '--- a/a.txt\n' +
  '+++ b/a.txt\n' +
  '@@ -1,3 +1,3 @@\n' +
  ' keep\n' +
  '-old\n' +
  '+new\n' +
  ' keep\n'

test('buildUnifiedDiffModel parses unified diff fallback', () => {
  const parsed = buildUnifiedDiffModel(SAMPLE_DIFF)
  assert.equal(parsed.summary.files, 1)
  assert.equal(parsed.summary.hunks, 1)
  assert.equal(parsed.summary.changedLines, 2)
  assert.equal(parsed.hunks.length, 1)
  assert.equal(parsed.hunks[0]?.range, '-1,3 +1,3')
  assert.equal(parsed.hunks[0]?.additions, 1)
  assert.equal(parsed.hunks[0]?.deletions, 1)
  assert.equal(Boolean(parsed.hunks[0]?.patchReady), true)
  assert.match(parsed.hunks[0]?.patch || '', /@@ -1,3 \+1,3 @@/)
})

test('buildUnifiedDiffModel normalizes server metadata payload', () => {
  const parsed = buildUnifiedDiffModel(SAMPLE_DIFF, {
    fileHeader: ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt'],
    hasPatchHeader: true,
    hunks: [
      {
        id: 'h1',
        header: '@@ -4,2 +4,3 @@',
        range: '-4,2 +4,3',
        oldStart: 4,
        oldCount: 2,
        newStart: 4,
        newCount: 3,
        additions: 2,
        deletions: 1,
        anchorLine: 5,
        lines: [' keep', '-before', '+after', '+tail'],
        patch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -4,2 +4,3 @@\n keep\n-before\n+after\n+tail\n',
        patchReady: true,
      },
    ],
    summary: { files: 1, hunks: 1, changedLines: 3 },
  })

  assert.equal(parsed.summary.changedLines, 3)
  assert.equal(parsed.hunks.length, 1)
  assert.equal(parsed.hunks[0]?.id, 'h1')
  assert.equal(parsed.hunks[0]?.anchorLine, 5)
  assert.equal(parsed.hunks[0]?.patchReady, true)
  assert.match(parsed.hunks[0]?.patch || '', /^diff --git a\/a\.txt b\/a\.txt/m)
})

test('buildUnifiedMonacoDiffModel builds Monaco-ready before/after text', () => {
  const model = buildUnifiedMonacoDiffModel(SAMPLE_DIFF)
  assert.equal(model.modelId, 'diff:a.txt')
  assert.equal(model.path, 'a.txt')
  assert.equal(model.hasChanges, true)
  assert.match(model.original, /@@ -1,3 \+1,3 @@\nkeep\nold\nkeep/)
  assert.match(model.modified, /@@ -1,3 \+1,3 @@\nkeep\nnew\nkeep/)
})

test('buildUnifiedMonacoDiffModel falls back to raw patch when hunks missing', () => {
  const raw = 'diff --git a/a.txt b/a.txt\nindex 111..222 100644\n--- a/a.txt\n+++ b/a.txt\n'
  const model = buildUnifiedMonacoDiffModel(raw)
  assert.equal(model.modelId, 'diff:a.txt')
  assert.equal(model.path, 'a.txt')
  assert.equal(model.hasChanges, false)
  assert.equal(model.original, raw)
  assert.equal(model.modified, raw)
})

test('buildVirtualMonacoDiffModel supports direct snapshots without real path', () => {
  const model = buildVirtualMonacoDiffModel({
    modelId: 'activity:file:1',
    original: 'old\n',
    modified: 'new\n',
  })
  assert.equal(model.modelId, 'activity:file:1')
  assert.equal(model.path, 'virtual.diff')
  assert.equal(model.hasChanges, true)
  assert.equal(model.original, 'old\n')
  assert.equal(model.modified, 'new\n')
})

test('buildVirtualMonacoDiffModel falls back to diff/meta when snapshots missing', () => {
  const model = buildVirtualMonacoDiffModel({
    path: 'src/a.ts',
    diff: SAMPLE_DIFF,
  })
  assert.equal(model.modelId, 'virtual:src/a.ts')
  assert.equal(model.path, 'src/a.ts')
  assert.equal(model.hasChanges, true)
  assert.match(model.original, /old/)
  assert.match(model.modified, /new/)
})

test('buildVirtualMonacoDiffModel can prefer patch rendering over full snapshots', () => {
  const model = buildVirtualMonacoDiffModel({
    path: 'src/a.ts',
    original: 'keep\nold\nkeep\n',
    modified: 'keep\nnew\nkeep\n',
    diff: SAMPLE_DIFF,
    preferPatch: true,
  })
  assert.equal(model.path, 'src/a.ts')
  assert.equal(model.hasChanges, true)
  assert.match(model.original, /@@ -1,3 \+1,3 @@\nkeep\nold\nkeep/)
  assert.match(model.modified, /@@ -1,3 \+1,3 @@\nkeep\nnew\nkeep/)
})

test('buildVirtualMonacoDiffModel can compact large snapshots into diff-focused windows', () => {
  const original = ['line 1', 'line 2', 'line 3', 'old', 'line 5', 'line 6', 'line 7'].join('\n')
  const modified = ['line 1', 'line 2', 'line 3', 'new', 'line 5', 'line 6', 'line 7'].join('\n')
  const model = buildVirtualMonacoDiffModel({
    original,
    modified,
    compactSnapshots: true,
    contextLines: 1,
  })
  assert.equal(model.hasChanges, true)
  assert.match(model.original, /\.\.\. \(omitted\)/)
  assert.match(model.modified, /\.\.\. \(omitted\)/)
  assert.match(model.original, /old/)
  assert.match(model.modified, /new/)
})

test('buildVirtualMonacoDiffModel falls back to snapshots when preferred patch has no change lines', () => {
  const patchWithoutChangedLines =
    'diff --git a/a.txt b/a.txt\n' + '--- a/a.txt\n' + '+++ b/a.txt\n' + '@@ -1,1 +1,1 @@\n'

  const model = buildVirtualMonacoDiffModel({
    path: 'a.txt',
    original: 'old\n',
    modified: 'new\n',
    diff: patchWithoutChangedLines,
    preferPatch: true,
  })

  assert.equal(model.path, 'a.txt')
  assert.equal(model.hasChanges, true)
  assert.equal(model.original, 'old\n')
  assert.equal(model.modified, 'new\n')
})
