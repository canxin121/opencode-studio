import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('narrow composer layout keeps requested chip rows and pinned actions', () => {
  const file = resolve(import.meta.dir, '../src/pages/chat/ChatPageView.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("composer-controls-surface w-full flex flex-row items-center justify-between gap-2 rounded-b-xl border-t border-border/60 bg-background/60 p-2 sm:px-2.5"))
})
