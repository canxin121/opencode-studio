<script setup lang="ts">
import MiniActionButton from '@/components/ui/MiniActionButton.vue'

type Gitmoji = { emoji: string; label: string }

const props = defineProps<{
  message: string
  committing: boolean
  gitmojiEnabled: boolean
  gitmojis: Gitmoji[]
  selectedGitmoji: string
}>()

const emit = defineEmits<{
  (e: 'update:message', value: string): void
  (e: 'update:selectedGitmoji', value: string): void
  (e: 'insertGitmoji'): void
  (e: 'messageKeydown', ev: KeyboardEvent): void
  (e: 'commit'): void
}>()

function updateMessage(ev: Event) {
  const el = ev.target as HTMLTextAreaElement | null
  emit('update:message', el?.value ?? '')
}

function updateSelectedGitmoji(ev: Event) {
  const el = ev.target as HTMLSelectElement | null
  emit('update:selectedGitmoji', el?.value ?? '')
  emit('insertGitmoji')
}

const canCommit = () => Boolean((props.message || '').trim()) && !props.committing
</script>

<template>
  <div class="space-y-2">
    <textarea
      :value="message"
      class="h-24 w-full resize-none rounded-sm border border-sidebar-border/70 bg-sidebar-accent/15 px-2.5 py-2 text-[12px] font-mono shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder="Message (Cmd+Enter to commit)"
      @input="updateMessage"
      @keydown.meta.enter="$emit('commit')"
      @keydown.ctrl.enter="$emit('commit')"
      @keydown="$emit('messageKeydown', $event)"
    />

    <div class="flex items-center justify-between gap-2">
      <div v-if="gitmojiEnabled" class="flex items-center gap-1">
        <select
          :value="selectedGitmoji"
          class="h-6 w-24 rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 px-1 text-[10px]"
          @change="updateSelectedGitmoji"
        >
          <option value="" disabled>Emoji</option>
          <option v-for="g in gitmojis" :key="g.emoji" :value="g.emoji">{{ g.emoji }} {{ g.label }}</option>
        </select>
      </div>

      <MiniActionButton variant="default" class="ml-auto px-2.5" :disabled="!canCommit()" @click="$emit('commit')">
        Commit
      </MiniActionButton>
    </div>
  </div>
</template>
