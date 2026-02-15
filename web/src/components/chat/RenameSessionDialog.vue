<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  draft: string
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:draft', value: string): void
  (e: 'save'): void
}>()

function onUpdateDraft(v: string | number) {
  emit('update:draft', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Rename session"
    description="Update the session title"
    @update:open="$emit('update:open', $event)"
  >
    <div class="space-y-3">
      <Input :model-value="draft" placeholder="Session title" class="h-9" @update:model-value="onUpdateDraft" />
      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" @click="$emit('update:open', false)">Cancel</Button>
        <Button @click="$emit('save')" :disabled="busy || !draft.trim()">{{ busy ? 'Saving…' : 'Save' }}</Button>
      </div>
    </div>
  </FormDialog>
</template>
