<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  projectRoot: string
  url: string
  path: string
  cloneRef: string
  recursive: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:url', value: string): void
  (e: 'update:path', value: string): void
  (e: 'update:cloneRef', value: string): void
  (e: 'update:recursive', value: boolean): void
  (e: 'clone'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateUrl(v: string | number) {
  emit('update:url', String(v))
}

function onUpdatePath(v: string | number) {
  emit('update:path', String(v))
}

function onUpdateCloneRef(v: string | number) {
  emit('update:cloneRef', String(v))
}

function onUpdateRecursive(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:recursive', Boolean(el?.checked))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Clone Repository"
    description="Clone a remote repository into the project"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">Repository URL</div>
        <Input
          :model-value="url"
          class="h-9 font-mono text-xs"
          placeholder="https://github.com/org/repo.git"
          @update:model-value="onUpdateUrl"
        />
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">Target path (relative to project)</div>
        <Input
          :model-value="path"
          class="h-9 font-mono text-xs"
          placeholder="(leave blank to derive from URL)"
          @update:model-value="onUpdatePath"
        />
        <div class="text-[11px] text-muted-foreground">
          Example: `repos/my-app` — defaults to the repo name if empty.
        </div>
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">Checkout ref/branch (optional)</div>
        <Input
          :model-value="cloneRef"
          class="h-9 font-mono text-xs"
          placeholder="main"
          @update:model-value="onUpdateCloneRef"
        />
      </div>

      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" class="accent-primary" :checked="recursive" @change="onUpdateRecursive" />
        <span>Clone submodules recursively</span>
      </label>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)" :disabled="busy">Cancel</Button>
        <Button size="sm" @click="$emit('clone')" :disabled="busy || !projectRoot || !url.trim()">Clone</Button>
      </div>
    </div>
  </FormDialog>
</template>
