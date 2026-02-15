<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  projectRoot: string
  path: string
  defaultBranch: string
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:path', value: string): void
  (e: 'update:defaultBranch', value: string): void
  (e: 'initialize'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdatePath(v: string | number) {
  emit('update:path', String(v))
}

function onUpdateDefaultBranch(v: string | number) {
  emit('update:defaultBranch', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Initialize Git Repository"
    description="Create a new .git directory"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">Path (relative to project)</div>
        <Input
          :model-value="path"
          class="h-9 font-mono text-xs"
          placeholder=". (project root)"
          @update:model-value="onUpdatePath"
        />
        <div class="text-[11px] text-muted-foreground">Examples: `.` or `packages/api`</div>
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">Default branch (optional)</div>
        <Input
          :model-value="defaultBranch"
          class="h-9 font-mono text-xs"
          placeholder="main"
          @update:model-value="onUpdateDefaultBranch"
        />
        <div class="text-[11px] text-muted-foreground">Uses `git init --initial-branch` when provided.</div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)" :disabled="busy">Cancel</Button>
        <Button size="sm" @click="$emit('initialize')" :disabled="busy || !projectRoot">Initialize</Button>
      </div>
    </div>
  </FormDialog>
</template>
