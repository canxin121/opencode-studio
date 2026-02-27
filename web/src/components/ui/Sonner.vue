<script setup lang="ts">
import { Toaster as Sonner } from 'vue-sonner'
import type { ToasterProps } from 'vue-sonner'

withDefaults(defineProps<ToasterProps>(), {
  position: 'top-right',
  offset: '14px',
  mobileOffset: '10px',
  theme: 'system',
  richColors: false,
  closeButton: true,
  visibleToasts: 4,
  duration: 2500,
})
</script>

<template>
  <Sonner v-bind="$props" />
</template>
