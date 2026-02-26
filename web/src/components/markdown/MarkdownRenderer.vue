<script setup lang="ts">
import Markdown from '@/components/Markdown.vue'

withDefaults(
  defineProps<{
    content: string
    mode?: 'markdown' | 'plain'
    stream?: boolean
    streamDebounceMs?: number
  }>(),
  {
    mode: 'markdown',
    stream: false,
    streamDebounceMs: 60,
  },
)
</script>

<template>
  <Markdown :content="content" :mode="mode" :stream="stream" :stream-debounce-ms="streamDebounceMs" />
</template>
