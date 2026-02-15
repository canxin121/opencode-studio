<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  from: string
  to: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:from', value: string): void
  (e: 'update:to', value: string): void
  (e: 'submit'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'from' | 'to', v: string | number) {
  const s = String(v)
  if (key === 'from') emit('update:from', s)
  if (key === 'to') emit('update:to', s)
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Rename"
    description="Rename a file in the repository"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">From</div>
        <Input :model-value="from" class="h-9 font-mono text-xs" @update:model-value="(v) => onUpdateText('from', v)" />
      </div>
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">To</div>
        <Input :model-value="to" class="h-9 font-mono text-xs" @update:model-value="(v) => onUpdateText('to', v)" />
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">Cancel</Button>
        <Button size="sm" :disabled="!from.trim() || !to.trim()" @click="$emit('submit')">Rename</Button>
      </div>
    </div>
  </FormDialog>
</template>
