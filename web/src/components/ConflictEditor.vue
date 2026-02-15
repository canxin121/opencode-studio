<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import { apiErrorBodyRecord, apiJson, ApiError } from '@/lib/api'

type ConflictBlock = {
  id: number
  oursLabel?: string | null
  baseLabel?: string | null
  theirsLabel?: string | null
  ours: string
  base: string
  theirs: string
}

type ConflictFileResponse = {
  path: string
  text: string
  blocks: ConflictBlock[]
  hasMarkers: boolean
  isUnmerged: boolean
}

const props = defineProps<{ directory: string; path: string; conflictPaths?: string[] }>()
const emit = defineEmits<{
  (e: 'resolved'): void
  (e: 'fallbackDiff'): void
  (e: 'selectConflict', path: string): void
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const file = ref<ConflictFileResponse | null>(null)

const choices = ref<Record<number, 'ours' | 'theirs' | 'base' | 'both'>>({})

function resetChoices(blocks: ConflictBlock[]) {
  const next: Record<number, 'ours' | 'theirs' | 'base' | 'both'> = {}
  for (const b of blocks) next[b.id] = 'ours'
  choices.value = next
}

async function load() {
  const dir = (props.directory || '').trim()
  const path = (props.path || '').trim()
  if (!dir || !path) return
  loading.value = true
  error.value = null
  try {
    const resp = await apiJson<ConflictFileResponse>(
      `/api/git/conflicts/file?directory=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`,
    )
    file.value = resp
    resetChoices(resp.blocks || [])
  } catch (e) {
    file.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function nextConflictPath(): string | null {
  if (conflictTotal.value <= 1 || conflictIndex.value < 0) return null
  const next = (conflictIndex.value + 1) % conflictTotal.value
  const path = conflictFiles.value[next] || ''
  const current = (props.path || '').trim()
  if (!path || path === current) return null
  return path
}

async function resolve(strategy: 'ours' | 'theirs' | 'base' | 'both' | 'manual', advance = false) {
  const dir = (props.directory || '').trim()
  const path = (props.path || '').trim()
  if (!dir || !path) return
  const nextPath = advance ? nextConflictPath() : null
  loading.value = true
  error.value = null
  try {
    const body: {
      path: string
      strategy: 'ours' | 'theirs' | 'base' | 'both' | 'manual'
      stage: boolean
      choices?: Array<{ id: number; choice: 'ours' | 'theirs' | 'base' | 'both' }>
    } = { path, strategy, stage: true }
    if (strategy === 'manual') {
      body.choices = Object.entries(choices.value).map(([id, choice]) => ({ id: Number(id), choice }))
    }
    await apiJson(`/api/git/conflicts/resolve?directory=${encodeURIComponent(dir)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    emit('resolved')
    if (nextPath) {
      emit('selectConflict', nextPath)
      return
    }
    await load()
  } catch (e) {
    if (e instanceof ApiError) {
      const body = apiErrorBodyRecord(e)
      const out = typeof body?.stdout === 'string' ? body.stdout : ''
      const err = typeof body?.stderr === 'string' ? body.stderr : ''
      error.value = [e.message, err, out].filter(Boolean).join('\n\n')
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    loading.value = false
  }
}

const blocks = computed(() => file.value?.blocks || [])
const hasMarkers = computed(() => file.value?.hasMarkers === true)
const isUnmerged = computed(() => file.value?.isUnmerged === true)
const hasBase = computed(() => blocks.value.some((b) => !!(b.base || '').trim() || !!(b.baseLabel || '').trim()))
const canCheckoutResolve = computed(() => hasMarkers.value || isUnmerged.value)
const conflictFiles = computed(() => {
  const list = Array.isArray(props.conflictPaths) ? props.conflictPaths : []
  return list.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => !!item)
})
const conflictIndex = computed(() => {
  const p = (props.path || '').trim()
  if (!p) return -1
  return conflictFiles.value.indexOf(p)
})
const conflictTotal = computed(() => conflictFiles.value.length)

function selectRelativeConflict(offset: number) {
  if (conflictTotal.value <= 1 || conflictIndex.value < 0) return
  const next = (conflictIndex.value + offset + conflictTotal.value) % conflictTotal.value
  const path = conflictFiles.value[next]
  if (!path) return
  emit('selectConflict', path)
}

watch(
  () => [props.directory, props.path] as const,
  () => void load(),
)

onMounted(() => void load())
</script>

<template>
  <div class="ce">
    <div class="ce-header">
      <div class="ce-title">
        <div class="ce-kicker">Resolve conflicts</div>
        <div class="ce-path" :title="path">{{ path }}</div>
      </div>
      <div class="ce-actions">
        <div v-if="conflictTotal > 1" class="ce-nav">
          <Button
            variant="secondary"
            size="sm"
            class="h-8"
            :disabled="loading || conflictIndex < 0"
            @click="selectRelativeConflict(-1)"
          >
            Prev
          </Button>
          <div class="ce-nav-label">{{ Math.max(conflictIndex + 1, 1) }} / {{ conflictTotal }}</div>
          <Button
            variant="secondary"
            size="sm"
            class="h-8"
            :disabled="loading || conflictIndex < 0"
            @click="selectRelativeConflict(1)"
          >
            Next
          </Button>
        </div>
        <Button variant="secondary" size="sm" class="h-8" :disabled="loading" @click="load">Refresh</Button>
        <Button
          variant="secondary"
          size="sm"
          class="h-8"
          :disabled="loading || !canCheckoutResolve"
          @click="resolve('ours')"
          >Take Ours</Button
        >
        <Button
          v-if="conflictTotal > 1"
          variant="secondary"
          size="sm"
          class="h-8"
          :disabled="loading || !canCheckoutResolve"
          @click="resolve('ours', true)"
          >Ours & Next</Button
        >
        <Button
          variant="secondary"
          size="sm"
          class="h-8"
          :disabled="loading || !canCheckoutResolve"
          @click="resolve('theirs')"
          >Take Theirs</Button
        >
        <Button
          v-if="conflictTotal > 1"
          variant="secondary"
          size="sm"
          class="h-8"
          :disabled="loading || !canCheckoutResolve"
          @click="resolve('theirs', true)"
          >Theirs & Next</Button
        >
        <Button
          v-if="hasBase"
          variant="secondary"
          size="sm"
          class="h-8"
          :disabled="loading || !hasMarkers"
          @click="resolve('base')"
          >Take Base</Button
        >
        <Button variant="secondary" size="sm" class="h-8" :disabled="loading || !hasMarkers" @click="resolve('both')"
          >Take Both</Button
        >
        <Button size="sm" class="h-8" :disabled="loading || !hasMarkers" @click="resolve('manual')">Apply</Button>
        <Button
          v-if="conflictTotal > 1"
          size="sm"
          class="h-8"
          :disabled="loading || !hasMarkers"
          @click="resolve('manual', true)"
          >Apply & Next</Button
        >
        <Button variant="secondary" size="sm" class="h-8" :disabled="loading" @click="$emit('fallbackDiff')"
          >Open Diff</Button
        >
      </div>
    </div>

    <div class="ce-subhead">
      <span>{{ blocks.length }} block{{ blocks.length === 1 ? '' : 's' }}</span>
      <span v-if="isUnmerged && !hasMarkers">Unmerged without text markers</span>
    </div>

    <div v-if="error" class="ce-error">{{ error }}</div>

    <div v-if="loading" class="ce-loading">
      <Skeleton class="h-10" />
      <Skeleton class="h-40" />
    </div>

    <div v-else-if="!hasMarkers" class="ce-empty">
      <div class="ce-empty-title">No text conflict markers found</div>
      <div class="ce-empty-note">
        <template v-if="isUnmerged">
          This conflict is marker-free (often binary). You can still resolve with "Take Ours/Theirs", or open the
          standard diff.
        </template>
        <template v-else>
          This file may already be resolved. Open the standard diff to verify its final state.
        </template>
      </div>
      <div class="ce-empty-actions">
        <Button variant="secondary" size="sm" class="h-8" :disabled="loading" @click="$emit('fallbackDiff')"
          >Open Diff</Button
        >
      </div>
    </div>

    <div v-else class="ce-blocks">
      <div v-for="b in blocks" :key="b.id" class="ce-block">
        <div class="ce-block-head">
          <div class="ce-block-id">Block #{{ b.id + 1 }}</div>
          <div class="ce-pick">
            <label class="ce-radio">
              <input v-model="choices[b.id]" type="radio" value="ours" />
              <span>Ours</span>
            </label>
            <label class="ce-radio">
              <input v-model="choices[b.id]" type="radio" value="theirs" />
              <span>Theirs</span>
            </label>
            <label v-if="hasBase" class="ce-radio">
              <input v-model="choices[b.id]" type="radio" value="base" />
              <span>Base</span>
            </label>
            <label class="ce-radio">
              <input v-model="choices[b.id]" type="radio" value="both" />
              <span>Both</span>
            </label>
          </div>
        </div>

        <div class="ce-cols" :class="{ 'ce-cols--three': hasBase }">
          <div class="ce-col">
            <div class="ce-col-title">
              Ours <span v-if="b.oursLabel" class="ce-col-label">{{ b.oursLabel }}</span>
            </div>
            <pre class="ce-code">{{ b.ours }}</pre>
          </div>
          <div v-if="hasBase" class="ce-col">
            <div class="ce-col-title">
              Base <span v-if="b.baseLabel" class="ce-col-label">{{ b.baseLabel }}</span>
            </div>
            <pre class="ce-code">{{ b.base }}</pre>
          </div>
          <div class="ce-col">
            <div class="ce-col-title">
              Theirs <span v-if="b.theirsLabel" class="ce-col-label">{{ b.theirsLabel }}</span>
            </div>
            <pre class="ce-code">{{ b.theirs }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ce {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.ce-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.ce-kicker {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}

.ce-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: oklch(var(--foreground) / 0.9);
  max-width: 62ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ce-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ce-nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 2px;
}

.ce-nav-label {
  min-width: 56px;
  text-align: center;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted);
}

.ce-subhead {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted);
}

.ce-error {
  border: 1px solid oklch(var(--destructive) / 0.35);
  background: oklch(var(--destructive) / 0.06);
  color: oklch(var(--foreground) / 0.9);
  border-radius: 10px;
  padding: 10px;
  font-size: 12px;
  white-space: pre-wrap;
}

.ce-loading {
  display: grid;
  gap: 10px;
}

.ce-empty {
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 12px;
  padding: 12px;
  background: oklch(var(--muted) / 0.12);
}

.ce-empty-title {
  font-size: 13px;
  font-weight: 600;
}

.ce-empty-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.ce-empty-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.ce-blocks {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 12px;
}

.ce-block {
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 14px;
  background: oklch(var(--muted) / 0.12);
  padding: 12px;
}

.ce-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ce-block-id {
  font-size: 12px;
  font-weight: 600;
  color: oklch(var(--foreground) / 0.9);
}

.ce-pick {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.ce-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.ce-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 10px;
}

.ce-cols--three {
  grid-template-columns: 1fr 1fr 1fr;
}

.ce-col {
  border: 1px solid oklch(var(--border) / 0.6);
  border-radius: 12px;
  background: oklch(var(--background));
  overflow: hidden;
}

.ce-col-title {
  padding: 8px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid oklch(var(--border) / 0.6);
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.ce-col-label {
  font-family: var(--font-mono);
  font-size: 10px;
  opacity: 0.8;
}

.ce-code {
  margin: 0;
  padding: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre;
  overflow: auto;
  max-height: 240px;
}

@media (max-width: 900px) {
  .ce-cols {
    grid-template-columns: 1fr;
  }
}
</style>
