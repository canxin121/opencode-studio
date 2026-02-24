<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MiniActionButton from '@/components/ui/MiniActionButton.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'

type Gitmoji = { emoji: string; label: string }

const { t } = useI18n()

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

function updateSelectedGitmoji(value: string | number) {
  const v = String(value || '')
  emit('update:selectedGitmoji', v)
  if (v) emit('insertGitmoji')
}

const canCommit = () => Boolean((props.message || '').trim()) && !props.committing

const gitmojiPickerOptions = computed(() =>
  (Array.isArray(props.gitmojis) ? props.gitmojis : []).map((g) => ({
    value: g.emoji,
    label: `${g.emoji} ${g.label}`,
  })),
)
</script>

<template>
  <div class="space-y-2">
    <textarea
      :value="message"
      class="h-24 w-full resize-none rounded-sm border border-sidebar-border/70 bg-sidebar-accent/15 px-2.5 py-2 text-[12px] font-mono shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :placeholder="t('git.ui.commitBox.messagePlaceholder')"
      @input="updateMessage"
      @keydown.meta.enter="$emit('commit')"
      @keydown.ctrl.enter="$emit('commit')"
      @keydown="$emit('messageKeydown', $event)"
    />

    <div class="flex items-center justify-between gap-2">
      <div v-if="gitmojiEnabled" class="flex items-center gap-1">
        <div class="w-24">
          <OptionPicker
            :model-value="selectedGitmoji"
            :options="gitmojiPickerOptions"
            :title="t('git.ui.commitBox.gitmojiTitle')"
            :search-placeholder="t('git.ui.commitBox.searchEmojis')"
            :empty-label="t('git.ui.commitBox.emojiEmptyLabel')"
            :empty-disabled="true"
            trigger-class="h-6 px-1 text-[10px] rounded-sm border-sidebar-border/70 bg-sidebar-accent/20 shadow-none"
            size="sm"
            @update:model-value="updateSelectedGitmoji"
          />
        </div>
      </div>

      <MiniActionButton variant="default" class="ml-auto px-2.5" :disabled="!canCommit()" @click="$emit('commit')">
        {{ t('git.actionsMenu.groups.commit') }}
      </MiniActionButton>
    </div>
  </div>
</template>
