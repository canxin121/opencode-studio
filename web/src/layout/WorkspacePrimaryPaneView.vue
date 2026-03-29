<script setup lang="ts">
defineProps<{
  windowId?: string | null
}>()
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background">
    <div class="min-h-0 flex-1 overflow-hidden">
      <router-view />
    </div>
  </section>
</template>
