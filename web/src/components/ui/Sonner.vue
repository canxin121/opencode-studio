<script setup lang="ts">
import { Toaster as Sonner } from 'vue-sonner'
import type { ToasterProps } from 'vue-sonner'

withDefaults(defineProps<ToasterProps>(), {
  position: 'top-right',
  theme: 'system',
  richColors: true,
  closeButton: true,
  visibleToasts: 4,
})
</script>

<template>
  <Sonner v-bind="$props" />
</template>
