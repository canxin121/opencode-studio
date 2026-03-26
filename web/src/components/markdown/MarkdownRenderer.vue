<script setup lang="ts">
import Markdown from '@/components/Markdown.vue'

withDefaults(
  defineProps<{
    content: string
    mode?: 'markdown' | 'plain'
    stream?: boolean
    streamDebounceMs?: number
    sourcePath?: string
    revealAnchor?: string
    revealRequestSeq?: number
  }>(),
  {
    mode: 'markdown',
    stream: false,
    streamDebounceMs: 60,
    sourcePath: '',
    revealAnchor: '',
    revealRequestSeq: 0,
  },
)
</script>

<template>
  <Markdown
    :content="content"
    :mode="mode"
    :stream="stream"
    :stream-debounce-ms="streamDebounceMs"
    :source-path="sourcePath"
    :reveal-anchor="revealAnchor"
    :reveal-request-seq="revealRequestSeq"
  />
</template>
